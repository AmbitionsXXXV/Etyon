import type { ChatCompactAdvice } from "@etyon/rpc"
import { and, eq, gte } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { agentEvents, agentRuns } from "@/main/db/schema"
import { resolveModelContextWindow } from "@/main/server/lib/providers"
import { getSettings } from "@/main/settings"
import { adviseCompactWindow } from "@/shared/tuning/compact-replay"
import type { ReplayCall } from "@/shared/tuning/compact-replay"

/**
 * The auto-compact threshold that would have cost Etyon's own chats the
 * fewest tokens, replayed from the token usage each agent step recorded —
 * the same replay "Tuned for you" runs on Claude Code and Codex. Null when
 * the default model has fewer than 50 steps with token counts.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const ADVICE_DAYS = 30
const PERCENT = 100
const MIN_THRESHOLD_PERCENT = 20
const STEPS_PER_WINDOW = 50

const readStepTokens = (
  payloadJson: string
): { input: number; output: number } | null => {
  try {
    const payload: unknown = JSON.parse(payloadJson)
    if (typeof payload !== "object" || payload === null) {
      return null
    }
    const { inputTokens, outputTokens } = payload as Record<string, unknown>
    return typeof inputTokens === "number" && inputTokens > 0
      ? {
          input: inputTokens,
          output: typeof outputTokens === "number" ? outputTokens : 0
        }
      : null
  } catch {
    return null
  }
}

export const getChatCompactAdvice = async (
  db: AppDatabase
): Promise<ChatCompactAdvice | null> => {
  const settings = getSettings()
  const model = settings.ai.defaultModel
  const window = resolveModelContextWindow(model || null)

  if (!model || !window) {
    return null
  }

  const since = new Date(Date.now() - ADVICE_DAYS * DAY_MS).toISOString()
  const rows = await db
    .select({
      createdAt: agentEvents.createdAt,
      payloadJson: agentEvents.payloadJson,
      sessionId: agentRuns.chatSessionId
    })
    .from(agentEvents)
    .innerJoin(agentRuns, eq(agentRuns.id, agentEvents.runId))
    .where(
      and(
        eq(agentEvents.type, "step.finished"),
        eq(agentRuns.modelId, model),
        gte(agentEvents.createdAt, since)
      )
    )
  const calls: ReplayCall[] = rows.flatMap((row) => {
    const tokens = readStepTokens(row.payloadJson)
    return tokens
      ? [
          {
            compactMs: 0,
            model,
            out: tokens.output,
            prompt: tokens.input,
            stream: row.sessionId,
            time: Date.parse(row.createdAt),
            wrote: 0,
            wrote1h: 0
          }
        ]
      : []
  })
  const step = Math.max(1000, Math.round(window / STEPS_PER_WINDOW))
  const advice = adviseCompactWindow(calls, {
    current: Math.round(
      (settings.chat.autoCompact.threshold / PERCENT) * window
    ),
    max: window,
    min: Math.round((MIN_THRESHOLD_PERCENT / PERCENT) * window),
    reserve: 0,
    step,
    window
  })

  return advice
    ? {
        calls: advice.facts.calls,
        saving:
          advice.cost > 0
            ? Math.max(0, (advice.cost - advice.low) / advice.cost)
            : 0,
        thresholdPercent: Math.min(
          95,
          Math.round((advice.best / window) * PERCENT)
        )
      }
    : null
}
