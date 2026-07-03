import type { AppSettings, ChatMention } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { Hono } from "hono"

import { prepareAgentChatContext } from "@/main/agents/agent-chat-context"
import {
  getRunAssistantStartIndex,
  recordAgentRunOutcome,
  startAgentRun
} from "@/main/agents/agent-event-store"
import { replaceChatMessages } from "@/main/chat-messages"
import { getChatSessionById } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { logger } from "@/main/logger"
import { resolveModel } from "@/main/server/lib/providers"
import { buildChatStreamResponse } from "@/main/server/routes/build-chat-stream-response"
import { getSettings } from "@/main/settings"
import { resolveActiveProfile } from "@/shared/agents/profiles"
import {
  getChatAgentModeAgentsEnabled,
  getChatAgentModeSystemPrompt,
  isChatAgentMode,
  isChatPlanCommandText
} from "@/shared/chat/agent-mode"
import type { ChatAgentMode } from "@/shared/chat/agent-mode"
import { attachAgentProjectionToAssistantMessages } from "@/shared/chat/message-metadata"
import { buildMoonshotReasoningForAssistantToolCalls } from "@/shared/providers/moonshot-reasoning"

const chatRoute = new Hono()

const isMoonshotModelId = (modelId: string | null | undefined): boolean =>
  typeof modelId === "string" && modelId.startsWith("moonshot/")

const isChatRequestTrigger = (
  trigger: unknown
): trigger is "regenerate-message" | "submit-message" =>
  trigger === "regenerate-message" || trigger === "submit-message"

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

const getLatestUserMessageText = (messages: UIMessage[]): string => {
  const latestUserMessage = messages.findLast(
    (message) => message.role === "user"
  )

  if (!latestUserMessage) {
    return ""
  }

  return latestUserMessage.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
}

chatRoute.post("/chat", async (c) => {
  const body = await c.req.json()
  const {
    agentMode: rawAgentMode,
    mentions = [],
    messages,
    model: requestedModelId,
    sessionId,
    trigger
  } = body as {
    agentMode?: unknown
    mentions?: ChatMention[]
    messages: UIMessage[]
    model?: string
    sessionId: string
    trigger?: string
  }
  const db = getDb()
  const session = await getChatSessionById(db, sessionId)

  if (!session) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  const agentMode = isChatAgentMode(rawAgentMode) ? rawAgentMode : undefined
  // A typed `/plan` command forces plan mode for this turn regardless of the
  // composer's selected mode.
  const effectiveAgentMode: ChatAgentMode | undefined = isChatPlanCommandText(
    getLatestUserMessageText(messages)
  )
    ? "plan"
    : agentMode
  const settings = applyChatAgentModeToSettings({
    agentMode: effectiveAgentMode,
    settings: getSettings()
  })
  const agentContext = await prepareAgentChatContext({
    db,
    mentions,
    messages,
    projectPath: session.projectPath,
    sessionId,
    settings
  })
  const effectiveModelId = requestedModelId ?? session.modelId ?? null
  const model = resolveModel(effectiveModelId ?? undefined)
  const moonshotReasoningForAssistantToolCalls = isMoonshotModelId(
    effectiveModelId
  )
    ? buildMoonshotReasoningForAssistantToolCalls(agentContext.modelMessages)
    : []
  const requestStartedAt = Date.now()
  const planSystemPrompt = getChatAgentModeSystemPrompt(effectiveAgentMode)
  const systemPrompts = planSystemPrompt
    ? [...agentContext.systemPrompts, planSystemPrompt]
    : agentContext.systemPrompts

  // Resolve the managed profile for this turn from settings (falls back to the
  // first available profile when the default is missing or disabled).
  const activeProfile = resolveActiveProfile(settings.agents)

  // Open an event-sourced run before streaming, so a crash mid-turn leaves a
  // recoverable `running` row that startup recovery closes.
  let agentRunId: string | null = null

  if (settings.agents.enabled) {
    try {
      agentRunId = await startAgentRun({
        chatSessionId: sessionId,
        db,
        modelId: effectiveModelId,
        profileId: activeProfile.id
      })
    } catch (error) {
      logger.error("agent_run_start_failed", { error })
    }
  }

  return buildChatStreamResponse({
    abortSignal: c.req.raw.signal,
    agentRunId,
    messages,
    model,
    modelId: effectiveModelId,
    modelMessages: agentContext.modelMessages,
    moonshotReasoningForAssistantToolCalls,
    onFinishPersist: async (nextMessages) => {
      let messagesToPersist = nextMessages

      if (agentRunId) {
        const assistantStartIndex = getRunAssistantStartIndex(nextMessages)

        // Best-effort: the durable run log must never break chat persistence.
        try {
          await recordAgentRunOutcome({
            assistantStartIndex,
            db,
            messages: nextMessages,
            runId: agentRunId
          })
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
    profileId: activeProfile.id,
    projectPath: session.projectPath,
    promptTemplates: agentContext.promptTemplates,
    requestStartedAt,
    sessionId,
    settings,
    systemPrompts,
    ...(isChatRequestTrigger(trigger) ? { trigger } : {})
  })
})

export { chatRoute }
