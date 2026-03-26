import fs from "node:fs"
import path from "node:path"

import { migrate } from "drizzle-orm/libsql/migrator"
import { app } from "electron"

import { getDb } from "@/main/db"

let databaseReadyPromise: Promise<void> | undefined

const resolveMigrationsFolderPath = (): string =>
  path.join(app.getAppPath(), "drizzle")

const assertMigrationsFolderReady = (migrationsFolderPath: string): void => {
  const migrationJournalPath = path.join(
    migrationsFolderPath,
    "meta",
    "_journal.json"
  )

  if (!fs.existsSync(migrationJournalPath)) {
    throw new Error(
      `Missing Drizzle migration journal at ${migrationJournalPath}`
    )
  }
}

export const ensureDatabaseReady = async (): Promise<void> => {
  if (!databaseReadyPromise) {
    databaseReadyPromise = (async () => {
      const migrationsFolderPath = resolveMigrationsFolderPath()

      assertMigrationsFolderReady(migrationsFolderPath)

      await migrate(getDb(), {
        migrationsFolder: migrationsFolderPath
      })
    })()
  }

  await databaseReadyPromise
}
