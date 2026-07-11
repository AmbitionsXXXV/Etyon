import type {
  FinishReason,
  LanguageModel,
  ModelMessage,
  ToolSet,
  UIMessage,
  UIMessageStreamWriter
} from "ai"
import { stepCountIs, streamText } from "ai"

import { CHAT_RUN_LIMIT_DATA_TYPE } from "@/shared/chat/stream-data"
import type { ChatRunLimitData } from "@/shared/chat/stream-data"
import type { EffortProviderOptions } from "@/shared/providers/model-effort"

/**
 * Self-owned agent loop (replaces the Mastra `handleChatStream` bridge).
 *
 * The harness — not the framework — owns the continue-or-stop decision, in the
 * style of Claude Code's core query loop. Each iteration is exactly one model
 * round-trip (`stopWhen: stepCountIs(1)`); the AI SDK executes non-gated tool
 * calls inside the iteration, and the loop decides what happens next:
 *
 * - `tool-calls` finish → continue, until `maxSteps` is reached, which is
 *   surfaced to the user as a `data-run-limit` part instead of ending silently
 * - approval requested → exit `suspended`; the durable approval resumes the
 *   run in a later request through the persisted message history
 * - `stop` finish whose final text announces an imminent action the model
 *   never executed → inject one corrective nudge message and continue
 *   (single-shot latch, so a model that keeps announcing cannot loop)
 * - provider/stream error → exit `model-error` so the run can be settled as
 *   failed instead of a silent "succeeded"
 * - abort → exit `aborted`
 */

export type AgentLoopExitReason =
  | "aborted"
  | "completed"
  | "max-steps"
  | "model-error"
  | "suspended"

export interface AgentLoopOutcome {
  errorMessage: string | null
  exitReason: AgentLoopExitReason
  finishReason: FinishReason | null
  nudged: boolean
  stepCount: number
}

export interface AgentLoopStep {
  finishReason: FinishReason
  stepIndex: number
  toolCallCount: number
}

export interface RunAgentLoopOptions {
  abortSignal?: AbortSignal
  describeError?: (error: unknown) => string
  maxSteps: number
  messages: readonly ModelMessage[]
  model: LanguageModel
  /** Best-effort per-step observer (event store); errors are swallowed. */
  onStepFinish?: (step: AgentLoopStep) => Promise<void> | void
  /** Reasoning-effort provider options for the resolved agent model. */
  providerOptions?: EffortProviderOptions
  system?: string
  /** Optional pass-through tap over each merged UI stream (thinking timings). */
  tapUiStream?: <TChunk>(
    stream: ReadableStream<TChunk>
  ) => ReadableStream<TChunk>
  tools: ToolSet
  writer: UIMessageStreamWriter<UIMessage>
}

// Advice directed at the user ("请先检查…", "you can first…") is not an
// announcement of the agent's own next action.
const ADVICE_LOOKBEHIND = "(?<!请|你|您|可以|建议|推荐)"
const CLOSING_IDIOM_PATTERN =
  /(让我知道|告诉我|随时(找|叫|问)我|let me know|feel free|don'?t hesitate)/iu
const ANNOUNCE_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `${ADVICE_LOOKBEHIND}(先|我先|我来|我会|让我|接下来|然后我|现在我?)[^。！？!?\\n]{0,40}(确认|检查|查看|读取|扫描|分析|生成|创建|开始|执行|运行|列出|搜索|整理|统计|写入|准备)[^。！？!?\\n]{0,60}[。.…]?\\s*$`,
    "u"
  ),
  /\b(let me|i(?:'|’)ll|i will|i am going to|next,? i|first,? i(?:'|’)ll)\b[^.!?\n]{0,80}[.…]?\s*$/iu
]
const ANNOUNCE_TAIL_CHARS = 200

/**
 * True when the final sentence of an assistant text reads like "I will now do
 * X" — the preamble-then-stop failure mode. Heuristic by design: a false
 * positive costs one extra model round (bounded by the nudge latch), a false
 * negative falls back to the prompt-level turn discipline.
 */
export const announcesImminentAction = (text: string): boolean => {
  const tail = text.trim().slice(-ANNOUNCE_TAIL_CHARS)

  if (tail.length === 0 || CLOSING_IDIOM_PATTERN.test(tail)) {
    return false
  }

  return ANNOUNCE_PATTERNS.some((pattern) => pattern.test(tail))
}

const NUDGE_MESSAGE: ModelMessage = {
  content:
    "You ended your turn immediately after announcing an action without executing it. Continue now: call the tool you announced. If nothing is actually left to execute, give your final answer plainly without announcing further actions.",
  role: "user"
}

const getStepText = (content: readonly { type: string }[]): string =>
  content
    .filter(
      (part): part is { text: string; type: "text" } => part.type === "text"
    )
    .map((part) => part.text)
    .join("")

const describeUnknownError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

type StepDecision =
  | { kind: "continue" }
  | { kind: "exit"; exitReason: AgentLoopExitReason }
  | { kind: "limit" }
  | { kind: "nudge" }

/** Pure continue-or-stop decision for one completed model round-trip. */
const evaluateStep = ({
  content,
  finishReason,
  maxSteps,
  nudged,
  stepIndex,
  toolCallCount
}: {
  content: readonly { type: string }[]
  finishReason: FinishReason
  maxSteps: number
  nudged: boolean
  stepIndex: number
  toolCallCount: number
}): StepDecision => {
  if (content.some((part) => part.type === "tool-approval-request")) {
    return { exitReason: "suspended", kind: "exit" }
  }

  if (finishReason === "tool-calls") {
    return stepIndex >= maxSteps ? { kind: "limit" } : { kind: "continue" }
  }

  if (finishReason === "error") {
    return { exitReason: "model-error", kind: "exit" }
  }

  const shouldNudge =
    finishReason === "stop" &&
    !nudged &&
    toolCallCount === 0 &&
    announcesImminentAction(getStepText(content))

  return shouldNudge
    ? { kind: "nudge" }
    : { exitReason: "completed", kind: "exit" }
}

export const runAgentLoop = async ({
  abortSignal,
  describeError = describeUnknownError,
  maxSteps,
  messages,
  model,
  onStepFinish,
  providerOptions,
  system,
  tapUiStream,
  tools,
  writer
}: RunAgentLoopOptions): Promise<AgentLoopOutcome> => {
  const history: ModelMessage[] = [...messages]
  let stepIndex = 0
  let nudged = false
  let lastFinishReason: FinishReason | null = null
  let lastStreamError: unknown

  const captureStreamError = (event: { error: unknown }): void => {
    lastStreamError = event.error
  }

  const buildOutcome = (
    exitReason: AgentLoopExitReason,
    errorMessage: string | null = null
  ): AgentLoopOutcome => {
    // Close the assistant UI message on every exit path (iterations stream
    // with sendFinish: false). The stream may already be gone on abort.
    try {
      writer.write({ type: "finish" })
    } catch {
      // Stream already closed.
    }

    return {
      errorMessage,
      exitReason,
      finishReason: lastFinishReason,
      nudged,
      stepCount: stepIndex
    }
  }

  while (true) {
    if (abortSignal?.aborted) {
      return buildOutcome("aborted")
    }

    try {
      const result = streamText({
        ...(abortSignal ? { abortSignal } : {}),
        messages: history,
        model,
        onError: captureStreamError,
        ...(providerOptions ? { providerOptions } : {}),
        stopWhen: stepCountIs(1),
        ...(system ? { system } : {}),
        tools
      })

      // Provider errors surface as in-stream error parts (finishReason
      // "error"), so forward the app's error formatter instead of the SDK's
      // masked default.
      const uiStream = result.toUIMessageStream({
        onError: describeError,
        sendFinish: false,
        sendReasoning: true,
        sendStart: stepIndex === 0
      })
      writer.merge(tapUiStream ? tapUiStream(uiStream) : uiStream)

      const [content, finishReason, response] = await Promise.all([
        result.content,
        result.finishReason,
        result.response
      ])

      stepIndex += 1
      lastFinishReason = finishReason
      history.push(...response.messages)

      const toolCallCount = content.filter(
        (part) => part.type === "tool-call"
      ).length

      try {
        await onStepFinish?.({ finishReason, stepIndex, toolCallCount })
      } catch {
        // Observability must never break the run.
      }

      const decision = evaluateStep({
        content,
        finishReason,
        maxSteps,
        nudged,
        stepIndex,
        toolCallCount
      })

      if (decision.kind === "continue") {
        continue
      }

      if (decision.kind === "limit") {
        writer.write({
          data: { maxSteps } satisfies ChatRunLimitData,
          type: CHAT_RUN_LIMIT_DATA_TYPE
        })

        return buildOutcome("max-steps")
      }

      if (decision.kind === "nudge") {
        nudged = true
        history.push(NUDGE_MESSAGE)
        continue
      }

      if (decision.exitReason === "model-error") {
        return buildOutcome(
          "model-error",
          lastStreamError === undefined
            ? "The model stream reported an error."
            : describeError(lastStreamError)
        )
      }

      return buildOutcome(decision.exitReason)
    } catch (error) {
      if (abortSignal?.aborted) {
        return buildOutcome("aborted")
      }

      // Prefer the underlying stream error (captured via onError) over the
      // SDK's generic "no output generated" rejection.
      const errorMessage = describeError(lastStreamError ?? error)

      writer.write({ errorText: errorMessage, type: "error" })

      return buildOutcome("model-error", errorMessage)
    }
  }
}
