import type { AppSettings, ChatMention } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { Hono } from "hono"

import { prepareAgentChatContext } from "@/main/agents/agent-chat-context"
import { replaceChatMessages } from "@/main/chat-messages"
import { getChatSessionById } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { resolveModel } from "@/main/server/lib/providers"
import { buildChatStreamResponse } from "@/main/server/routes/build-chat-stream-response"
import { getSettings } from "@/main/settings"
import { isChatAgentMode } from "@/shared/chat/agent-mode"
import type { ChatAgentMode } from "@/shared/chat/agent-mode"
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
      enabled: agentMode === "agent"
    }
  }
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
  const settings = applyChatAgentModeToSettings({
    agentMode,
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

  return buildChatStreamResponse({
    abortSignal: c.req.raw.signal,
    buildLongTermMemorySystem: agentContext.buildLongTermMemorySystem,
    messages,
    model,
    modelId: effectiveModelId,
    modelMessages: agentContext.modelMessages,
    moonshotReasoningForAssistantToolCalls,
    onFinishPersist: async (nextMessages) => {
      await replaceChatMessages({
        db,
        messages: nextMessages,
        sessionId
      })
    },
    projectPath: session.projectPath,
    promptTemplates: agentContext.promptTemplates,
    requestStartedAt,
    sessionId,
    settings,
    shouldRetrieveLongTermMemory: agentContext.shouldRetrieveLongTermMemory,
    systemPrompts: agentContext.systemPrompts,
    ...(isChatRequestTrigger(trigger) ? { trigger } : {})
  })
})

export { chatRoute }
