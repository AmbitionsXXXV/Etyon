import fs from "node:fs"
import path from "node:path"

import { createClient } from "@libsql/client"
import type { Client } from "@libsql/client"
import type { LibSQLDatabase } from "drizzle-orm/libsql"
import { drizzle } from "drizzle-orm/libsql/node"
import { app } from "electron"

import { getDatabaseFilePath, getDatabaseUrl } from "@/main/db/libsql-paths"
import { schema } from "@/main/db/schema"
import { logger } from "@/main/logger"

export type AppDatabase = LibSQLDatabase<typeof schema>

let client: Client | undefined
let database: AppDatabase | undefined

const resolveDatabaseFilePath = (): string =>
  getDatabaseFilePath(app.getPath("home"))

export const ensureDatabaseDirectory = (): void => {
  const databaseFilePath = resolveDatabaseFilePath()
  const databaseDir = path.dirname(databaseFilePath)

  if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true })
  }
}

export const getDbClient = (): Client => {
  ensureDatabaseDirectory()

  if (!client) {
    const initializedClient = createClient({
      url: getDatabaseUrl(app.getPath("home"))
    })
    client = initializedClient
    // Concurrent agent runs (delegation, workflow children) settle on this
    // shared connection while the parent turn is still writing its own events;
    // without a busy timeout libsql rejects the racing write with SQLITE_BUSY
    // and the child run is orphaned at "running". A few seconds of retry easily
    // covers a millisecond-scale write. Fired once on the singleton connection;
    // libsql serializes it ahead of any later query.
    void (async () => {
      try {
        await initializedClient.execute("PRAGMA busy_timeout = 5000")
      } catch (error) {
        logger.error("db_busy_timeout_pragma_failed", { error })
      }
    })()
  }

  return client
}

export const getDb = (): AppDatabase => {
  if (!database) {
    database = drizzle(getDbClient(), { schema })
  }

  return database
}

export const verifyDatabaseConnection = async (): Promise<void> => {
  await getDbClient().execute("select 1")
}
