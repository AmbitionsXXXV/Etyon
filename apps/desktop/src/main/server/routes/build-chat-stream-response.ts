import type { AppSettings } from "@etyon/rpc"
import type { LanguageModel, ModelMessage, UIMessage } from "ai"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"

import type { streamAgentChat } from "@/main/agents/agent-runtime"
import { createAgentRuntimeState } from "@/main/agents/agent-state"
import type { AgentRuntimeState } from "@/main/agents/agent-state"
import {
  formatPromptTemplateInvocation,
  parseCommandArgs
} from "@/main/agents/prompt-templates"
import type { PromptTemplate } from "@/main/agents/prompt-templates"
import { attachWorkTimeToLatestAssistantMessage } from "@/shared/chat/message-metadata"
import { CHAT_REQUEST_PHASE_DATA_TYPE } from "@/shared/chat/stream-data"
import type { ChatRequestPhaseData } from "@/shared/chat/stream-data"

type StreamAgentChatResult = Awaited<ReturnType<typeof streamAgentChat>>

const PLAN_COMMAND_PATTERN = /^\/plan(?:\s+|$)/iu
const PLAN_MODE_FALLBACK_PROMPT = "Create a structured implementation plan."
const PLAN_MODE_ACTIVE_TOOL_NAMES = [
  "findFiles",
  "fileInfo",
  "searchFiles",
  "readFile",
  "gitDiff",
  "memorySearch"
] as const
const PLAN_MODE_SYSTEM_PROMPT = [
  "[PLAN MODE ACTIVE]",
  "Use read-only project evidence first.",
  "Return a numbered plan with action, files, and risk level for each item."
].join("\n")
const PROMPT_TEMPLATE_COMMAND_PATTERN = /^\/prompt(?:\s+|$)/iu
const PROMPT_TEMPLATE_FALLBACK_PROMPT =
  "Prompt template command was incomplete. Ask the user which template to use."

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const stripPlanCommand = (text: string): string =>
  text.replace(PLAN_COMMAND_PATTERN, "").trim()

const stripPromptTemplateCommand = (text: string): string =>
  text.replace(PROMPT_TEMPLATE_COMMAND_PATTERN, "").trim()

const getUiMessageText = (message: UIMessage): string =>
  message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
    .trim()

const isPlanModeRequest = (messages: UIMessage[]): boolean => {
  const latestUserMessage = messages.findLast(
    (message) => message.role === "user"
  )

  return latestUserMessage
    ? PLAN_COMMAND_PATTERN.test(getUiMessageText(latestUserMessage))
    : false
}

const stripPlanCommandFromModelMessage = (
  message: ModelMessage
): ModelMessage => {
  if (message.role !== "user") {
    return message
  }

  if (typeof message.content === "string") {
    return {
      ...message,
      content: stripPlanCommand(message.content) || PLAN_MODE_FALLBACK_PROMPT
    }
  }

  if (!Array.isArray(message.content)) {
    return message
  }

  let stripped = false
  const content = message.content.map((part) => {
    if (
      stripped ||
      !isRecord(part) ||
      part.type !== "text" ||
      typeof part.text !== "string" ||
      !PLAN_COMMAND_PATTERN.test(part.text)
    ) {
      return part
    }

    stripped = true

    return {
      ...part,
      text: stripPlanCommand(part.text) || PLAN_MODE_FALLBACK_PROMPT
    }
  })

  return stripped
    ? {
        ...message,
        content
      }
    : message
}

const stripPlanCommandFromLatestModelMessage = (
  modelMessages: ModelMessage[]
): ModelMessage[] => {
  const latestUserMessageIndex = modelMessages.findLastIndex(
    (message) => message.role === "user"
  )

  if (latestUserMessageIndex === -1) {
    return modelMessages
  }

  return modelMessages.map((message, index) =>
    index === latestUserMessageIndex
      ? stripPlanCommandFromModelMessage(message)
      : message
  )
}

const findPromptTemplate = ({
  name,
  promptTemplates
}: {
  name: string
  promptTemplates: readonly PromptTemplate[]
}): PromptTemplate | null => {
  const normalizedName = name.toLowerCase()

  return (
    promptTemplates.find(
      (template) => template.name.toLowerCase() === normalizedName
    ) ?? null
  )
}

const resolvePromptTemplateCommandText = ({
  promptTemplates,
  text
}: {
  promptTemplates: readonly PromptTemplate[]
  text: string
}): string => {
  const commandText = stripPromptTemplateCommand(text)

  if (commandText.length === 0) {
    return PROMPT_TEMPLATE_FALLBACK_PROMPT
  }

  try {
    const [templateName, ...args] = parseCommandArgs(commandText)

    if (!templateName) {
      return PROMPT_TEMPLATE_FALLBACK_PROMPT
    }

    const template = findPromptTemplate({
      name: templateName,
      promptTemplates
    })

    if (!template) {
      return `Prompt template not found: ${templateName}. Ask the user to choose an available template.`
    }

    return formatPromptTemplateInvocation(template, args)
  } catch (error) {
    return `Prompt template command could not be parsed: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}

const applyPromptTemplateCommandToModelMessage = ({
  message,
  promptTemplates
}: {
  message: ModelMessage
  promptTemplates: readonly PromptTemplate[]
}): ModelMessage => {
  if (message.role !== "user") {
    return message
  }

  if (typeof message.content === "string") {
    if (!PROMPT_TEMPLATE_COMMAND_PATTERN.test(message.content)) {
      return message
    }

    return {
      ...message,
      content: resolvePromptTemplateCommandText({
        promptTemplates,
        text: message.content
      })
    }
  }

  if (!Array.isArray(message.content)) {
    return message
  }

  let replaced = false
  const content = message.content.map((part) => {
    if (
      replaced ||
      !isRecord(part) ||
      part.type !== "text" ||
      typeof part.text !== "string" ||
      !PROMPT_TEMPLATE_COMMAND_PATTERN.test(part.text)
    ) {
      return part
    }

    replaced = true

    return {
      ...part,
      text: resolvePromptTemplateCommandText({
        promptTemplates,
        text: part.text
      })
    }
  })

  return replaced
    ? {
        ...message,
        content
      }
    : message
}

const applyPromptTemplateCommandToLatestModelMessage = ({
  modelMessages,
  promptTemplates
}: {
  modelMessages: ModelMessage[]
  promptTemplates: readonly PromptTemplate[]
}): ModelMessage[] => {
  const latestUserMessageIndex = modelMessages.findLastIndex(
    (message) => message.role === "user"
  )

  if (latestUserMessageIndex === -1) {
    return modelMessages
  }

  return modelMessages.map((message, index) =>
    index === latestUserMessageIndex
      ? applyPromptTemplateCommandToModelMessage({
          message,
          promptTemplates
        })
      : message
  )
}

const applyPlanModeRequest = ({
  messages,
  modelMessages,
  settings,
  systemPrompts
}: {
  messages: UIMessage[]
  modelMessages: ModelMessage[]
  settings: AppSettings
  systemPrompts: string[]
}): {
  activeToolNames?: readonly string[]
  modelMessages: ModelMessage[]
  settings: AppSettings
  systemPrompts: string[]
} => {
  if (!isPlanModeRequest(messages)) {
    return {
      activeToolNames: undefined,
      modelMessages,
      settings,
      systemPrompts
    }
  }

  return {
    activeToolNames: PLAN_MODE_ACTIVE_TOOL_NAMES,
    modelMessages: stripPlanCommandFromLatestModelMessage(modelMessages),
    settings: {
      ...settings,
      agents: {
        ...settings.agents,
        allowSubagentDelegation: false,
        defaultProfileId: "plan",
        enabled: true
      }
    },
    systemPrompts: [...systemPrompts, PLAN_MODE_SYSTEM_PROMPT]
  }
}

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

const writeAgentRuntimePhase = (
  writer: Parameters<typeof writeRequestPhase>[0],
  runtimeState: AgentRuntimeState
): (() => void) =>
  runtimeState.subscribe(({ phase }) => {
    if (phase === "turn") {
      writeRequestPhase(writer, "agent-turn")
    }
  })

export interface BuildChatStreamResponseOptions {
  abortSignal: AbortSignal
  buildLongTermMemorySystem: () => Promise<string>
  messages: UIMessage[]
  model: LanguageModel
  modelId: string | null
  modelMessages: ModelMessage[]
  moonshotReasoningForAssistantToolCalls: readonly string[]
  onFinishPersist: (messages: UIMessage[]) => Promise<void>
  projectPath: string
  promptTemplates?: readonly PromptTemplate[]
  requestStartedAt: number
  sessionId: string
  settings: AppSettings
  shouldRetrieveLongTermMemory: boolean
  skillCapabilities?: readonly string[]
  streamAgentChat: (
    options: Parameters<typeof streamAgentChat>[0]
  ) => Promise<StreamAgentChatResult>
  systemPrompts: string[]
  db: Parameters<typeof streamAgentChat>[0]["db"]
}

export const buildChatStreamResponse = ({
  abortSignal,
  buildLongTermMemorySystem,
  db,
  messages,
  model,
  modelId,
  modelMessages,
  moonshotReasoningForAssistantToolCalls,
  onFinishPersist,
  projectPath,
  promptTemplates = [],
  requestStartedAt,
  sessionId,
  settings,
  shouldRetrieveLongTermMemory,
  skillCapabilities,
  streamAgentChat: runStreamAgentChat,
  systemPrompts
}: BuildChatStreamResponseOptions): Response => {
  const planModeRequest = applyPlanModeRequest({
    messages,
    modelMessages: applyPromptTemplateCommandToLatestModelMessage({
      modelMessages,
      promptTemplates
    }),
    settings,
    systemPrompts
  })

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        if (shouldRetrieveLongTermMemory) {
          writeRequestPhase(writer, "memory-loading")
        }

        const longTermMemorySystem = shouldRetrieveLongTermMemory
          ? await buildLongTermMemorySystem()
          : ""
        const effectiveSystemPrompts = [
          ...planModeRequest.systemPrompts,
          longTermMemorySystem
        ].filter((prompt) => prompt.length > 0)

        writeRequestPhase(writer, "model-start")

        const runtimeState = createAgentRuntimeState()
        const unsubscribeRuntimeState = writeAgentRuntimePhase(
          writer,
          runtimeState
        )
        const { runWithMoonshotReasoningContext } =
          await import("@/shared/providers/moonshot-reasoning")
        const result = await runWithMoonshotReasoningContext(
          moonshotReasoningForAssistantToolCalls,
          () =>
            runStreamAgentChat({
              abortSignal,
              activeToolNames: planModeRequest.activeToolNames,
              db,
              messages: planModeRequest.modelMessages,
              model,
              modelId,
              projectPath,
              runtimeState,
              sessionId,
              settings: planModeRequest.settings,
              skillCapabilities,
              systemPrompts: effectiveSystemPrompts
            })
        ).finally(unsubscribeRuntimeState)

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
}
