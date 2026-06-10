import type { AppSettings, ChatMention } from "@etyon/rpc"
import type { ModelMessage, UIMessage } from "ai"
import { convertToModelMessages } from "ai"

import { completeUnresolvedToolCallsInModelMessages } from "@/main/agents/minimal/model-message-continuity"
import {
  buildSessionMemorySystemPrompt,
  getChatSessionMemory
} from "@/main/chat-session-memory"
import type { AppDatabase } from "@/main/db"
import { buildMemorySystemPrompt } from "@/main/memory"
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
  buildLongTermMemorySystem: (options: {
    abortSignal?: AbortSignal
  }) => Promise<string>
  modelMessages: ModelMessage[]
  promptTemplates: ReturnType<typeof listSkillPromptTemplates>
  shouldRetrieveLongTermMemory: boolean
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
  const shouldRetrieveLongTermMemory =
    settings.memory.enabled && settings.memory.autoRetrieve
  const [memory, modelMessages] = await Promise.all([
    getChatSessionMemory(db, sessionId),
    convertToModelMessages(messages)
  ])
  const { system } = buildMentionContext({
    mentions,
    projectPath
  })
  const sessionMemorySystem = buildSessionMemorySystemPrompt(memory)
  const skillsSystem = buildSkillsSystemPrompt({
    projectPath,
    query: memoryQuery,
    selectedSkills,
    settings: settings.skills
  })
  const systemPrompts = [sessionMemorySystem, skillsSystem, system].filter(
    isSystemPrompt
  )

  return {
    buildLongTermMemorySystem: ({ abortSignal }) =>
      buildMemorySystemPrompt({
        abortSignal,
        db,
        projectPath,
        query: memoryQuery,
        settings: settings.memory
      }),
    modelMessages: completeUnresolvedToolCallsInModelMessages(modelMessages),
    promptTemplates: listSkillPromptTemplates({
      projectPaths: [projectPath]
    }),
    shouldRetrieveLongTermMemory,
    systemPrompts
  }
}
