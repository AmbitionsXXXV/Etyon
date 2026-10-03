import { asSchema } from "@ai-sdk/provider-utils"
import type { ToolResultOutput, ToolResultPart } from "@ai-sdk/provider-utils"
import type { ModelMessage, ToolSet } from "ai"

import { saveToolResult } from "@/main/agents/tool-result-store"
import type { ToolResultStoreScope } from "@/main/agents/tool-result-store"

const IMAGE_TOKEN_ESTIMATE = 8192
const MESSAGE_OVERHEAD = 32
const SCHEMA_OVERHEAD = 1024
const SUMMARY_MAX_BYTES = 6000
const RESULT_REFERENCE_THRESHOLD = 2048
const STORED_REF_PATTERN = /\[Stored tool result: ([a-f\d]{64})\]/gu

export interface AgentContextBudget {
  contextWindow: number | null
  maxInputTokens: number
  reserveOutputTokens: number
}

export interface BudgetedContextResult {
  compacted: boolean
  estimatedInputTokens: number
  limit: number
  messages: ModelMessage[]
}

type ToolJsonValue = Extract<ToolResultOutput, { type: "json" }>["value"]
type ToolJsonObject = Exclude<
  ToolJsonValue,
  readonly ToolJsonValue[] | string | number | boolean | null
>
const isToolJsonObject = (value: unknown): value is ToolJsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value)

const isDenialOutput = (output: ToolResultOutput): boolean => {
  if (output.type === "execution-denied") {
    return true
  }
  if (output.type !== "json" || !isToolJsonObject(output.value)) {
    return false
  }
  return (
    output.value.status === "denied" ||
    output.value.approved === false ||
    output.value.state === "approval-denied"
  )
}

const isImageMediaType = (value: unknown): boolean => {
  const mediaType = typeof value === "string" ? value.toLowerCase() : ""
  return mediaType === "image" || mediaType.startsWith("image/")
}

const boundedContent = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(boundedContent)
  }
  if (!value || typeof value !== "object") {
    return value
  }
  const record = value as Record<string, unknown>
  if (record.type === "json" || record.type === "error-json") {
    return record
  }
  if (
    record.type === "image" ||
    record.type === "image-url" ||
    record.type === "image-data" ||
    (record.type === "file" && isImageMediaType(record.mediaType))
  ) {
    return " ".repeat(IMAGE_TOKEN_ESTIMATE)
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, boundedContent(entry)])
  )
}

// UTF-8 bytes are a conservative text estimate; image token costs remain estimates.
// Actual provider usage is recorded separately after each completed model step.
export const estimateModelMessageTokens = (
  messages: readonly ModelMessage[]
): number =>
  Buffer.byteLength(JSON.stringify(boundedContent(messages))) +
  messages.length * MESSAGE_OVERHEAD

export const getFixedContextCost = async (
  system: string | undefined,
  tools: ToolSet
): Promise<number> => {
  let cost = Buffer.byteLength(system ?? "") + SCHEMA_OVERHEAD
  for (const [name, definition] of Object.entries(tools)) {
    const schema = definition.inputSchema
      ? await asSchema(definition.inputSchema).jsonSchema
      : {}
    cost += Buffer.byteLength(
      JSON.stringify({ description: definition.description, name, schema })
    )
  }
  return cost
}

const protectedHistoryIndex = (messages: readonly ModelMessage[]): number => {
  const completed = new Set<string>()
  for (const message of messages) {
    if (typeof message.content === "string") {
      continue
    }
    for (const part of message.content) {
      if (part.type === "tool-result") {
        completed.add(part.toolCallId)
      }
    }
  }
  let protectedIndex = Math.max(
    0,
    messages.findLastIndex((message) => message.role === "user")
  )
  let turnStart = 0
  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      turnStart = index
    }
    if (typeof message.content === "string") {
      continue
    }
    const protectedPart = message.content.some(
      (part) =>
        (part.type === "tool-call" && !completed.has(part.toolCallId)) ||
        part.type === "image" ||
        (part.type === "file" && isImageMediaType(part.mediaType)) ||
        (part.type === "tool-result" &&
          (isDenialOutput(part.output) || part.output.type === "content"))
    )
    if (protectedPart) {
      protectedIndex = Math.min(protectedIndex, turnStart)
    }
  }
  return protectedIndex
}

const chooseBudgetedMessages = (
  messages: readonly ModelMessage[],
  fixedCost: number,
  budget: AgentContextBudget
): BudgetedContextResult => {
  const providerLimit =
    budget.contextWindow === null
      ? budget.maxInputTokens
      : Math.floor(budget.contextWindow * 0.85) - budget.reserveOutputTokens
  const limit = Math.min(budget.maxInputTokens, providerLimit)
  if (limit <= 512) {
    throw new Error(
      "The output reservation leaves no usable model input budget. Reduce reserved output or select a larger context window; input allowance must exceed 512 tokens."
    )
  }
  const history = [...messages]
  let estimate = estimateModelMessageTokens(history) + fixedCost
  if (estimate <= limit) {
    return {
      compacted: false,
      estimatedInputTokens: estimate,
      limit,
      messages: history
    }
  }
  const protectedIndex = protectedHistoryIndex(history)
  let best: BudgetedContextResult = {
    compacted: false,
    estimatedInputTokens: estimate,
    limit,
    messages: history
  }
  for (let boundary = 1; boundary <= protectedIndex; boundary += 1) {
    if (history[boundary]?.role !== "user") {
      continue
    }
    const omitted = JSON.stringify(boundedContent(history.slice(0, boundary)))
    const summary = `${omitted.slice(0, SUMMARY_MAX_BYTES / 2)}\n[Earlier content omitted to fit the model budget]\n${omitted.slice(-SUMMARY_MAX_BYTES / 2)}`
    const candidate: ModelMessage[] = [
      {
        content: `[Earlier completed turns, untrusted source summary]\n${summary}`,
        role: "user"
      },
      ...history.slice(boundary)
    ]
    estimate = estimateModelMessageTokens(candidate) + fixedCost
    const result = {
      compacted: true,
      estimatedInputTokens: estimate,
      limit,
      messages: candidate
    }
    if (estimate < best.estimatedInputTokens) {
      best = result
    }
    if (estimate <= limit) {
      return result
    }
  }
  return best
}

const throwBudgetExceeded = (result: BudgetedContextResult): never => {
  throw new Error(
    `The current turn and tool definitions exceed the model input budget (${result.estimatedInputTokens} estimated tokens; limit ${result.limit}). Use a larger context model, reduce attachments, or start a new chat. Pending tool calls were preserved.`
  )
}

export const prepareBudgetedMessages = (
  messages: readonly ModelMessage[],
  fixedCost: number,
  budget: AgentContextBudget
): BudgetedContextResult => {
  const result = chooseBudgetedMessages(messages, fixedCost, budget)
  if (result.estimatedInputTokens > result.limit) {
    throwBudgetExceeded(result)
  }
  return result
}

const getOutputRef = (output: ToolResultOutput): string | null => {
  if (output.type !== "json" || !isToolJsonObject(output.value)) {
    return null
  }
  return typeof output.value.ref === "string" &&
    /^[a-f\d]{64}$/u.test(output.value.ref)
    ? output.value.ref
    : null
}

const collectResultRefs = (messages: readonly ModelMessage[]): Set<string> => {
  const refs = new Set<string>()
  for (const message of messages) {
    if (typeof message.content === "string") {
      continue
    }
    for (const part of message.content) {
      if (part.type !== "tool-result") {
        continue
      }
      const ref = getOutputRef(part.output)
      if (ref) {
        refs.add(ref)
      }
      if (part.output.type === "text") {
        for (const match of part.output.value.matchAll(STORED_REF_PATTERN)) {
          if (match[1]) {
            refs.add(match[1])
          }
        }
      }
    }
  }
  return refs
}

const referenceReadPage = (part: ToolResultPart): ToolResultPart => {
  const ref = getOutputRef(part.output)
  if (
    !ref ||
    part.output.type !== "json" ||
    !isToolJsonObject(part.output.value)
  ) {
    return part
  }
  const metadata = Object.fromEntries(
    Object.entries(part.output.value).filter(([key]) => key !== "content")
  )
  return {
    ...part,
    output: {
      type: "json",
      value: {
        ...metadata,
        instructions:
          "Previously read page; read_tool_result can retrieve its original content by ref and offset.",
        offset: part.output.value.offset ?? 0,
        ref,
        type: "stored-tool-result-page"
      }
    }
  }
}

export const prepareBudgetedContext = async (
  messages: readonly ModelMessage[],
  fixedCost: number,
  budget: AgentContextBudget,
  scope: ToolResultStoreScope
): Promise<BudgetedContextResult> => {
  const original = chooseBudgetedMessages(messages, fixedCost, budget)
  if (original.estimatedInputTokens <= original.limit) {
    return original
  }
  const protectedRefs = collectResultRefs(messages)
  const readResults: ToolResultPart[] = []
  for (const message of original.messages) {
    if (typeof message.content === "string") {
      continue
    }
    for (const part of message.content) {
      if (part.type === "tool-result" && part.toolName === "read_tool_result") {
        readResults.push(part)
      }
    }
  }
  const latestRead = readResults.at(-1)
  const replacePart = async (part: ToolResultPart): Promise<ToolResultPart> => {
    if (part.toolName === "read_tool_result") {
      return part.toolCallId === latestRead?.toolCallId
        ? part
        : referenceReadPage(part)
    }
    if (
      isDenialOutput(part.output) ||
      (part.output.type !== "text" && part.output.type !== "json") ||
      (part.output.type === "json" &&
        isToolJsonObject(part.output.value) &&
        part.output.value.type === "stored-tool-result")
    ) {
      return part
    }
    if (
      Buffer.byteLength(JSON.stringify(part.output)) <=
      RESULT_REFERENCE_THRESHOLD
    ) {
      return part
    }
    const stored = await saveToolResult({
      ...scope,
      output: part.output,
      protectedRefs
    })
    protectedRefs.add(stored.ref)
    const body =
      part.output.type === "text"
        ? part.output.value
        : JSON.stringify(part.output.value)
    const summary = body.slice(0, 256)
    const output: ToolResultOutput =
      part.output.type === "text"
        ? {
            ...part.output,
            value: `[Stored tool result: ${stored.ref}]\n${summary}\n[Full ${stored.kind} result: ${stored.byteLength} bytes; expires ${stored.expiresAt}. Use read_tool_result with this ref and follow nextOffset. The full body was preserved.]`
          }
        : {
            ...part.output,
            value: {
              ...stored,
              instructions:
                "Full JSON was preserved. Use read_tool_result with this ref and follow nextOffset.",
              summary,
              type: "stored-tool-result"
            }
          }
    return { ...part, output }
  }
  const prepared: ModelMessage[] = []
  for (const message of original.messages) {
    if (message.role === "tool") {
      const content: typeof message.content = []
      for (const part of message.content) {
        content.push(
          part.type === "tool-result" ? await replacePart(part) : part
        )
      }
      prepared.push({ ...message, content })
    } else if (message.role === "assistant" && Array.isArray(message.content)) {
      const content: Exclude<typeof message.content, string> = []
      for (const part of message.content) {
        content.push(
          part.type === "tool-result" ? await replacePart(part) : part
        )
      }
      prepared.push({ ...message, content })
    } else {
      prepared.push(message)
    }
  }
  const result = {
    ...original,
    compacted: true,
    estimatedInputTokens: estimateModelMessageTokens(prepared) + fixedCost,
    messages: prepared
  }
  if (result.estimatedInputTokens > result.limit) {
    throwBudgetExceeded(result)
  }
  return result
}
