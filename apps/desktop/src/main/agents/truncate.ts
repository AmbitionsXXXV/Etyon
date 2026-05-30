export const AGENT_TOOL_OUTPUT_MAX_CHARS = 12_000

const BYTE_UNIT_BASE = 1024
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const
const DEFAULT_MAX_FRACTION_DIGITS = 1
const DEFAULT_TOOL_RESULT_SUMMARY_CACHE_ENTRIES = 100
const DEFAULT_TOOL_RESULT_SUMMARY_PROCESSOR_MAX_CHARS = 2_000
const TRAILING_ZERO_FRACTION_PATTERN = /\.0$/u
const TRUNCATE_LINE_BREAK_PATTERN = /\r?\n/u

export interface AgentTruncatedText {
  content: string
  truncated: boolean
}

export interface AgentToolResultSummary {
  content: string
  omittedChars: number
  processor?: "deterministic" | "model"
  processorErrorMessage?: string
  totalChars: number
  truncated: boolean
}

export interface AgentToolResultSummaryAnnotationOptions {
  fullOutputPath?: string
  label?: string
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
  setWithProcessor: (
    id: string,
    content: string,
    options: SummarizeToolResultWithProcessorOptions
  ) => Promise<AgentToolResultSummary>
}

export interface CreateToolResultSummaryCacheOptions {
  maxChars?: number
  maxEntries?: number
}

export interface AgentToolResultSummaryProcessorInput {
  content: string
  deterministicSummary: AgentToolResultSummary
  id?: string
  maxSummaryChars: number
}

export interface AgentToolResultSummaryProcessorResult {
  content: string
}

export type AgentToolResultSummaryProcessor = (
  input: AgentToolResultSummaryProcessorInput
) =>
  | AgentToolResultSummaryProcessorResult
  | Promise<AgentToolResultSummaryProcessorResult | null | string>
  | string
  | null

export interface SummarizeToolResultWithProcessorOptions {
  maxChars?: number
  maxProcessorSummaryChars?: number
  processor?: AgentToolResultSummaryProcessor
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
    truncated ||= result.truncated

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

const getProcessorSummaryContent = (
  result: AgentToolResultSummaryProcessorResult | string | null
): string | null => {
  if (!result) {
    return null
  }

  return typeof result === "string" ? result : result.content
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const summarizeToolResultWithProcessor = async (
  content: string,
  {
    maxChars = AGENT_TOOL_OUTPUT_MAX_CHARS,
    maxProcessorSummaryChars = DEFAULT_TOOL_RESULT_SUMMARY_PROCESSOR_MAX_CHARS,
    processor
  }: SummarizeToolResultWithProcessorOptions = {}
): Promise<AgentToolResultSummary> => {
  const deterministicSummary = summarizeToolResult(content, maxChars)

  if (!deterministicSummary.truncated || !processor) {
    return {
      ...deterministicSummary,
      processor: "deterministic"
    }
  }

  try {
    const result = await processor({
      content,
      deterministicSummary,
      maxSummaryChars: normalizeMaxChars(maxProcessorSummaryChars)
    })
    const processorContent = getProcessorSummaryContent(result)?.trim()

    if (!processorContent) {
      return {
        ...deterministicSummary,
        processor: "deterministic"
      }
    }

    const boundedProcessorContent = truncateTail(
      processorContent,
      maxProcessorSummaryChars
    )

    return {
      ...deterministicSummary,
      content: boundedProcessorContent.content,
      processor: "model"
    }
  } catch (error) {
    return {
      ...deterministicSummary,
      processor: "deterministic",
      processorErrorMessage: getErrorMessage(error)
    }
  }
}

export const formatToolResultSummaryAnnotation = (
  summary: AgentToolResultSummary,
  options: AgentToolResultSummaryAnnotationOptions = {}
): string => {
  if (!summary.truncated) {
    return ""
  }

  const labelPrefix = options.label ? `${options.label} ` : ""
  const processorSuffix =
    summary.processor === "model" ? "; model summary used" : ""
  const fullOutputSuffix = options.fullOutputPath
    ? `; full output saved to ${options.fullOutputPath}`
    : ""

  return `[${labelPrefix}truncated: omitted ${summary.omittedChars} of ${summary.totalChars} chars${processorSuffix}${fullOutputSuffix}]`
}

export const appendToolResultSummaryAnnotation = (
  content: string,
  summary: AgentToolResultSummary,
  options: AgentToolResultSummaryAnnotationOptions = {}
): string => {
  const annotation = formatToolResultSummaryAnnotation(summary, options)

  return annotation ? `${content}\n\n${annotation}` : content
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

  const setSummary = (
    id: string,
    summary: AgentToolResultSummary
  ): AgentToolResultSummary => {
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

  const set = (id: string, content: string): AgentToolResultSummary =>
    setSummary(id, summarizeToolResult(content, maxChars))

  return {
    clear: () => summaries.clear(),
    entries: () =>
      Array.from(summaries, ([id, summary]) => ({
        id,
        summary
      })),
    get,
    set,
    setWithProcessor: async (
      id,
      content,
      options
    ): Promise<AgentToolResultSummary> =>
      setSummary(
        id,
        await summarizeToolResultWithProcessor(content, {
          ...options,
          maxChars
        })
      )
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
