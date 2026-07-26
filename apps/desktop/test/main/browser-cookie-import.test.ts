import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { createClient } from "@libsql/client"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  buildCookieUrl,
  chromeEpochToUnixSeconds,
  COOKIE_COLUMNS,
  decryptChromiumCookieValue,
  listBrowserProfiles,
  listCookieSources,
  mapChromiumSameSite,
  parseCookieRow,
  stripHostHashPrefix
} from "@/main/browser/cookie-import"

// Hoisted above the imports, so it cannot reach for `os` or `crypto`.
const { mockedHomeDir } = vi.hoisted(() => ({
  mockedHomeDir: `/tmp/etyon-cookie-home-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "temp" ? os.tmpdir() : mockedHomeDir)
  },
  session: {
    fromPartition: () => ({ cookies: { set: () => Promise.resolve() } })
  }
}))
// The real manager pulls in the window, settings, and liquid-glass chain; only
// the hardened-session accessor matters here.
vi.mock("@/main/browser/manager", () => ({
  getBrowsingSession: () => ({ cookies: { set: () => Promise.resolve() } })
}))
vi.mock("@/main/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

const CHROME_SUPPORT_DIR = "Library/Application Support/Google/Chrome"
const KEY = crypto.pbkdf2Sync("test-password", "saltysalt", 1003, 16, "sha1")
const tempDirs: string[] = [mockedHomeDir]

const createTempDir = async (prefix: string): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))

  tempDirs.push(dir)

  return dir
}

/**
 * Builds the blob Chromium would have written: `v10` + AES-128-CBC over
 * `SHA256(host_key) || value` with an all-spaces IV.
 */
const encryptCookieValue = ({
  hostKey,
  value,
  withHostHash = true
}: {
  hostKey: string
  value: string
  withHostHash?: boolean
}): Buffer => {
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    KEY,
    Buffer.alloc(16, " ")
  )
  const hostHash = crypto.createHash("sha256").update(hostKey).digest()
  const plaintext = withHostHash
    ? Buffer.concat([hostHash, Buffer.from(value, "utf-8")])
    : Buffer.from(value, "utf-8")

  return Buffer.concat([
    Buffer.from("v10", "latin1"),
    cipher.update(plaintext),
    cipher.final()
  ])
}

const writeCookieDatabase = async (
  cookiesPath: string,
  cookieCount: number
): Promise<void> => {
  const client = createClient({ url: `file:${cookiesPath}` })

  try {
    await client.execute(
      "create table cookies (host_key text, name text, value text)"
    )
    await client.batch(
      Array.from({ length: cookieCount }, (_unused, index) => ({
        args: [`host-${index}.example.com`, `name-${index}`, ""],
        sql: "insert into cookies (host_key, name, value) values (?, ?, ?)"
      }))
    )
  } finally {
    client.close()
  }
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => fs.rm(dir, { force: true, recursive: true }))
  )
})

describe("chromeEpochToUnixSeconds", () => {
  it("treats a zero expiry as a session cookie", () => {
    expect(chromeEpochToUnixSeconds(0)).toBeNull()
  })

  it("shifts the chrome epoch onto unix time", () => {
    expect(chromeEpochToUnixSeconds(11_644_473_600_000_000)).toBe(0)
    expect(chromeEpochToUnixSeconds(13_400_000_000_000_000)).toBe(
      13_400_000_000 - 11_644_473_600
    )
  })
})

describe("mapChromiumSameSite", () => {
  it("maps chromium's codes onto electron's names", () => {
    expect(mapChromiumSameSite(-1)).toBe("unspecified")
    expect(mapChromiumSameSite(0)).toBe("no_restriction")
    expect(mapChromiumSameSite(1)).toBe("lax")
    expect(mapChromiumSameSite(2)).toBe("strict")
  })

  it("falls back to unspecified for an unknown code", () => {
    expect(mapChromiumSameSite(99)).toBe("unspecified")
  })
})

describe("buildCookieUrl", () => {
  it("drops the leading dot of a domain cookie", () => {
    expect(buildCookieUrl(".github.com", true, "/")).toBe("https://github.com/")
  })

  it("follows the secure flag for the scheme", () => {
    expect(buildCookieUrl("example.com", false, "/app")).toBe(
      "http://example.com/app"
    )
  })

  it("normalizes a path that is missing its leading slash", () => {
    expect(buildCookieUrl("example.com", true, "app")).toBe(
      "https://example.com/app"
    )
  })
})

describe("stripHostHashPrefix", () => {
  it("removes a matching chrome 130+ host hash", () => {
    const hostHash = crypto.createHash("sha256").update("github.com").digest()
    const plaintext = Buffer.concat([hostHash, Buffer.from("token")])

    expect(stripHostHashPrefix(plaintext, "github.com").toString()).toBe(
      "token"
    )
  })

  it("keeps the payload of an older prefix-free value", () => {
    const plaintext = Buffer.from("a".repeat(40))

    expect(stripHostHashPrefix(plaintext, "github.com")).toEqual(plaintext)
  })
})

describe("decryptChromiumCookieValue", () => {
  it("round-trips a v10 value with the chrome 130+ host prefix", () => {
    const encrypted = encryptCookieValue({
      hostKey: "github.com",
      value: "session=abc123"
    })

    expect(decryptChromiumCookieValue(encrypted, KEY, "github.com")).toBe(
      "session=abc123"
    )
  })

  it("round-trips an older value that carries no host prefix", () => {
    const encrypted = encryptCookieValue({
      hostKey: "github.com",
      value: "legacy",
      withHostHash: false
    })

    expect(decryptChromiumCookieValue(encrypted, KEY, "github.com")).toBe(
      "legacy"
    )
  })

  it("keeps the prefix bytes when the host does not match", () => {
    const encrypted = encryptCookieValue({
      hostKey: "github.com",
      value: "session=abc123"
    })
    const decrypted = decryptChromiumCookieValue(encrypted, KEY, "example.com")

    expect(decrypted).not.toBe("session=abc123")
    expect(decrypted?.endsWith("session=abc123")).toBe(true)
  })

  it("returns null for a scheme this build cannot read", () => {
    expect(
      decryptChromiumCookieValue(Buffer.from("v20somethingelse"), KEY, "a.com")
    ).toBeNull()
  })

  it("returns null for a truncated ciphertext", () => {
    expect(
      decryptChromiumCookieValue(Buffer.from("v10short"), KEY, "a.com")
    ).toBeNull()
  })
})

describe("listBrowserProfiles", () => {
  it("keeps profile directories with a cookie database and names them", async () => {
    const root = await createTempDir("etyon-cookie-profiles-")

    await fs.mkdir(path.join(root, "Default"))
    await fs.writeFile(path.join(root, "Default", "Cookies"), "")
    await fs.mkdir(path.join(root, "Profile 1"))
    await fs.writeFile(path.join(root, "Profile 1", "Cookies"), "")
    // No cookie database, so not importable.
    await fs.mkdir(path.join(root, "Profile 2"))
    // Not a profile directory at all.
    await fs.mkdir(path.join(root, "Crashpad"))
    await fs.writeFile(
      path.join(root, "Local State"),
      JSON.stringify({ profile: { info_cache: { Default: { name: "Work" } } } })
    )

    expect(await listBrowserProfiles(root)).toEqual([
      { profileDir: "Default", profileName: "Work" },
      { profileDir: "Profile 1", profileName: "Profile 1" }
    ])
  })

  it("falls back to directory names when local state is malformed", async () => {
    const root = await createTempDir("etyon-cookie-profiles-")

    await fs.mkdir(path.join(root, "Default"))
    await fs.writeFile(path.join(root, "Default", "Cookies"), "")
    await fs.writeFile(path.join(root, "Local State"), "{not json")

    expect(await listBrowserProfiles(root)).toEqual([
      { profileDir: "Default", profileName: "Default" }
    ])
  })

  it("returns nothing for a browser that is not installed", async () => {
    expect(await listBrowserProfiles("/nope/etyon/not-a-browser")).toEqual([])
  })
})

describe("cookie row reads", () => {
  // Regression: sqlite types values, not columns, so a real Chrome profile can
  // hold TEXT-typed bytes in any cookie column — including `encrypted_value`,
  // which is where the crash actually happened — and libsql's Rust core panics,
  // killing the whole process, when it decodes TEXT that is not valid UTF-8.
  // The import therefore selects every non-integer column as a blob; this
  // drives that exact select.
  it("survives cookie text that is not valid utf-8", async () => {
    const dir = await createTempDir("etyon-invalid-utf8-")
    const cookiesPath = path.join(dir, "Cookies")
    const client = createClient({
      intMode: "bigint",
      url: `file:${cookiesPath}`
    })

    try {
      await client.execute(
        "create table cookies (host_key text, name text, path text, value text, encrypted_value blob, is_secure integer, is_httponly integer, expires_utc integer, samesite integer)"
      )
      // `cast(x'…ff…' as text)` stores bytes that no UTF-8 decoder accepts —
      // in the text `value` and, like the profile that crashed the app, in a
      // TEXT-typed `encrypted_value`.
      await client.execute(
        "insert into cookies values (cast(x'2e6578616d706c652e636f6d' as text), 'name', '/', cast(x'68656cff6c6f' as text), cast(x'76313069ff6e76616c6964' as text), 1, 0, 0, 1)"
      )

      const { rows } = await client.execute(
        `select ${COOKIE_COLUMNS} from cookies`
      )
      const row = parseCookieRow(rows[0])

      expect(row.hostKey).toBe(".example.com")
      expect(row.value).toBe("hel�lo")
      expect(row.sameSite).toBe(1)
      // The bytes arrive intact for decryption, not lossily re-decoded.
      expect(row.encryptedValue.subarray(0, 3).toString("latin1")).toBe("v10")
      expect(row.encryptedValue.length).toBe(11)
    } finally {
      client.close()
    }
  })
})

describe("listCookieSources", () => {
  it("counts cookies without touching the keychain", async () => {
    const profileDir = path.join(mockedHomeDir, CHROME_SUPPORT_DIR, "Default")

    await fs.mkdir(profileDir, { recursive: true })
    await writeCookieDatabase(path.join(profileDir, "Cookies"), 3)
    await fs.writeFile(
      path.join(mockedHomeDir, CHROME_SUPPORT_DIR, "Local State"),
      JSON.stringify({ profile: { info_cache: { Default: { name: "Work" } } } })
    )

    expect(await listCookieSources()).toEqual([
      {
        browser: "Chrome",
        cookieCount: 3,
        id: "chrome:Default",
        profileDir: "Default",
        profileName: "Work"
      }
    ])
  })
})
