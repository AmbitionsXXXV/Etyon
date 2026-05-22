import type { ChatMention } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { convertToModelMessages } from "ai"
import { Hono } from "hono"

import { streamAgentChat } from "@/main/agents/agent-runtime"
import { replaceChatMessages } from "@/main/chat-messages"
import {
  buildSessionMemorySystemPrompt,
  getChatSessionMemory
} from "@/main/chat-session-memory"
import { getChatSessionById } from "@/main/chat-sessions"
import { getDb } from "@/main/db"
import { buildMemorySystemPrompt } from "@/main/memory"
import { buildMentionContext } from "@/main/project-snapshot"
import { resolveModel } from "@/main/server/lib/providers"
import { buildChatStreamResponse } from "@/main/server/routes/build-chat-stream-response"
import { getSettings } from "@/main/settings"
import { buildSkillsSystemPrompt } from "@/main/skills"
import { buildMoonshotReasoningForAssistantToolCalls } from "@/shared/providers/moonshot-reasoning"

const chatRoute = new Hono()
const WHITESPACE_PATTERN = /\s+/gu

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
    .replace(WHITESPACE_PATTERN, " ")
    .trim()

const buildMemoryQuery = (messages: UIMessage[]): string =>
  messages
    .filter((message) => message.role === "user")
    .map(getMessageText)
    .filter(Boolean)
    .slice(-3)
    .join("\n")

const isSystemPrompt = (prompt: string | undefined): prompt is string =>
  typeof prompt === "string" && prompt.length > 0

const isMoonshotModelId = (modelId: string | null | undefined): boolean =>
  typeof modelId === "string" && modelId.startsWith("moonshot/")

chatRoute.post("/chat", async (c) => {
  const body = await c.req.json()
  const {
    mentions = [],
    messages,
    model: requestedModelId,
    sessionId
  } = body as {
    mentions?: ChatMention[]
    messages: UIMessage[]
    model?: string
    sessionId: string
  }
  const db = getDb()
  const session = await getChatSessionById(db, sessionId)

  if (!session) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  const selectedSkills = mentions.filter((mention) => mention.kind === "skill")
  const settings = getSettings()
  const memoryQuery = buildMemoryQuery(messages)
  const shouldRetrieveLongTermMemory =
    settings.memory.enabled && settings.memory.autoRetrieve
  const [memory, modelMessages] = await Promise.all([
    getChatSessionMemory(db, sessionId),
    convertToModelMessages(messages)
  ])
  const { system } = buildMentionContext({
    mentions,
    projectPath: session.projectPath
  })
  const sessionMemorySystem = buildSessionMemorySystemPrompt(memory)
  const skillsSystem = buildSkillsSystemPrompt({
    projectPath: session.projectPath,
    query: memoryQuery,
    selectedSkills,
    settings: settings.skills
  })
  const systemPrompts = [sessionMemorySystem, skillsSystem, system].filter(
    isSystemPrompt
  )
  const effectiveModelId = requestedModelId ?? session.modelId ?? null
  const model = resolveModel(effectiveModelId ?? undefined)
  const moonshotReasoningForAssistantToolCalls = isMoonshotModelId(
    effectiveModelId
  )
    ? buildMoonshotReasoningForAssistantToolCalls(modelMessages)
    : []
  const requestStartedAt = Date.now()

  return buildChatStreamResponse({
    buildLongTermMemorySystem: () =>
      buildMemorySystemPrompt({
        db,
        projectPath: session.projectPath,
        query: memoryQuery,
        settings: settings.memory
      }),
    db,
    messages,
    model,
    modelId: effectiveModelId,
    modelMessages,
    moonshotReasoningForAssistantToolCalls,
    onFinishPersist: async (nextMessages) => {
      await replaceChatMessages({
        db,
        messages: nextMessages,
        sessionId
      })
    },
    projectPath: session.projectPath,
    requestStartedAt,
    sessionId,
    settings,
    shouldRetrieveLongTermMemory,
    streamAgentChat,
    systemPrompts
  })
})

export { chatRoute }
