import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vite-plus/test"

import {
  formatRtkTimestampLabel,
  getRtkHistoryDbPath,
  loadRecentCommandsFromHistoryDb
} from "@/main/rtk-history-db"

const tempDatabasePaths: string[] = []

const createTempHistoryDatabase = (): string => {
  const databasePath = path.join(
    os.tmpdir(),
    `etyon-rtk-history-${crypto.randomUUID()}.db`
  )

  tempDatabasePaths.push(databasePath)

  return databasePath
}

afterEach(() => {
  for (const databasePath of tempDatabasePaths.splice(0)) {
    fs.rmSync(databasePath, { force: true })
  }
})

describe("rtk history db", () => {
  it("formats rtk timestamps for the recent commands table", () => {
    expect(formatRtkTimestampLabel("2026-05-19T15:30:12")).toBe("05-19 15:30")
  })

  it("prefers RTK_DB_PATH for the history database location", () => {
    const previousValue = process.env.RTK_DB_PATH

    process.env.RTK_DB_PATH = "/tmp/custom-rtk-history.db"
    expect(getRtkHistoryDbPath()).toBe("/tmp/custom-rtk-history.db")

    if (previousValue === undefined) {
      delete process.env.RTK_DB_PATH
    } else {
      process.env.RTK_DB_PATH = previousValue
    }
  })

  it("loads full original commands from the history database", async () => {
    const databasePath = createTempHistoryDatabase()
    const previousValue = process.env.RTK_DB_PATH

    process.env.RTK_DB_PATH = databasePath

    const { createClient } = await import("@libsql/client")
    const client = createClient({ url: `file:${databasePath}` })

    await client.execute(`
      CREATE TABLE commands (
        id INTEGER PRIMARY KEY,
        timestamp TEXT NOT NULL,
        original_cmd TEXT NOT NULL,
        rtk_cmd TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        saved_tokens INTEGER NOT NULL,
        savings_pct REAL NOT NULL
      )
    `)
    await client.execute({
      args: [
        "2026-05-19T15:30:00",
        "grep -r empty-state|emptyState /Users/example",
        "rtk grep -r empty-state|emptyState /Users/example",
        100,
        10,
        90,
        90
      ],
      sql: `INSERT INTO commands (
        timestamp,
        original_cmd,
        rtk_cmd,
        input_tokens,
        output_tokens,
        saved_tokens,
        savings_pct
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    })
    client.close()

    await expect(loadRecentCommandsFromHistoryDb(1)).resolves.toEqual([
      {
        command: "grep -r empty-state|emptyState /Users/example",
        reductionPercent: 90,
        savedTokens: 90,
        timestampLabel: "05-19 15:30"
      }
    ])

    if (previousValue === undefined) {
      delete process.env.RTK_DB_PATH
    } else {
      process.env.RTK_DB_PATH = previousValue
    }
  })
})
