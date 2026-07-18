/**
 * Resolves whether Forge is producing a development or release build. Release
 * identity is opt-in through env (`ELECTRON_FORGE_BUILD_IDENTIFIER` /
 * `ETYON_BUILD_IDENTIFIER`, `ETYON_RELEASE` / `RELEASE`, `NODE_ENV`) with a
 * fallback sniff of the npm lifecycle event / argv for release-shaped commands,
 * so `electron-forge start` stays a development build by default.
 */

export type BuildIdentifier = "development" | "release"

const RELEASE_COMMANDS = new Set([
  "build",
  "make",
  "package",
  "publish",
  "release"
])
const RELEASE_ENV_VALUES = new Set(["1", "production", "release", "true"])

const normalizeEnvValue = (value: string | undefined): string | undefined =>
  value?.trim().toLowerCase()

const hasReleaseCommandArg = (): boolean => {
  for (const arg of process.argv) {
    if (RELEASE_COMMANDS.has(arg)) {
      return true
    }
  }

  return false
}

export const resolveBuildIdentifier = (): BuildIdentifier => {
  const explicitBuildIdentifier = normalizeEnvValue(
    process.env.ELECTRON_FORGE_BUILD_IDENTIFIER ??
      process.env.ETYON_BUILD_IDENTIFIER
  )

  if (explicitBuildIdentifier === "development") {
    return "development"
  }

  if (explicitBuildIdentifier === "release") {
    return "release"
  }

  const explicitReleaseFlag = normalizeEnvValue(
    process.env.ETYON_RELEASE ?? process.env.RELEASE
  )

  if (explicitReleaseFlag && RELEASE_ENV_VALUES.has(explicitReleaseFlag)) {
    return "release"
  }

  if (normalizeEnvValue(process.env.NODE_ENV) === "production") {
    return "release"
  }

  const lifecycleEvent = normalizeEnvValue(process.env.npm_lifecycle_event)

  if (lifecycleEvent && RELEASE_COMMANDS.has(lifecycleEvent)) {
    return "release"
  }

  return hasReleaseCommandArg() ? "release" : "development"
}
