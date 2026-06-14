import fs from "node:fs"
import path from "node:path"

import { afterAll, describe, expect, it, vi } from "vite-plus/test"

const { mockedHomeDir } = vi.hoisted(() => ({
  mockedHomeDir: `/tmp/etyon-local-connection-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

vi.mock("electron", () => ({
  app: { getPath: () => mockedHomeDir }
}))

const isPosix = process.platform !== "win32"
const connectionFilePath = path.join(
  mockedHomeDir,
  ".config",
  "etyon",
  "connection.json"
)

// Returns the last 3 octal digits of a file mode (e.g. "600", "644").
const permBits = (filePath: string): string =>
  fs.statSync(filePath).mode.toString(8).slice(-3)

afterAll(() => {
  fs.rmSync(mockedHomeDir, { force: true, recursive: true })
})

describe("writeLocalConnectionFile", () => {
  it("writes the token file with owner-only permissions", async () => {
    const { writeLocalConnectionFile } = await import("@/main/local-connection")

    writeLocalConnectionFile("http://127.0.0.1:1234")

    expect(fs.existsSync(connectionFilePath)).toBe(true)

    if (isPosix) {
      const bits = permBits(connectionFilePath)

      // no group/other access; owner read+write
      expect(bits).toBe("600")
    }
  })

  it("tightens permissions when overwriting a pre-existing world-readable file", async () => {
    if (!isPosix) {
      return
    }

    const { writeLocalConnectionFile } = await import("@/main/local-connection")

    fs.mkdirSync(path.dirname(connectionFilePath), { recursive: true })
    fs.writeFileSync(connectionFilePath, "{}", { mode: 0o644 })
    fs.chmodSync(connectionFilePath, 0o644)

    writeLocalConnectionFile("http://127.0.0.1:5678")

    expect(permBits(connectionFilePath)).toBe("600")
  })
})
