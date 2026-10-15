import type { ReplayCall } from "@/shared/tuning/compact-replay"

/**
 * Readers for the session files Claude Code and Codex write, turning them into
 * the calls the compact replay works on (magpie internal/sessions/calls.go,
 * pared down to what tuning needs). Pure: lines in (streamed, so large files never sit in memory whole), calls out.
 */

const CLAUDE_MODEL_PATTERN =
  /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:[^0-9]|$)/u

/**
 * The name Claude Code's `modelSettings` uses for a model, e.g.
 * "claude-opus-5-5" for "claude-opus-5.5[1m]"; null for a non-Claude model.
 */
export const claudeModelSettingsName = (model: string): string | null => {
  const match = CLAUDE_MODEL_PATTERN.exec(
    model.toLowerCase().replaceAll(".", "-")
  )

  if (!match) {
    return null
  }

  const [, family, major, minor] = match
  return minor
    ? `claude-${family}-${major}-${minor}`
    : `claude-${family}-${major}`
}

const parseLine = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

const timeOf = (line: Record<string, unknown>): number =>
  typeof line.timestamp === "string" ? Date.parse(line.timestamp) : Number.NaN

/** One assistant line as a call, or null for any other line or one too old. */
const readClaudeAssistantLine = (
  raw: string,
  { sinceMs, stream }: { sinceMs: number; stream: string }
): { call: ReplayCall; messageId: string } | null => {
  if (!raw.includes('"assistant"') || !raw.includes('"usage"')) {
    return null
  }

  const line = parseLine(raw)
  const message = asRecord(line?.message)
  const usage = asRecord(message.usage)
  const model = typeof message.model === "string" ? message.model : ""
  const time = line ? timeOf(line) : Number.NaN

  if (
    line?.type !== "assistant" ||
    !model ||
    model === "<synthetic>" ||
    !Number.isFinite(time) ||
    time < sinceMs
  ) {
    return null
  }

  const creation = asRecord(usage.cache_creation)
  const wrote1h = asNumber(creation.ephemeral_1h_input_tokens)
  const wrote = Math.max(
    asNumber(usage.cache_creation_input_tokens),
    asNumber(creation.ephemeral_5m_input_tokens) + wrote1h
  )

  return {
    call: {
      compactMs: 0,
      model,
      out: asNumber(usage.output_tokens),
      prompt:
        asNumber(usage.input_tokens) +
        asNumber(usage.cache_read_input_tokens) +
        wrote,
      stream,
      time,
      wrote,
      wrote1h
    },
    messageId: typeof message.id === "string" ? message.id : ""
  }
}

/**
 * One Claude Code session file. A reply is written as several lines sharing
 * its message id, the last carrying the final usage; a `compact_boundary`
 * line times the compaction, which lands on the next call.
 */
export const parseClaudeSessionLines = async (
  lines: AsyncIterable<string> | Iterable<string>,
  { sinceMs, stream }: { sinceMs: number; stream: string }
): Promise<ReplayCall[]> => {
  const calls: ReplayCall[] = []
  const indexByMessage = new Map<string, number>()
  let pendingCompactMs = 0

  for await (const raw of lines) {
    if (raw.includes('"compact_boundary"')) {
      const meta = asRecord(parseLine(raw)?.compactMetadata)
      pendingCompactMs = asNumber(meta.durationMs) || pendingCompactMs
      continue
    }

    const reading = readClaudeAssistantLine(raw, { sinceMs, stream })

    if (!reading) {
      continue
    }

    const { call, messageId } = reading
    const existing = messageId ? indexByMessage.get(messageId) : undefined

    if (existing === undefined) {
      call.compactMs = pendingCompactMs
      pendingCompactMs = 0
      if (messageId) {
        indexByMessage.set(messageId, calls.length)
      }
      calls.push(call)
    } else {
      calls[existing] = { ...call, compactMs: calls[existing]?.compactMs ?? 0 }
    }
  }

  return calls.filter((call) => call.prompt > 0)
}

export interface CodexRolloutReading {
  calls: ReplayCall[]
  /** The largest model window the rollout reported. */
  contextWindow: number
}

/**
 * One Codex rollout. A call is wherever the running total in `token_count`
 * grew; its prompt is the call's whole input (cached tokens included).
 * Compactions need no marker: the replay reads them from the prompt's drop.
 */
export const parseCodexRolloutLines = async (
  lines: AsyncIterable<string> | Iterable<string>,
  { sinceMs, stream }: { sinceMs: number; stream: string }
): Promise<CodexRolloutReading> => {
  const calls: ReplayCall[] = []
  let model = ""
  let lastTotal = 0
  let contextWindow = 0

  for await (const raw of lines) {
    const isTurnContext = raw.includes('"turn_context"')
    const isSettings = raw.includes('"thread_settings_applied"')
    const isCount = raw.includes('"token_count"')

    if (!isTurnContext && !isSettings && !isCount) {
      continue
    }

    const line = parseLine(raw)
    const payload = asRecord(line?.payload)

    if (isTurnContext && typeof payload.model === "string") {
      model = payload.model || model
      continue
    }

    if (isSettings) {
      const settings = asRecord(payload.thread_settings)
      model = typeof settings.model === "string" ? settings.model : model
      continue
    }

    const info = asRecord(payload.info)
    const total = asNumber(asRecord(info.total_token_usage).total_tokens)
    const last = asRecord(info.last_token_usage)
    contextWindow = Math.max(contextWindow, asNumber(info.model_context_window))

    if (payload.type !== "token_count" || total <= lastTotal) {
      continue
    }

    lastTotal = total
    const time = line ? timeOf(line) : Number.NaN

    if (!Number.isFinite(time) || time < sinceMs || !model) {
      continue
    }

    calls.push({
      compactMs: 0,
      model,
      out: asNumber(last.output_tokens),
      prompt: asNumber(last.input_tokens),
      stream,
      time,
      wrote: asNumber(last.cache_write_input_tokens),
      wrote1h: 0
    })
  }

  return { calls: calls.filter((call) => call.prompt > 0), contextWindow }
}
