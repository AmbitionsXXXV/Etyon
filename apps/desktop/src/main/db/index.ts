import fs from "node:fs"
import path from "node:path"

import { createClient } from "@libsql/client"
import type { Client } from "@libsql/client"
import type { LibSQLDatabase } from "drizzle-orm/libsql"
import { drizzle } from "drizzle-orm/libsql/node"
import { app } from "electron"

import { getDatabaseFilePath, getDatabaseUrl } from "@/main/db/libsql-paths"
import { schema } from "@/main/db/schema"

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
    client = createClient({
      url: getDatabaseUrl(app.getPath("home"))
    })
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
