import type { ChatMention } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { convertToModelMessages, streamText } from "ai"
import { Hono } from "hono"

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
import { getSettings } from "@/main/settings"
import { buildSkillsSystemPrompt } from "@/main/skills"

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

  const memory = await getChatSessionMemory(db, sessionId)
  const { system } = buildMentionContext({
    mentions,
    projectPath: session.projectPath
  })
  const sessionMemorySystem = buildSessionMemorySystemPrompt(memory)
  const settings = getSettings()
  const memoryQuery = buildMemoryQuery(messages)
  const longTermMemorySystem = await buildMemorySystemPrompt({
    db,
    projectPath: session.projectPath,
    query: memoryQuery,
    settings: settings.memory
  })
  const skillsSystem = buildSkillsSystemPrompt({
    projectPath: session.projectPath,
    query: memoryQuery,
    settings: settings.skills
  })
  const systemPrompts = [
    sessionMemorySystem,
    longTermMemorySystem,
    skillsSystem,
    system
  ].filter(Boolean)
  const model = resolveModel(requestedModelId ?? session.modelId ?? undefined)
  const modelMessages = await convertToModelMessages(messages)
  const result = streamText({
    ...(systemPrompts.length > 0 ? { system: systemPrompts.join("\n\n") } : {}),
    messages: modelMessages,
    model
  })

  return result.toUIMessageStreamResponse({
    onFinish: async ({ messages: nextMessages }) => {
      await replaceChatMessages({
        db,
        messages: nextMessages,
        sessionId
      })
    },
    originalMessages: messages
  })
})

export { chatRoute }
