import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type { RtkTokenSavingsRecentCommand } from "@etyon/rpc"
import { createClient } from "@libsql/client"

import { normalizeRtkCommandLabel } from "@/renderer/lib/token-savings/command-label"

const DEFAULT_RECENT_COMMAND_LIMIT = 10

const getDefaultRtkHistoryDbPath = (homeDir: string): string => {
  switch (process.platform) {
    case "darwin": {
      return path.join(homeDir, "Library/Application Support/rtk/history.db")
    }
    case "win32": {
      const appData =
        process.env.APPDATA ?? path.join(homeDir, "AppData", "Roaming")

      return path.join(appData, "rtk", "history.db")
    }
    default: {
      return path.join(homeDir, ".local/share/rtk/history.db")
    }
  }
}

export const getRtkHistoryDbPath = (): string | null => {
  const envPath = process.env.RTK_DB_PATH?.trim()

  if (envPath) {
    return envPath
  }

  return getDefaultRtkHistoryDbPath(os.homedir())
}

export const formatRtkTimestampLabel = (timestamp: string): string => {
  const parsedDate = new Date(timestamp)

  if (Number.isNaN(parsedDate.getTime())) {
    return timestamp
  }

  const month = String(parsedDate.getMonth() + 1).padStart(2, "0")
  const day = String(parsedDate.getDate()).padStart(2, "0")
  const hours = String(parsedDate.getHours()).padStart(2, "0")
  const minutes = String(parsedDate.getMinutes()).padStart(2, "0")

  return `${month}-${day} ${hours}:${minutes}`
}

const toNonNegativeInteger = (value: number): number =>
  Math.max(0, Math.round(Number.isFinite(value) ? value : 0))

export const loadRecentCommandsFromHistoryDb = async (
  limit = DEFAULT_RECENT_COMMAND_LIMIT
): Promise<RtkTokenSavingsRecentCommand[]> => {
  const dbPath = getRtkHistoryDbPath()

  if (!dbPath || !fs.existsSync(dbPath)) {
    return []
  }

  const client = createClient({
    url: `file:${dbPath}`
  })

  try {
    const result = await client.execute({
      args: [limit],
      sql: `SELECT original_cmd, timestamp, saved_tokens, savings_pct
            FROM commands
            ORDER BY timestamp DESC
            LIMIT ?`
    })

    return result.rows.map((row) => ({
      command: normalizeRtkCommandLabel(String(row.original_cmd ?? "")),
      reductionPercent: Number(row.savings_pct ?? 0),
      savedTokens: toNonNegativeInteger(Number(row.saved_tokens ?? 0)),
      timestampLabel: formatRtkTimestampLabel(String(row.timestamp ?? ""))
    }))
  } finally {
    client.close()
  }
}
