import type { AppSettings } from "@etyon/rpc"
import type { LanguageModel, ModelMessage, UIMessage } from "ai"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"

import type { streamAgentChat } from "@/main/agents/agent-runtime"
import { attachWorkTimeToLatestAssistantMessage } from "@/shared/chat/message-metadata"
import { CHAT_REQUEST_PHASE_DATA_TYPE } from "@/shared/chat/stream-data"
import type { ChatRequestPhaseData } from "@/shared/chat/stream-data"

type StreamAgentChatResult = Awaited<ReturnType<typeof streamAgentChat>>

const writeRequestPhase = (
  writer: {
    write: (part: {
      data: ChatRequestPhaseData
      transient?: boolean
      type: typeof CHAT_REQUEST_PHASE_DATA_TYPE
    }) => void
  },
  phase: ChatRequestPhaseData["phase"]
): void => {
  writer.write({
    data: {
      phase
    },
    transient: true,
    type: CHAT_REQUEST_PHASE_DATA_TYPE
  })
}

export interface BuildChatStreamResponseOptions {
  buildLongTermMemorySystem: () => Promise<string>
  messages: UIMessage[]
  model: LanguageModel
  modelId: string | null
  modelMessages: ModelMessage[]
  moonshotReasoningForAssistantToolCalls: readonly string[]
  onFinishPersist: (messages: UIMessage[]) => Promise<void>
  projectPath: string
  requestStartedAt: number
  sessionId: string
  settings: AppSettings
  shouldRetrieveLongTermMemory: boolean
  streamAgentChat: (options: {
    db: Parameters<typeof streamAgentChat>[0]["db"]
    messages: ModelMessage[]
    model: LanguageModel
    modelId: string | null
    projectPath: string
    sessionId: string
    settings: AppSettings
    systemPrompts: string[]
  }) => Promise<StreamAgentChatResult>
  systemPrompts: string[]
  db: Parameters<typeof streamAgentChat>[0]["db"]
}

export const buildChatStreamResponse = ({
  buildLongTermMemorySystem,
  db,
  messages,
  model,
  modelId,
  modelMessages,
  moonshotReasoningForAssistantToolCalls,
  onFinishPersist,
  projectPath,
  requestStartedAt,
  sessionId,
  settings,
  shouldRetrieveLongTermMemory,
  streamAgentChat: runStreamAgentChat,
  systemPrompts
}: BuildChatStreamResponseOptions): Response =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        if (shouldRetrieveLongTermMemory) {
          writeRequestPhase(writer, "memory-loading")
        }

        const longTermMemorySystem = shouldRetrieveLongTermMemory
          ? await buildLongTermMemorySystem()
          : ""
        const effectiveSystemPrompts = [
          ...systemPrompts,
          longTermMemorySystem
        ].filter((prompt) => prompt.length > 0)

        writeRequestPhase(writer, "model-start")

        const { runWithMoonshotReasoningContext } =
          await import("@/shared/providers/moonshot-reasoning")
        const result = await runWithMoonshotReasoningContext(
          moonshotReasoningForAssistantToolCalls,
          () =>
            runStreamAgentChat({
              db,
              messages: modelMessages,
              model,
              modelId,
              projectPath,
              sessionId,
              settings,
              systemPrompts: effectiveSystemPrompts
            })
        )

        writer.merge(
          result.toUIMessageStream({
            sendReasoning: true
          })
        )
      },
      onFinish: async ({ messages: nextMessages }) => {
        const workTimeMs = Date.now() - requestStartedAt

        await onFinishPersist(
          attachWorkTimeToLatestAssistantMessage(nextMessages, workTimeMs)
        )
      },
      originalMessages: messages
    })
  })
