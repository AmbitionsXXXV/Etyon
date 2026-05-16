import type { ChatSessionMemory } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { eq } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { chatSessionMemories } from "@/main/db/schema"

const MEMORY_MAX_CHARS = 6000
const MEMORY_MAX_MESSAGES = 16
const WHITESPACE_PATTERN = /\s+/gu
const ROLE_LABELS = {
  assistant: "Assistant",
  system: "System",
  user: "User"
} as const

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

const truncateMemory = (content: string): string => {
  if (content.length <= MEMORY_MAX_CHARS) {
    return content
  }

  return content.slice(content.length - MEMORY_MAX_CHARS).trim()
}

export const buildSessionMemoryContent = (messages: UIMessage[]): string => {
  const memoryLines = messages
    .map((message) => ({
      role: message.role,
      text: getMessageText(message)
    }))
    .filter(({ text }) => text.length > 0)
    .slice(-MEMORY_MAX_MESSAGES)
    .map(({ role, text }) => `${ROLE_LABELS[role]}: ${text}`)

  return truncateMemory(memoryLines.join("\n"))
}

export const buildSessionMemorySystemPrompt = (
  memory: ChatSessionMemory | undefined
): string => {
  const content = memory?.content.trim()

  if (!content) {
    return ""
  }

  return [
    "Session memory from previous turns:",
    content,
    "Use this as compact recall. Prefer the live chat messages when they conflict."
  ].join("\n")
}

export const getChatSessionMemory = async (
  db: AppDatabase,
  sessionId: string
): Promise<ChatSessionMemory | undefined> => {
  const [memory] = await db
    .select()
    .from(chatSessionMemories)
    .where(eq(chatSessionMemories.sessionId, sessionId))
    .limit(1)

  return memory
}

export const upsertChatSessionMemory = async ({
  db,
  messages,
  sessionId
}: {
  db: AppDatabase
  messages: UIMessage[]
  sessionId: string
}): Promise<ChatSessionMemory | undefined> => {
  const content = buildSessionMemoryContent(messages)

  if (!content) {
    await db
      .delete(chatSessionMemories)
      .where(eq(chatSessionMemories.sessionId, sessionId))

    return undefined
  }

  const now = new Date().toISOString()
  const existingMemory = await getChatSessionMemory(db, sessionId)

  if (existingMemory) {
    const [updatedMemory] = await db
      .update(chatSessionMemories)
      .set({
        content,
        messageCount: messages.length,
        updatedAt: now
      })
      .where(eq(chatSessionMemories.sessionId, sessionId))
      .returning()

    return updatedMemory
  }

  const [createdMemory] = await db
    .insert(chatSessionMemories)
    .values({
      content,
      createdAt: now,
      messageCount: messages.length,
      sessionId,
      updatedAt: now
    })
    .returning()

  return createdMemory
}
