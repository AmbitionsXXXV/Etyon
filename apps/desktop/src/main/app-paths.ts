import path from "node:path"

export type RuntimeBuildIdentifier = "development" | "release"

const APP_CONFIG_ROOT_DIRECTORY = ".config" as const
const DEVELOPMENT_DIRECTORY_NAME = "etyon-dev" as const
const LOGS_DIRECTORY_NAME = "logs" as const
const RELEASE_DIRECTORY_NAME = "etyon" as const

export const getRuntimeBuildIdentifier = (): RuntimeBuildIdentifier =>
  process.env.ETYON_BUILD_IDENTIFIER === "release" ? "release" : "development"

export const getAppDirectoryName = (
  buildIdentifier: RuntimeBuildIdentifier = getRuntimeBuildIdentifier()
): string =>
  buildIdentifier === "release"
    ? RELEASE_DIRECTORY_NAME
    : DEVELOPMENT_DIRECTORY_NAME

export const getAppConfigDir = (
  homeDir: string,
  buildIdentifier: RuntimeBuildIdentifier = getRuntimeBuildIdentifier()
): string =>
  path.join(
    homeDir,
    APP_CONFIG_ROOT_DIRECTORY,
    getAppDirectoryName(buildIdentifier)
  )

export const getAppLogDir = (
  homeDir: string,
  buildIdentifier: RuntimeBuildIdentifier = getRuntimeBuildIdentifier()
): string =>
  path.join(
    homeDir,
    `.${getAppDirectoryName(buildIdentifier)}`,
    LOGS_DIRECTORY_NAME
  )

export const getElectronUserDataDir = (
  appDataDir: string,
  buildIdentifier: RuntimeBuildIdentifier = getRuntimeBuildIdentifier()
): string => path.join(appDataDir, getAppDirectoryName(buildIdentifier))

export const isRuntimeReleaseBuild = (): boolean =>
  getRuntimeBuildIdentifier() === "release"
