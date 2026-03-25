import path from "node:path"

const APP_CONFIG_DIR_SEGMENTS = [".config", "etyon"] as const
const DATABASE_FILENAME = "etyon.sqlite" as const

export const getAppConfigDir = (homeDir: string): string =>
  path.join(homeDir, ...APP_CONFIG_DIR_SEGMENTS)

export const getDatabaseFilePath = (homeDir: string): string =>
  path.join(getAppConfigDir(homeDir), DATABASE_FILENAME)

export const getDatabaseUrl = (homeDir: string): string =>
  `file:${getDatabaseFilePath(homeDir)}`
