import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import type {
  BrowserCookieImportErrorReason,
  BrowserCookieSource
} from "@etyon/rpc"
import { createClient } from "@libsql/client"
import type { Client, Row } from "@libsql/client"
import { app } from "electron"
import type { Cookies } from "electron"

import { getBrowsingSession } from "@/main/browser/manager"
import { logger } from "@/main/logger"

/**
 * Imports an existing sign-in state from a local Chromium-family browser into
 * the embedded browser's `persist:browser` partition, so the user does not have
 * to log into every site again (plans/browser-cookie-import.md).
 *
 * macOS only. Chromium encrypts cookie values with a password kept in the login
 * Keychain under "<Browser> Safe Storage"; it is read through the `security`
 * CLI, whose first read raises the system authorization prompt. Two invariants
 * hold everywhere in this module:
 *
 * - the source profile is read-only — its cookie database is copied to a temp
 *   file before being opened, and the copy is deleted afterwards;
 * - decrypted values never leave the process: the Keychain password, the
 *   derived key, and the plaintext stay local, and callers only see counts.
 */

interface ChromiumBrowser {
  id: string
  keychainAccount: string
  keychainService: string
  label: string
  supportDir: string
}

// `supportDir` is relative to ~/Library/Application Support.
const CHROMIUM_BROWSERS: readonly ChromiumBrowser[] = [
  {
    id: "chrome",
    keychainAccount: "Chrome",
    keychainService: "Chrome Safe Storage",
    label: "Chrome",
    supportDir: "Google/Chrome"
  },
  {
    id: "edge",
    keychainAccount: "Microsoft Edge",
    keychainService: "Microsoft Edge Safe Storage",
    label: "Edge",
    supportDir: "Microsoft Edge"
  },
  {
    id: "brave",
    keychainAccount: "Brave",
    keychainService: "Brave Safe Storage",
    label: "Brave",
    supportDir: "BraveSoftware/Brave-Browser"
  },
  {
    id: "arc",
    keychainAccount: "Arc",
    keychainService: "Arc Safe Storage",
    label: "Arc",
    supportDir: "Arc/User Data"
  },
  {
    id: "chromium",
    keychainAccount: "Chromium",
    keychainService: "Chromium Safe Storage",
    label: "Chromium",
    supportDir: "Chromium"
  }
]

const COOKIES_FILENAME = "Cookies"
const LOCAL_STATE_FILENAME = "Local State"
const DEFAULT_PROFILE_DIR = "Default"
const NUMBERED_PROFILE_PREFIX = "Profile "
const SOURCE_ID_SEPARATOR = ":"

// Chromium's macOS key derivation, unchanged since the feature shipped.
const KEY_SALT = "saltysalt"
const KEY_ITERATIONS = 1003
const KEY_LENGTH_BYTES = 16
const KEY_DIGEST = "sha1"
const CIPHER_ALGORITHM = "aes-128-cbc"
const CIPHER_BLOCK_BYTES = 16
// Chromium encrypts with an all-spaces IV rather than a random one.
const CIPHER_IV = Buffer.alloc(CIPHER_BLOCK_BYTES, " ")
const ENCRYPTED_VALUE_PREFIX = "v10"
// Chrome 130+ prepends SHA256(host_key) to the plaintext before encrypting.
const HOST_HASH_BYTES = 32
// Chrome counts microseconds from 1601-01-01; Unix time starts at 1970-01-01.
const CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600
const MICROSECONDS_PER_SECOND = 1e6

// Every non-integer column is cast to a blob and decoded (or kept) as bytes in
// JS: sqlite's typing is per-value, so even the `encrypted_value` BLOB column
// can hold TEXT-typed rows in a real Chrome profile, and libsql's Rust core
// panics — aborting the whole process — when it decodes a TEXT value that is
// not valid UTF-8.
export const COOKIE_COLUMNS =
  "cast(host_key as blob) as host_key, cast(name as blob) as name, cast(path as blob) as path, cast(value as blob) as value, cast(encrypted_value as blob) as encrypted_value, is_secure, is_httponly, expires_utc, samesite"
// `security` says so only when the item is absent; a denied prompt does not.
const KEYCHAIN_ITEM_MISSING_PATTERN = /could not be found/iu

const execFileAsync = promisify(execFile)

/**
 * Typed failure the import dialog turns into its own copy. Everything else
 * (an unreadable database, a cookie Electron refuses) is either counted or
 * surfaced as a generic error.
 */
export class BrowserCookieImportError extends Error {
  readonly reason: BrowserCookieImportErrorReason

  constructor(reason: BrowserCookieImportErrorReason, message: string) {
    super(message)
    this.name = "BrowserCookieImportError"
    this.reason = reason
  }
}

/** Chrome epoch microseconds to Unix seconds; `0` marks a session cookie. */
export const chromeEpochToUnixSeconds = (expiresUtc: number): number | null => {
  if (expiresUtc === 0) {
    return null
  }

  return expiresUtc / MICROSECONDS_PER_SECOND - CHROME_EPOCH_OFFSET_SECONDS
}

export type ChromiumSameSite =
  | "lax"
  | "no_restriction"
  | "strict"
  | "unspecified"

/** Chromium's `samesite` column to Electron's `sameSite` option. */
export const mapChromiumSameSite = (sameSite: number): ChromiumSameSite => {
  if (sameSite === 0) {
    return "no_restriction"
  }

  if (sameSite === 1) {
    return "lax"
  }

  if (sameSite === 2) {
    return "strict"
  }

  // -1 is Chromium's own "unspecified"; an unknown future value is treated the
  // same way rather than guessing.
  return "unspecified"
}

/**
 * The URL a cookie is written against. `host_key` carries a leading dot for
 * domain cookies, which is not part of the host, and the scheme has to match
 * the cookie's secure flag or Electron rejects the write.
 */
export const buildCookieUrl = (
  hostKey: string,
  isSecure: boolean,
  cookiePath: string
): string => {
  const host = hostKey.startsWith(".") ? hostKey.slice(1) : hostKey
  const scheme = isSecure ? "https" : "http"
  const normalizedPath = cookiePath.startsWith("/")
    ? cookiePath
    : `/${cookiePath}`

  return `${scheme}://${host}${normalizedPath}`
}

/**
 * Drops the Chrome 130+ `SHA256(host_key)` plaintext prefix. The hash is
 * compared rather than assumed so older profiles, which have no prefix, keep
 * their first 32 bytes.
 */
export const stripHostHashPrefix = (
  plaintext: Buffer,
  hostKey: string
): Buffer => {
  if (plaintext.length < HOST_HASH_BYTES) {
    return plaintext
  }

  const hostHash = crypto.createHash("sha256").update(hostKey).digest()

  return plaintext.subarray(0, HOST_HASH_BYTES).equals(hostHash)
    ? plaintext.subarray(HOST_HASH_BYTES)
    : plaintext
}

// Chromium pads with PKCS#7. Stripped by hand (`setAutoPadding(false)` above)
// so a malformed block returns null instead of throwing mid-import.
const stripPkcs7Padding = (padded: Buffer): Buffer | null => {
  const padLength = padded.at(-1) ?? 0

  if (
    padLength < 1 ||
    padLength > CIPHER_BLOCK_BYTES ||
    padLength > padded.length
  ) {
    return null
  }

  return padded.subarray(0, padded.length - padLength)
}

/**
 * Decrypts one `encrypted_value` blob. Returns `null` for anything this build
 * cannot read — a non-`v10` scheme (Windows DPAPI / app-bound), a truncated
 * blob, or broken padding — so the caller can count it and move on.
 */
export const decryptChromiumCookieValue = (
  encrypted: Buffer,
  key: Buffer,
  hostKey: string
): string | null => {
  const prefix = encrypted
    .subarray(0, ENCRYPTED_VALUE_PREFIX.length)
    .toString("latin1")

  if (prefix !== ENCRYPTED_VALUE_PREFIX) {
    return null
  }

  const ciphertext = encrypted.subarray(ENCRYPTED_VALUE_PREFIX.length)

  if (ciphertext.length === 0 || ciphertext.length % CIPHER_BLOCK_BYTES !== 0) {
    return null
  }

  const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, key, CIPHER_IV)

  decipher.setAutoPadding(false)

  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const plaintext = stripPkcs7Padding(padded)

  if (plaintext === null) {
    return null
  }

  return stripHostHashPrefix(plaintext, hostKey).toString("utf-8")
}

interface ChromiumLocalState {
  profile?: {
    info_cache?: Record<string, { name?: string } | undefined>
  }
}

interface BrowserProfile {
  profileDir: string
  profileName: string
}

const assertSupportedPlatform = (): void => {
  if (process.platform !== "darwin") {
    throw new BrowserCookieImportError(
      "unsupported-platform",
      "Importing browser cookies is only supported on macOS"
    )
  }
}

const getSupportRootDir = (): string =>
  path.join(app.getPath("home"), "Library", "Application Support")

const readLocalState = async (
  browserRootDir: string
): Promise<ChromiumLocalState | null> => {
  try {
    const raw = await fs.readFile(
      path.join(browserRootDir, LOCAL_STATE_FILENAME),
      "utf-8"
    )

    return JSON.parse(raw) as ChromiumLocalState
  } catch {
    // A missing or malformed Local State only costs the pretty profile names.
    return null
  }
}

const readProfileDisplayName = (
  localState: ChromiumLocalState | null,
  profileDir: string
): string | null => {
  const name = localState?.profile?.info_cache?.[profileDir]?.name

  return typeof name === "string" && name !== "" ? name : null
}

const isProfileDirName = (name: string): boolean =>
  name === DEFAULT_PROFILE_DIR || name.startsWith(NUMBERED_PROFILE_PREFIX)

const pathExists = async (candidate: string): Promise<boolean> => {
  try {
    await fs.access(candidate)

    return true
  } catch {
    return false
  }
}

/**
 * The importable profiles under one browser's root directory: `Default` and
 * `Profile N`, and only those that actually hold a cookie database. A browser
 * that is not installed yields an empty list rather than an error.
 */
export const listBrowserProfiles = async (
  browserRootDir: string
): Promise<BrowserProfile[]> => {
  let entryNames: string[]

  try {
    const entries = await fs.readdir(browserRootDir, { withFileTypes: true })

    entryNames = entries
      .filter((entry) => entry.isDirectory() && isProfileDirName(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }

  const localState = await readLocalState(browserRootDir)
  const profiles = await Promise.all(
    entryNames.map(async (entryName) => {
      const hasCookies = await pathExists(
        path.join(browserRootDir, entryName, COOKIES_FILENAME)
      )

      if (!hasCookies) {
        return null
      }

      return {
        profileDir: entryName,
        profileName: readProfileDisplayName(localState, entryName) ?? entryName
      }
    })
  )

  // readdir order is not specified, so the list is sorted for a stable UI.
  return profiles
    .filter((profile) => profile !== null)
    .toSorted((left, right) => left.profileDir.localeCompare(right.profileDir))
}

/**
 * Opens a throwaway copy of a cookie database. A running browser holds a write
 * lock on the live file, and the source profile must stay untouched either way,
 * so every read goes through the copy — deleted, with its sidecars, afterwards.
 */
const withCookieDatabase = async <T>(
  cookiesPath: string,
  run: (client: Client) => Promise<T>
): Promise<T> => {
  const copyPath = path.join(
    app.getPath("temp"),
    `etyon-cookies-${crypto.randomUUID()}.sqlite`
  )

  await fs.copyFile(cookiesPath, copyPath)

  // `expires_utc` counts microseconds since 1601 and overflows the safe integer
  // range, which the default number mode rejects outright.
  const client = createClient({ intMode: "bigint", url: `file:${copyPath}` })

  try {
    return await run(client)
  } finally {
    client.close()
    await Promise.all(
      [copyPath, `${copyPath}-shm`, `${copyPath}-wal`].map((sidecarPath) =>
        fs.rm(sidecarPath, { force: true })
      )
    )
  }
}

const countCookies = async (cookiesPath: string): Promise<number | null> => {
  try {
    return await withCookieDatabase(cookiesPath, async (client) => {
      const { rows } = await client.execute(
        "select count(*) as total from cookies"
      )

      return Number(rows.at(0)?.total ?? 0)
    })
  } catch {
    // A locked or unreadable database costs the count, not the entry: the
    // import itself may still succeed.
    return null
  }
}

const buildSourceId = (browserId: string, profileDir: string): string =>
  `${browserId}${SOURCE_ID_SEPARATOR}${profileDir}`

/**
 * Every Chromium profile on this machine. Deliberately does not touch the
 * Keychain: opening the dialog must never raise an authorization prompt.
 */
export const listCookieSources = async (): Promise<BrowserCookieSource[]> => {
  assertSupportedPlatform()

  const supportRootDir = getSupportRootDir()
  const sourcesByBrowser = await Promise.all(
    CHROMIUM_BROWSERS.map(async (browser) => {
      const browserRootDir = path.join(supportRootDir, browser.supportDir)
      const profiles = await listBrowserProfiles(browserRootDir)

      return await Promise.all(
        profiles.map(async (profile) => ({
          browser: browser.label,
          cookieCount: await countCookies(
            path.join(browserRootDir, profile.profileDir, COOKIES_FILENAME)
          ),
          id: buildSourceId(browser.id, profile.profileDir),
          profileDir: profile.profileDir,
          profileName: profile.profileName
        }))
      )
    })
  )

  return sourcesByBrowser.flat()
}

interface ResolvedCookieSource {
  browser: ChromiumBrowser
  cookiesPath: string
}

const resolveCookieSource = async (
  sourceId: string
): Promise<ResolvedCookieSource> => {
  const separatorIndex = sourceId.indexOf(SOURCE_ID_SEPARATOR)
  const browserId = sourceId.slice(0, Math.max(separatorIndex, 0))
  const profileDir = sourceId.slice(separatorIndex + 1)
  const browser = CHROMIUM_BROWSERS.find(
    (candidate) => candidate.id === browserId
  )

  if (!browser) {
    throw new BrowserCookieImportError(
      "source-missing",
      `Unknown cookie source: ${sourceId}`
    )
  }

  const browserRootDir = path.join(getSupportRootDir(), browser.supportDir)
  // Re-enumerated rather than trusted: only a directory this machine reported
  // can be opened, so no caller-supplied path ever reaches the filesystem.
  const profiles = await listBrowserProfiles(browserRootDir)
  const profile = profiles.find(
    (candidate) => candidate.profileDir === profileDir
  )

  if (!profile) {
    throw new BrowserCookieImportError(
      "source-missing",
      `Cookie source is no longer available: ${sourceId}`
    )
  }

  return {
    browser,
    cookiesPath: path.join(browserRootDir, profile.profileDir, COOKIES_FILENAME)
  }
}

// Derived keys stay in process memory for the lifetime of the app and are never
// persisted, so a second import of the same browser skips the Keychain prompt.
const safeStorageKeys = new Map<string, Buffer>()

const readKeychainPassword = async (
  browser: ChromiumBrowser
): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-w",
      "-s",
      browser.keychainService,
      "-a",
      browser.keychainAccount
    ])

    // Never logged, never returned past the key derivation below.
    return stdout.trimEnd()
  } catch (error) {
    const { stderr } = error as { stderr?: unknown }

    // The CLI exits non-zero both when the user denies the prompt (128 / 45)
    // and when the item is absent (44); only the latter says so on stderr, so
    // everything else is reported as a denial.
    if (
      typeof stderr === "string" &&
      KEYCHAIN_ITEM_MISSING_PATTERN.test(stderr)
    ) {
      throw new BrowserCookieImportError(
        "keychain-missing",
        `No Keychain item named "${browser.keychainService}"`
      )
    }

    throw new BrowserCookieImportError(
      "keychain-denied",
      `Keychain access was denied for "${browser.keychainService}"`
    )
  }
}

const readSafeStorageKey = async (
  browser: ChromiumBrowser
): Promise<Buffer> => {
  const cachedKey = safeStorageKeys.get(browser.id)

  if (cachedKey) {
    return cachedKey
  }

  const password = await readKeychainPassword(browser)
  const key = crypto.pbkdf2Sync(
    password,
    KEY_SALT,
    KEY_ITERATIONS,
    KEY_LENGTH_BYTES,
    KEY_DIGEST
  )

  safeStorageKeys.set(browser.id, key)

  return key
}

interface ChromiumCookieRow {
  encryptedValue: Buffer
  expiresUtc: number
  hostKey: string
  isHttpOnly: boolean
  isSecure: boolean
  name: string
  path: string
  sameSite: number
  value: string
}

const readInteger = (value: unknown): number => {
  if (typeof value === "bigint") {
    return Number(value)
  }

  return typeof value === "number" ? value : 0
}

// libsql hands blobs back as ArrayBuffer; a Uint8Array is accepted defensively.
const readBlob = (value: unknown): Buffer => {
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value)
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value)
  }

  return Buffer.alloc(0)
}

// Text columns arrive as blobs (see COOKIE_COLUMNS) and are decoded lossily —
// invalid sequences become U+FFFD instead of crashing. `cast(NULL as blob)`
// stays null, and a string is accepted in case a driver decodes anyway.
const readText = (value: unknown): string =>
  typeof value === "string" ? value : readBlob(value).toString("utf-8")

export const parseCookieRow = (row: Row): ChromiumCookieRow => ({
  encryptedValue: readBlob(row.encrypted_value),
  expiresUtc: readInteger(row.expires_utc),
  hostKey: readText(row.host_key),
  isHttpOnly: readInteger(row.is_httponly) === 1,
  isSecure: readInteger(row.is_secure) === 1,
  name: readText(row.name),
  path: readText(row.path),
  sameSite: readInteger(row.samesite),
  value: readText(row.value)
})

// Pre-encryption profiles still carry a plaintext `value`; everything current
// keeps it empty and puts the payload in `encrypted_value`.
const resolveCookieValue = (
  row: ChromiumCookieRow,
  key: Buffer
): string | null => {
  if (row.encryptedValue.length === 0) {
    return row.value
  }

  return decryptChromiumCookieValue(row.encryptedValue, key, row.hostKey)
}

const writeCookie = async (
  cookies: Cookies,
  row: ChromiumCookieRow,
  key: Buffer
): Promise<boolean> => {
  try {
    const value = resolveCookieValue(row, key)

    if (value === null) {
      return false
    }

    const sameSite = mapChromiumSameSite(row.sameSite)
    // Electron rejects a `no_restriction` cookie that is not secure, so a
    // cross-site cookie is always written as secure (and therefore over https).
    const isSecure = row.isSecure || sameSite === "no_restriction"
    const expirationDate = chromeEpochToUnixSeconds(row.expiresUtc)

    await cookies.set({
      // A leading dot marks a domain cookie; a host-only cookie must carry no
      // `domain` at all.
      ...(row.hostKey.startsWith(".") ? { domain: row.hostKey } : {}),
      // A session cookie has no expiry and has to stay one.
      ...(expirationDate === null ? {} : { expirationDate }),
      httpOnly: row.isHttpOnly,
      name: row.name,
      path: row.path,
      sameSite,
      secure: isSecure,
      url: buildCookieUrl(row.hostKey, isSecure, row.path),
      value
    })

    return true
  } catch {
    // One rejected cookie (a `__Host-` shape Electron will not take, a host it
    // cannot parse) must not abort the rest of the profile.
    return false
  }
}

export interface ImportCookiesInput {
  domainFilter?: string
  sourceId: string
}

export interface ImportCookiesResult {
  failed: number
  imported: number
  total: number
}

/**
 * Copies one profile's cookies into `persist:browser`. Same-name cookies are
 * overwritten (`cookies.set` semantics), so a re-import refreshes rather than
 * duplicates. Per-cookie failures are counted, never thrown.
 */
export const importCookies = async ({
  domainFilter,
  sourceId
}: ImportCookiesInput): Promise<ImportCookiesResult> => {
  assertSupportedPlatform()

  const source = await resolveCookieSource(sourceId)
  const key = await readSafeStorageKey(source.browser)
  const filter = domainFilter?.trim() ?? ""
  const statement =
    filter === ""
      ? { args: [], sql: `select ${COOKIE_COLUMNS} from cookies` }
      : {
          args: [`%${filter}%`],
          sql: `select ${COOKIE_COLUMNS} from cookies where host_key like ?`
        }
  const result = await withCookieDatabase(
    source.cookiesPath,
    async (client) => {
      const { rows } = await client.execute(statement)
      const { cookies } = getBrowsingSession()
      const outcomes = await Promise.all(
        rows.map((row) => writeCookie(cookies, parseCookieRow(row), key))
      )
      const imported = outcomes.filter(Boolean).length

      return {
        failed: outcomes.length - imported,
        imported,
        total: outcomes.length
      }
    }
  )

  // Counts and the source browser only — no hosts, no names, no values.
  logger.info("browser_cookie_import_completed", {
    browser: source.browser.id,
    failed: result.failed,
    imported: result.imported,
    total: result.total
  })

  return result
}
