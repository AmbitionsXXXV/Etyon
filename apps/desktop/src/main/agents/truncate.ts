export const AGENT_TOOL_OUTPUT_MAX_CHARS = 12_000

const BYTE_UNIT_BASE = 1024
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const
const DEFAULT_MAX_FRACTION_DIGITS = 1
const DEFAULT_TOOL_RESULT_SUMMARY_CACHE_ENTRIES = 100
const TRAILING_ZERO_FRACTION_PATTERN = /\.0$/u
const TRUNCATE_LINE_BREAK_PATTERN = /\r?\n/u

export interface AgentTruncatedText {
  content: string
  truncated: boolean
}

export interface AgentToolResultSummary {
  content: string
  omittedChars: number
  totalChars: number
  truncated: boolean
}

export interface AgentToolResultSummaryCacheEntry {
  id: string
  summary: AgentToolResultSummary
}

export interface AgentToolResultSummaryCache {
  clear: () => void
  entries: () => AgentToolResultSummaryCacheEntry[]
  get: (id: string) => AgentToolResultSummary | undefined
  set: (id: string, content: string) => AgentToolResultSummary
}

export interface CreateToolResultSummaryCacheOptions {
  maxChars?: number
  maxEntries?: number
}

const normalizeMaxChars = (maxChars: number): number =>
  Math.max(0, Math.floor(maxChars))

const toCodePoints = (content: string): string[] => [...content]

const formatUnitValue = (value: number): string =>
  value
    .toFixed(DEFAULT_MAX_FRACTION_DIGITS)
    .replace(TRAILING_ZERO_FRACTION_PATTERN, "")

export const truncateTail = (
  content: string,
  maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS
): AgentTruncatedText => {
  const normalizedMaxChars = normalizeMaxChars(maxChars)
  const codePoints = toCodePoints(content)

  if (codePoints.length <= normalizedMaxChars) {
    return {
      content,
      truncated: false
    }
  }

  return {
    content: codePoints.slice(0, normalizedMaxChars).join(""),
    truncated: true
  }
}

export const truncateHead = (
  content: string,
  maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS
): AgentTruncatedText => {
  const normalizedMaxChars = normalizeMaxChars(maxChars)
  const codePoints = toCodePoints(content)

  if (codePoints.length <= normalizedMaxChars) {
    return {
      content,
      truncated: false
    }
  }

  return {
    content: codePoints.slice(-normalizedMaxChars).join(""),
    truncated: true
  }
}

export const truncateLine = (
  content: string,
  maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS
): AgentTruncatedText => {
  let truncated = false
  const lines = content.split(TRUNCATE_LINE_BREAK_PATTERN)
  const truncatedLines = lines.map((line) => {
    const result = truncateTail(line, maxChars)
    truncated = truncated || result.truncated

    return result.content
  })

  return {
    content: truncatedLines.join("\n"),
    truncated
  }
}

export const clampToolOutput = truncateTail

export const summarizeToolResult = (
  content: string,
  maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS
): AgentToolResultSummary => {
  const preview = truncateTail(content, maxChars)
  const previewChars = toCodePoints(preview.content).length
  const totalChars = toCodePoints(content).length

  return {
    content: preview.content,
    omittedChars: totalChars - previewChars,
    totalChars,
    truncated: preview.truncated
  }
}

export const createToolResultSummaryCache = ({
  maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS,
  maxEntries = DEFAULT_TOOL_RESULT_SUMMARY_CACHE_ENTRIES
}: CreateToolResultSummaryCacheOptions = {}): AgentToolResultSummaryCache => {
  const normalizedMaxEntries = Math.max(0, Math.floor(maxEntries))
  const summaries = new Map<string, AgentToolResultSummary>()

  const get = (id: string): AgentToolResultSummary | undefined => {
    const summary = summaries.get(id)

    if (!summary) {
      return undefined
    }

    summaries.delete(id)
    summaries.set(id, summary)

    return summary
  }

  const set = (id: string, content: string): AgentToolResultSummary => {
    const summary = summarizeToolResult(content, maxChars)

    if (normalizedMaxEntries === 0) {
      return summary
    }

    summaries.delete(id)
    summaries.set(id, summary)

    while (summaries.size > normalizedMaxEntries) {
      const oldestId = summaries.keys().next().value

      if (oldestId === undefined) {
        break
      }

      summaries.delete(oldestId)
    }

    return summary
  }

  return {
    clear: () => summaries.clear(),
    entries: () =>
      Array.from(summaries, ([id, summary]) => ({
        id,
        summary
      })),
    get,
    set
  }
}

export const formatSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B"
  }

  let unitIndex = 0
  let value = bytes

  while (value >= BYTE_UNIT_BASE && unitIndex < BYTE_UNITS.length - 1) {
    value /= BYTE_UNIT_BASE
    unitIndex += 1
  }

  return `${formatUnitValue(value)} ${BYTE_UNITS[unitIndex]}`
}
