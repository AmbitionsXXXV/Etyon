import type { ChatMention } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { Hono } from "hono"

import { prepareAgentChatContext } from "@/main/agents/agent-chat-context"
import { streamAgentChat } from "@/main/agents/agent-runtime"
import { replaceChatMessages } from "@/main/chat-messages"
import { getChatSessionById } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { resolveModel } from "@/main/server/lib/providers"
import { buildChatStreamResponse } from "@/main/server/routes/build-chat-stream-response"
import { getSettings } from "@/main/settings"
import { buildMoonshotReasoningForAssistantToolCalls } from "@/shared/providers/moonshot-reasoning"

const chatRoute = new Hono()

const isMoonshotModelId = (modelId: string | null | undefined): boolean =>
  typeof modelId === "string" && modelId.startsWith("moonshot/")

const isChatRequestTrigger = (
  trigger: unknown
): trigger is "regenerate-message" | "submit-message" =>
  trigger === "regenerate-message" || trigger === "submit-message"

const buildChatLifecycleBranch = ({
  messageId,
  messages,
  trigger
}: {
  messageId?: string
  messages: UIMessage[]
  trigger?: string
}) => {
  if (!isChatRequestTrigger(trigger)) {
    return
  }

  if (trigger === "regenerate-message") {
    return {
      branchKind: "regenerate" as const,
      ...(messageId ? { messageId } : {}),
      retainedMessageIds: messages.map((message) => message.id),
      trigger
    }
  }

  if (!messageId) {
    return
  }

  const editedMessage = messages.find((message) => message.id === messageId)

  if (editedMessage?.role !== "user") {
    return
  }

  return {
    branchKind: "edit" as const,
    messageId,
    retainedMessageIds: messages.map((message) => message.id),
    trigger
  }
}

chatRoute.post("/chat", async (c) => {
  const body = await c.req.json()
  const {
    mentions = [],
    messageId,
    messages,
    model: requestedModelId,
    sessionId,
    trigger
  } = body as {
    mentions?: ChatMention[]
    messageId?: string
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

  const settings = getSettings()
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
    chatLifecycleBranch: buildChatLifecycleBranch({
      messageId,
      messages,
      trigger
    }),
    db,
    messages,
    model,
    modelId: effectiveModelId,
    modelMessages: agentContext.modelMessages,
    moonshotReasoningForAssistantToolCalls,
    ...(agentContext.extensionRunner
      ? { extensionRunner: agentContext.extensionRunner }
      : {}),
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
    ...(agentContext.selectedSkillCapabilities.length > 0
      ? { skillCapabilities: agentContext.selectedSkillCapabilities }
      : {}),
    streamAgentChat,
    systemPrompts: agentContext.systemPrompts
  })
})

export { chatRoute }
