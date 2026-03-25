import fs from "node:fs"

import { afterAll, describe, expect, it, vi } from "vitest"

import drizzleConfig from "../../../drizzle.config"
import { getDbClient, verifyDatabaseConnection } from "./index"
import { getDatabaseFilePath } from "./libsql-paths"

const { mockedHomeDir } = vi.hoisted(() => ({
  mockedHomeDir: `/tmp/etyon-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: {
    dev: true
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  },
  platform: {
    isLinux: true,
    isMacOS: false,
    isWindows: false
  }
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => []
  },
  app: {
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: {
    on: vi.fn()
  }
}))

describe("database infrastructure", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("opens the local sqlite file and executes a health query", async () => {
    const databaseFilePath = getDatabaseFilePath(mockedHomeDir)

    await verifyDatabaseConnection()

    const result = await getDbClient().execute("select 1 as value")

    expect(fs.existsSync(databaseFilePath)).toBe(true)
    expect(result.rows).toHaveLength(1)
  })

  it("uses drizzle-kit config for a local sqlite file", () => {
    if (!("dbCredentials" in drizzleConfig)) {
      throw new Error("drizzle config is missing dbCredentials")
    }

    expect((drizzleConfig.dbCredentials as { url: string }).url).toContain(
      "file:"
    )
    expect((drizzleConfig.dbCredentials as { url: string }).url).toContain(
      ".config/etyon/etyon.sqlite"
    )
    expect(drizzleConfig.dialect).toBe("sqlite")
    expect(drizzleConfig.out).toBe("./drizzle")
    expect(drizzleConfig.schema).toBe("./src/main/db/schema.ts")
  })
})
