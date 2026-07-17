import type { AppSettings } from "@etyon/rpc"
import { generateText } from "ai"

import {
  buildChatCompactionPrompt,
  buildMemoryQueryRewritePrompt,
  buildMemorySummarizationPrompt,
  CHAT_COMPACTION_SYSTEM_PROMPT,
  MEMORY_QUERY_REWRITE_SYSTEM_PROMPT,
  MEMORY_SUMMARIZATION_SYSTEM_PROMPT
} from "@/main/memory/prompts"
import { resolveMemoryToolModel } from "@/main/memory/tool-model"

interface MemorySummarizationInput {
  fallbackContent: string
  heading: string
  projectPath: null | string
  settings: AppSettings
}

interface MemoryQueryRewriteInput {
  abortSignal?: AbortSignal
  query: string
  settings: AppSettings
}

interface ChatCompactionInput {
  fallbackContent: string
  settings: AppSettings
}

interface StructuredChatCompactionSummary {
  carryForward?: string[]
  summary?: string
}

interface StructuredMemorySummary {
  confidence?: number
  decisions?: string[]
  facts?: string[]
  procedures?: string[]
  summary?: string
}

const JSON_OBJECT_PATTERN = /\{[\s\S]*\}/u

const normalizeGeneratedText = (value: string): string =>
  value.replaceAll("```json", "```").replaceAll("```", "").trim()

const parseGeneratedJsonObject = (value: string): Record<string, unknown> => {
  const normalizedValue = normalizeGeneratedText(value)
  const [jsonText = normalizedValue] =
    normalizedValue.match(JSON_OBJECT_PATTERN) ?? []

  return JSON.parse(jsonText) as Record<string, unknown>
}

const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

const parseStructuredMemorySummary = (
  value: string
): StructuredMemorySummary => {
  const parsed = parseGeneratedJsonObject(value)
  const summary =
    typeof parsed.summary === "string" ? parsed.summary.trim() : ""
  const confidence =
    typeof parsed.confidence === "number" ? parsed.confidence : undefined

  return {
    ...(confidence === undefined ? {} : { confidence }),
    decisions: readStringArray(parsed.decisions),
    facts: readStringArray(parsed.facts),
    procedures: readStringArray(parsed.procedures),
    ...(summary ? { summary } : {})
  }
}

const parseStructuredChatCompactionSummary = (
  value: string
): StructuredChatCompactionSummary => {
  const parsed = parseGeneratedJsonObject(value)
  const summary =
    typeof parsed.summary === "string" ? parsed.summary.trim() : ""

  return {
    carryForward: readStringArray(parsed.carryForward),
    ...(summary ? { summary } : {})
  }
}

const formatStringList = (items: string[]): string[] =>
  items.map((item) => `- ${item}`)

const formatStructuredChatCompactionSummary = ({
  fallbackContent,
  summary
}: {
  fallbackContent: string
  summary: StructuredChatCompactionSummary
}): string => {
  const sections = [
    "Auto compacted conversation summary:",
    summary.summary ? `Summary: ${summary.summary}` : "",
    summary.carryForward?.length
      ? ["Carry forward:", ...formatStringList(summary.carryForward)].join("\n")
      : ""
  ].filter(Boolean)

  if (sections.length <= 1) {
    return fallbackContent
  }

  return sections.join("\n")
}

const formatStructuredMemorySummary = ({
  fallbackContent,
  heading,
  summary
}: {
  fallbackContent: string
  heading: string
  summary: StructuredMemorySummary
}): string => {
  const sections = [
    heading,
    summary.summary ? `Summary: ${summary.summary}` : "",
    summary.decisions?.length
      ? ["Decisions:", ...formatStringList(summary.decisions)].join("\n")
      : "",
    summary.facts?.length
      ? ["Facts:", ...formatStringList(summary.facts)].join("\n")
      : "",
    summary.procedures?.length
      ? ["Procedures:", ...formatStringList(summary.procedures)].join("\n")
      : "",
    typeof summary.confidence === "number"
      ? `Confidence: ${Math.max(0, Math.min(1, summary.confidence)).toFixed(2)}`
      : ""
  ].filter(Boolean)

  if (sections.length <= 1) {
    return fallbackContent
  }

  return sections.join("\n")
}

const generateMemoryToolText = async ({
  abortSignal,
  prompt,
  settings,
  system
}: {
  abortSignal?: AbortSignal
  prompt: string
  settings: AppSettings
  system: string
}): Promise<null | string> => {
  const resolution = resolveMemoryToolModel(settings)

  if (!resolution.modelId) {
    return null
  }

  const { resolveModel } = await import("@/main/server/lib/providers")
  const result = await generateText({
    abortSignal,
    model: resolveModel(resolution.modelId),
    prompt,
    instructions: system
  })

  return result.text
}

export const summarizeChatCompaction = async ({
  fallbackContent,
  settings
}: ChatCompactionInput): Promise<string> => {
  try {
    const text = await generateMemoryToolText({
      prompt: buildChatCompactionPrompt(fallbackContent),
      settings,
      system: CHAT_COMPACTION_SYSTEM_PROMPT
    })

    if (!text) {
      return fallbackContent
    }

    return formatStructuredChatCompactionSummary({
      fallbackContent,
      summary: parseStructuredChatCompactionSummary(text)
    })
  } catch {
    return fallbackContent
  }
}

export const summarizeMemoryContent = async ({
  fallbackContent,
  heading,
  projectPath,
  settings
}: MemorySummarizationInput): Promise<string> => {
  if (!settings.memory.autoSummarize) {
    return fallbackContent
  }

  try {
    const text = await generateMemoryToolText({
      prompt: buildMemorySummarizationPrompt({
        fallbackContent,
        heading,
        projectPath
      }),
      settings,
      system: MEMORY_SUMMARIZATION_SYSTEM_PROMPT
    })

    if (!text) {
      return fallbackContent
    }

    return formatStructuredMemorySummary({
      fallbackContent,
      heading,
      summary: parseStructuredMemorySummary(text)
    })
  } catch {
    return fallbackContent
  }
}

export const rewriteMemoryQuery = async ({
  abortSignal,
  query,
  settings
}: MemoryQueryRewriteInput): Promise<string> => {
  const fallbackQuery = query.trim()

  if (!(fallbackQuery && settings.memory.queryRewriting)) {
    return query
  }

  try {
    const text = await generateMemoryToolText({
      abortSignal,
      prompt: buildMemoryQueryRewritePrompt(fallbackQuery),
      settings,
      system: MEMORY_QUERY_REWRITE_SYSTEM_PROMPT
    })

    if (!text) {
      return query
    }

    const parsed = parseGeneratedJsonObject(text)
    const rewrittenQuery =
      typeof parsed.query === "string" ? parsed.query.trim() : ""

    return rewrittenQuery || query
  } catch {
    return query
  }
}
