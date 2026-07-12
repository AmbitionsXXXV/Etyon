import type { AppSettings, ChatMention } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { Hono } from "hono"

import { prepareAgentChatContext } from "@/main/agents/agent-chat-context"
import {
  getRunAssistantStartIndex,
  recordAgentRunOutcome,
  recordAgentRunStep,
  startAgentRun
} from "@/main/agents/agent-event-store"
import { replaceChatMessages } from "@/main/chat-messages"
import { getChatSessionById } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import { logger } from "@/main/logger"
import {
  isImageOutputModelSelection,
  resolveModel
} from "@/main/server/lib/providers"
import { buildChatStreamResponse } from "@/main/server/routes/build-chat-stream-response"
import {
  buildImageGenerationStreamResponse,
  getLatestUserMessageText
} from "@/main/server/routes/build-image-generation-response"
import { getSettings } from "@/main/settings"
import { isAgentPermissionMode } from "@/shared/agents/permission-mode"
import { resolveActiveProfile } from "@/shared/agents/profiles"
import {
  CHAT_IMAGEN_SYSTEM_PROMPT,
  CHAT_WORKFLOW_SYSTEM_PROMPT,
  getChatAgentModeAgentsEnabled,
  getChatAgentModeSystemPrompt,
  isChatAgentMode,
  isChatImagenCommandText,
  isChatPlanCommandText,
  isChatWorkflowCommandText
} from "@/shared/chat/agent-mode"
import type { ChatAgentMode } from "@/shared/chat/agent-mode"
import { attachAgentProjectionToAssistantMessages } from "@/shared/chat/message-metadata"
import { buildMoonshotReasoningForAssistantToolCalls } from "@/shared/providers/moonshot-reasoning"

const chatRoute = new Hono()

const isMoonshotModelId = (modelId: string | null | undefined): boolean =>
  typeof modelId === "string" && modelId.startsWith("moonshot/")

const applyChatAgentModeToSettings = ({
  agentMode,
  settings
}: {
  agentMode?: ChatAgentMode
  settings: AppSettings
}): AppSettings => {
  if (!agentMode) {
    return settings
  }

  return {
    ...settings,
    agents: {
      ...settings.agents,
      enabled: getChatAgentModeAgentsEnabled(agentMode)
    }
  }
}

// A typed `/plan` command forces plan mode for this turn; `/imagen` and
// `/workflow` force agent mode (tools on) so their tools are reachable. All
// override the composer's selected mode.
const resolveEffectiveAgentMode = ({
  composerMode,
  isImagenCommand,
  isPlanCommand,
  isWorkflowCommand
}: {
  composerMode: ChatAgentMode | undefined
  isImagenCommand: boolean
  isPlanCommand: boolean
  isWorkflowCommand: boolean
}): ChatAgentMode | undefined => {
  if (isPlanCommand) {
    return "plan"
  }

  if (isImagenCommand || isWorkflowCommand) {
    return "agent"
  }

  return composerMode
}

chatRoute.post("/chat", async (c) => {
  const body = await c.req.json()
  const {
    agentMode: rawAgentMode,
    imageMode: rawImageMode,
    mentions = [],
    messages,
    model: requestedModelId,
    permissionMode: rawPermissionMode,
    sessionId
  } = body as {
    agentMode?: unknown
    imageMode?: unknown
    mentions?: ChatMention[]
    messages: UIMessage[]
    model?: string
    permissionMode?: unknown
    sessionId: string
  }
  const db = getDb()
  const session = await getChatSessionById(db, sessionId)

  if (!session) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  const baseSettings = getSettings()
  const effectiveModelId = requestedModelId ?? session.modelId ?? null

  // Direct image mode bypasses the LLM chat/agent loop entirely: the message
  // text goes straight to the selected image model's Images API, and the result
  // renders through the existing inline imagen pipeline. The renderer only
  // enables the toggle for image-output models; re-validate here as a safety
  // net and fall through to the normal chat path when it does not hold.
  if (
    rawImageMode === true &&
    effectiveModelId &&
    isImageOutputModelSelection(baseSettings.ai, effectiveModelId)
  ) {
    return buildImageGenerationStreamResponse({
      abortSignal: c.req.raw.signal,
      messages,
      modelValue: effectiveModelId,
      onFinishPersist: async (nextMessages) => {
        await replaceChatMessages({ db, messages: nextMessages, sessionId })
      },
      projectPath: session.projectPath,
      requestStartedAt: Date.now(),
      sessionId
    })
  }

  const agentMode = isChatAgentMode(rawAgentMode) ? rawAgentMode : undefined
  const latestUserMessageText = getLatestUserMessageText(messages)
  const isImagenCommand = isChatImagenCommandText(latestUserMessageText)
  const isWorkflowCommand = isChatWorkflowCommandText(latestUserMessageText)
  const effectiveAgentMode = resolveEffectiveAgentMode({
    composerMode: agentMode,
    isImagenCommand,
    isPlanCommand: isChatPlanCommandText(latestUserMessageText),
    isWorkflowCommand
  })
  const settings = applyChatAgentModeToSettings({
    agentMode: effectiveAgentMode,
    settings: baseSettings
  })
  // The composer sends the active permission mode per request; fall back to the
  // global default when the body omits or malforms it.
  const permissionMode = isAgentPermissionMode(rawPermissionMode)
    ? rawPermissionMode
    : settings.agents.defaultPermissionMode
  const agentContext = await prepareAgentChatContext({
    db,
    mentions,
    messages,
    projectPath: session.projectPath,
    sessionId,
    settings
  })
  const model = resolveModel(effectiveModelId ?? undefined)
  const moonshotReasoningForAssistantToolCalls = isMoonshotModelId(
    effectiveModelId
  )
    ? buildMoonshotReasoningForAssistantToolCalls(agentContext.modelMessages)
    : []
  const requestStartedAt = Date.now()
  const planSystemPrompt = getChatAgentModeSystemPrompt(effectiveAgentMode)
  const systemPrompts = [
    ...agentContext.systemPrompts,
    ...(planSystemPrompt ? [planSystemPrompt] : []),
    ...(isImagenCommand ? [CHAT_IMAGEN_SYSTEM_PROMPT] : []),
    ...(isWorkflowCommand ? [CHAT_WORKFLOW_SYSTEM_PROMPT] : [])
  ]

  // Resolve the managed profile for this turn from settings (falls back to the
  // first available profile when the default is missing or disabled).
  const activeProfile = resolveActiveProfile(settings.agents)

  // Open an event-sourced run before streaming, so a crash mid-turn leaves a
  // recoverable `running` row that startup recovery closes.
  let agentRunId: string | null = null

  if (settings.agents.enabled) {
    try {
      agentRunId = await runExclusiveDbWrite(() =>
        startAgentRun({
          chatSessionId: sessionId,
          db,
          modelId: effectiveModelId,
          profileId: activeProfile.id
        })
      )
    } catch (error) {
      logger.error("agent_run_start_failed", { error })
    }
  }

  // Const capture so closures below narrow the run id without re-checking.
  const startedRunId = agentRunId

  return buildChatStreamResponse({
    abortSignal: c.req.raw.signal,
    agentRunId,
    messages,
    model,
    modelId: effectiveModelId,
    modelMessages: agentContext.modelMessages,
    moonshotReasoningForAssistantToolCalls,
    ...(startedRunId
      ? {
          onAgentStep: (step) =>
            recordAgentRunStep({ db, runId: startedRunId, step })
        }
      : {}),
    onFinishPersist: async (nextMessages, agentOutcome) => {
      let messagesToPersist = nextMessages

      if (agentRunId) {
        const assistantStartIndex = getRunAssistantStartIndex(nextMessages)

        // Best-effort: the durable run log must never break chat persistence.
        try {
          await runExclusiveDbWrite(() =>
            recordAgentRunOutcome({
              assistantStartIndex,
              db,
              messages: nextMessages,
              outcome: agentOutcome,
              runId: agentRunId
            })
          )
        } catch (error) {
          logger.error("agent_run_record_failed", { error })
        }

        messagesToPersist = attachAgentProjectionToAssistantMessages(
          nextMessages,
          { runId: agentRunId, startIndex: assistantStartIndex }
        )
      }

      await replaceChatMessages({
        db,
        messages: messagesToPersist,
        sessionId
      })
    },
    permissionMode,
    profileId: activeProfile.id,
    projectPath: session.projectPath,
    promptTemplates: agentContext.promptTemplates,
    requestStartedAt,
    sessionId,
    settings,
    systemPrompts
  })
})

export { chatRoute }
