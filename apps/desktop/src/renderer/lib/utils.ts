export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const getString = (
  value: Record<string, unknown>,
  key: string
): string | undefined =>
  typeof value[key] === "string" ? (value[key] as string) : undefined

export const getNumber = (
  value: Record<string, unknown>,
  key: string
): number | undefined =>
  typeof value[key] === "number" ? (value[key] as number) : undefined

export const getBoolean = (
  value: Record<string, unknown>,
  key: string
): boolean | undefined =>
  typeof value[key] === "boolean" ? (value[key] as boolean) : undefined

export const formatDuration = (durationMs: number | undefined): string => {
  if (durationMs === undefined) {
    return ""
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`
  }

  return `${(durationMs / 1000).toFixed(1)} s`
}

/**
 * Compact elapsed-time label for the work section: `42s` under a minute,
 * `2m 2s` under an hour, `1h 3m` beyond. Rounds to whole seconds.
 */
export const formatElapsedDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))

  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  if (totalSeconds < 3600) {
    return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
  }

  const hours = Math.floor(totalSeconds / 3600)

  return `${hours}h ${Math.floor((totalSeconds % 3600) / 60)}m`
}

export const getPathBaseName = (value: string): string => {
  const normalizedPath = value.replaceAll("\\", "/")
  const pathParts = normalizedPath.split("/")

  return pathParts.at(-1) ?? value
}
