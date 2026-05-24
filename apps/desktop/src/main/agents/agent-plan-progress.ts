import * as z from "zod"

const PLAN_DONE_MARKER_PATTERN = /\[DONE:([1-9]\d*)\]/gu
const RETRYABLE_AGENT_FAILURE_PATTERN =
  /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/iu
const STRUCTURED_PLAN_JSON_BLOCK_PATTERN = /```(?:json)?\s*([\s\S]*?)```/iu
const CONTEXT_OVERFLOW_FAILURE_PATTERN =
  /context (?:length|window)|maximum context|token limit|prompt too long|request too large/iu
const DEFAULT_PLAN_STEP_FAILURE_RETRY_DELAY_MS = 1000

const StructuredPlanStepSchema = z.object({
  action: z.string().min(1),
  files: z.array(z.string().min(1)),
  riskLevel: z.enum(["high", "low", "medium"]),
  stepNumber: z.number().int().positive()
})

const StructuredPlanSchema = z.object({
  items: z.array(StructuredPlanStepSchema).min(1)
})

export type AgentStructuredPlan = z.infer<typeof StructuredPlanSchema>

export interface AgentPlanProgressMarker {
  index: number
  marker: string
  stepNumber: number
}

export interface AgentPlanProgressSummary {
  completedCount: number
  completedStepNumbers: number[]
  latestCompletedStepNumber: number | null
}

export type AgentPlanStepFailureAction = "abort" | "retry" | "skip"

export interface AgentPlanStepFailureDecision {
  action: AgentPlanStepFailureAction
  delayMs: number
  reason: "fail-fast" | "retryable-failure" | "skip-failed-step"
}

export interface ResolvePlanStepFailureActionOptions {
  baseDelayMs?: number
  failedAttempts: number
  failFast: boolean
  maxRetries: number
  retryable: boolean
}

export const parsePlanProgressMarkers = (
  text: string
): AgentPlanProgressMarker[] =>
  Array.from(text.matchAll(PLAN_DONE_MARKER_PATTERN), (match) => ({
    index: match.index ?? 0,
    marker: match[0],
    stepNumber: Number(match[1])
  }))

export const summarizePlanProgress = (
  text: string
): AgentPlanProgressSummary => {
  const completedStepNumbers = [
    ...new Set(
      parsePlanProgressMarkers(text).map((marker) => marker.stepNumber)
    )
  ].toSorted((left, right) => left - right)

  return {
    completedCount: completedStepNumbers.length,
    completedStepNumbers,
    latestCompletedStepNumber: completedStepNumbers.at(-1) ?? null
  }
}

export const stripPlanProgressMarkers = (text: string): string =>
  text
    .replaceAll(PLAN_DONE_MARKER_PATTERN, "")
    .replaceAll(/[ \t]+(?=\n|$)/gu, "")

const extractStructuredPlanJsonText = (text: string): string | null => {
  const fencedJson = text.match(STRUCTURED_PLAN_JSON_BLOCK_PATTERN)?.[1]?.trim()

  if (fencedJson) {
    return fencedJson
  }

  const trimmedText = text.trim()

  return trimmedText.startsWith("{") ? trimmedText : null
}

export const parseStructuredPlanFromText = (
  text: string
): AgentStructuredPlan | null => {
  const jsonText = extractStructuredPlanJsonText(text)

  if (!jsonText) {
    return null
  }

  try {
    const payload = JSON.parse(jsonText) as unknown
    const result = StructuredPlanSchema.safeParse(payload)

    return result.success ? result.data : null
  } catch {
    return null
  }
}

export const isRetryableAgentFailure = (message: string): boolean =>
  RETRYABLE_AGENT_FAILURE_PATTERN.test(message) &&
  !CONTEXT_OVERFLOW_FAILURE_PATTERN.test(message)

export const resolvePlanStepFailureAction = ({
  baseDelayMs = DEFAULT_PLAN_STEP_FAILURE_RETRY_DELAY_MS,
  failedAttempts,
  failFast,
  maxRetries,
  retryable
}: ResolvePlanStepFailureActionOptions): AgentPlanStepFailureDecision => {
  const boundedBaseDelayMs = Math.max(0, baseDelayMs)
  const boundedFailedAttempts = Math.max(1, failedAttempts)
  const boundedMaxRetries = Math.max(0, maxRetries)

  if (retryable && boundedFailedAttempts <= boundedMaxRetries) {
    return {
      action: "retry",
      delayMs: boundedBaseDelayMs * 2 ** (boundedFailedAttempts - 1),
      reason: "retryable-failure"
    }
  }

  if (failFast) {
    return {
      action: "abort",
      delayMs: 0,
      reason: "fail-fast"
    }
  }

  return {
    action: "skip",
    delayMs: 0,
    reason: "skip-failed-step"
  }
}
