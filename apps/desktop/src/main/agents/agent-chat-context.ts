import type { AppSettings, ChatMention } from "@etyon/rpc"
import type { ModelMessage, UIMessage } from "ai"
import { convertToModelMessages } from "ai"

import { completeUnresolvedToolCallsInModelMessages } from "@/main/agents/minimal/model-message-continuity"
import { resolveAttachmentsForModelMessages } from "@/main/attachments"
import {
  buildSessionMemorySystemPrompt,
  getChatSessionMemory
} from "@/main/chat-session-memory"
import type { AppDatabase } from "@/main/db"
import {
  buildProjectDigestSystemPrompt,
  getProjectMemoryDigest
} from "@/main/memory/project-digest"
import { buildMentionContext } from "@/main/project-snapshot"
import {
  buildSkillsSystemPrompt,
  listSkillPromptTemplates
} from "@/main/skills"

export interface PrepareAgentChatContextOptions {
  db: AppDatabase
  mentions: ChatMention[]
  messages: UIMessage[]
  projectPath: string
  sessionId: string
  settings: AppSettings
}

export interface PreparedAgentChatContext {
  modelMessages: ModelMessage[]
  promptTemplates: ReturnType<typeof listSkillPromptTemplates>
  systemPrompts: string[]
}

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

export const buildAgentChatMemoryQuery = (messages: UIMessage[]): string =>
  messages
    .filter((message) => message.role === "user")
    .map(getMessageText)
    .filter(Boolean)
    .slice(-3)
    .join("\n")

const isSystemPrompt = (prompt: string | undefined): prompt is string =>
  typeof prompt === "string" && prompt.length > 0

export const prepareAgentChatContext = async ({
  db,
  mentions,
  messages,
  projectPath,
  sessionId,
  settings
}: PrepareAgentChatContextOptions): Promise<PreparedAgentChatContext> => {
  const selectedSkills = mentions.filter((mention) => mention.kind === "skill")
  const memoryQuery = buildAgentChatMemoryQuery(messages)
  const [memory, projectDigest, modelMessages] = await Promise.all([
    getChatSessionMemory(db, sessionId),
    settings.memory.enabled
      ? getProjectMemoryDigest(db, projectPath)
      : Promise.resolve(""),
    // Persisted image inputs arrive as `etyon-attachment://` refs; read their
    // bytes back into inline data URLs so the model receives the images
    // (fresh `data:` URLs from this turn pass through untouched).
    resolveAttachmentsForModelMessages(messages).then(convertToModelMessages)
  ])
  const { system } = buildMentionContext({
    mentions,
    projectPath
  })
  const sessionMemorySystem = buildSessionMemorySystemPrompt(memory)
  const digestSystem = buildProjectDigestSystemPrompt(projectDigest)
  const skillsSystem = buildSkillsSystemPrompt({
    projectPath,
    query: memoryQuery,
    selectedSkills,
    settings: settings.skills
  })
  const systemPrompts = [
    sessionMemorySystem,
    digestSystem,
    skillsSystem,
    system
  ].filter(isSystemPrompt)

  return {
    modelMessages: completeUnresolvedToolCallsInModelMessages(modelMessages),
    promptTemplates: listSkillPromptTemplates({
      projectPaths: [projectPath]
    }),
    systemPrompts
  }
}
