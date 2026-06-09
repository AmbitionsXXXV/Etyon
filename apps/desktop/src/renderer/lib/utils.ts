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

export const getPathBaseName = (value: string): string => {
  const normalizedPath = value.replaceAll("\\", "/")
  const pathParts = normalizedPath.split("/")

  return pathParts.at(-1) ?? value
}
