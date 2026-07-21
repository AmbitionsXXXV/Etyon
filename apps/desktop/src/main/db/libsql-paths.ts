import path from "node:path"

import { getAppConfigDir } from "@/main/app-paths"

const DATABASE_FILENAME = "etyon.sqlite" as const

export const getDatabaseFilePath = (homeDir: string): string =>
  path.join(getAppConfigDir(homeDir), DATABASE_FILENAME)

export const getDatabaseUrl = (homeDir: string): string =>
  `file:${getDatabaseFilePath(homeDir)}`
