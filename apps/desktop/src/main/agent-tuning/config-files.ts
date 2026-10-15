/**
 * Text edits for the agents' own config files, the places magpie's tune
 * writes (internal/agent/tune.go): Claude Code's settings.json
 * `modelSettings.<model>.autoCompactWindow` and Codex's config.toml top-level
 * `model_auto_compact_token_limit`. Pure: text in, text out.
 */

export const CLAUDE_COMPACT_ENV = "CLAUDE_CODE_AUTO_COMPACT_WINDOW"
export const CODEX_COMPACT_KEY = "model_auto_compact_token_limit"

type JsonObject = Record<string, unknown>

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const parseSettings = (text: string): JsonObject => {
  if (!text.trim()) {
    return {}
  }
  const value: unknown = JSON.parse(text)
  if (!isObject(value)) {
    throw new Error("settings.json is not a JSON object.")
  }
  return value
}

const toPositiveNumber = (value: unknown): number | null => {
  const number = typeof value === "string" ? Number(value) : value
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? number
    : null
}

export interface ClaudeCompactSetting {
  /** The variable that overrides the setting, when one is set. */
  lockedBy: string | null
  source: "env" | "model" | "settings" | null
  value: number | null
}

const isEnvOn = (value: unknown): boolean =>
  typeof value === "string" &&
  value !== "" &&
  value !== "0" &&
  value !== "false"

/**
 * Claude Code's compact window for a model: the overriding variable first
 * (in settings.json's env block or the environment), then the model's own
 * entry, then the top-level window that serves every model.
 */
export const readClaudeCompactSetting = (
  settingsText: string,
  modelName: string,
  env: Record<string, string | undefined>
): ClaudeCompactSetting => {
  const settings = parseSettings(settingsText)
  const envBlock = isObject(settings.env) ? settings.env : {}
  const envValue = envBlock[CLAUDE_COMPACT_ENV] ?? env[CLAUDE_COMPACT_ENV]

  if (isEnvOn(envValue)) {
    return {
      lockedBy: CLAUDE_COMPACT_ENV,
      source: "env",
      value: toPositiveNumber(envValue)
    }
  }

  const modelSettings = isObject(settings.modelSettings)
    ? settings.modelSettings
    : {}
  const entry = modelSettings[modelName]
  const modelValue = isObject(entry)
    ? toPositiveNumber(entry.autoCompactWindow)
    : null

  if (modelValue !== null) {
    return { lockedBy: null, source: "model", value: modelValue }
  }

  const topValue = toPositiveNumber(settings.autoCompactWindow)
  return topValue === null
    ? { lockedBy: null, source: null, value: null }
    : { lockedBy: null, source: "settings", value: topValue }
}

/** Sets (or, with null, removes) a model's window, keeping every other key. */
export const writeClaudeCompactWindow = (
  settingsText: string,
  modelName: string,
  value: number | null
): string => {
  const settings = parseSettings(settingsText)
  const modelSettings = isObject(settings.modelSettings)
    ? { ...settings.modelSettings }
    : {}
  const entry = isObject(modelSettings[modelName])
    ? { ...(modelSettings[modelName] as JsonObject) }
    : {}

  if (value === null) {
    delete entry.autoCompactWindow
  } else {
    entry.autoCompactWindow = value
  }

  const otherModels = Object.fromEntries(
    Object.entries(modelSettings).filter(([name]) => name !== modelName)
  )
  const nextModelSettings =
    Object.keys(entry).length > 0
      ? { ...otherModels, [modelName]: entry }
      : otherModels

  const next: JsonObject = { ...settings, modelSettings: nextModelSettings }
  if (Object.keys(nextModelSettings).length === 0) {
    delete next.modelSettings
  }

  return `${JSON.stringify(next, null, 2)}\n`
}

const TABLE_HEADER_PATTERN = /^\s*\[/u

const keyLinePattern = (key: string): RegExp =>
  new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*(?:#.*)?$`, "u")

/** The top-level lines: everything before the first table header. */
const topLevelEnd = (lines: readonly string[]): number => {
  const index = lines.findIndex((line) => TABLE_HEADER_PATTERN.test(line))
  return index === -1 ? lines.length : index
}

/** A top-level number in a TOML file; null when unset or not a number. */
export const readTomlTopNumber = (text: string, key: string): number | null => {
  const lines = text.split("\n")
  const pattern = keyLinePattern(key)
  for (const line of lines.slice(0, topLevelEnd(lines))) {
    const match = pattern.exec(line)
    if (match) {
      return toPositiveNumber(Number(match[1]?.replaceAll("_", "")))
    }
  }
  return null
}

/**
 * Sets (or, with null, removes) a top-level number. A new key goes after the
 * existing top-level lines, before the first table, so it stays top-level.
 */
export const writeTomlTopNumber = (
  text: string,
  key: string,
  value: number | null
): string => {
  const lines = text.split("\n")
  const end = topLevelEnd(lines)
  const pattern = keyLinePattern(key)
  const existing = lines.slice(0, end).findIndex((line) => pattern.test(line))

  if (existing !== -1) {
    if (value === null) {
      lines.splice(existing, 1)
    } else {
      lines[existing] = `${key} = ${value}`
    }
    return lines.join("\n")
  }

  if (value === null) {
    return text
  }

  let insertAt = end
  while (insertAt > 0 && lines[insertAt - 1]?.trim() === "") {
    insertAt -= 1
  }
  lines.splice(insertAt, 0, `${key} = ${value}`)
  return lines.join("\n")
}
