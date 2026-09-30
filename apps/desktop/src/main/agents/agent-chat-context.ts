import type { AppSettings, ChatMention } from "@etyon/rpc"
import type { ModelMessage, UIMessage } from "ai"
import { convertToModelMessages, getToolName, isToolUIPart } from "ai"

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
// The picker already clamps `outerHtml` in the page; this is the defensive cap
// for a mention that reached the server by another route.
const MAX_WEB_ELEMENT_HTML_CHARS = 4000

const formatWebElementBlock = (
  mention: Extract<ChatMention, { kind: "webElement" }>
): string => {
  const styles = Object.entries(mention.styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ")

  return [
    `Selected element from ${mention.url} (${mention.title}):`,
    `selector: ${mention.selector}`,
    "```html",
    mention.outerHtml.slice(0, MAX_WEB_ELEMENT_HTML_CHARS),
    "```",
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- `mention` is a serialized payload, not a DOM node.
    `innerText: ${mention.innerText}`,
    `styles: ${styles}`
  ].join("\n")
}

/**
 * Web-element mentions do not go through the project snapshot: the payload was
 * captured in the browser panel and travels with the message, so it is rendered
 * here as its own system block alongside the file/folder mention context. Both
 * the chat and the agent path reach this through `prepareAgentChatContext`.
 */
const buildWebElementMentionSystemPrompt = (
  mentions: ChatMention[]
): string => {
  const blocks = mentions
    .filter((mention) => mention.kind === "webElement")
    .map(formatWebElementBlock)

  return blocks.length === 0
    ? ""
    : [
        "The user selected these elements in the embedded browser:",
        blocks.join("\n\n")
      ].join("\n")
}

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

// UI snapshots are durable for replay; models only need the changed task or
// task_list's details, rather than the full presentation snapshot on each turn.
const withoutTaskDisplaySnapshots = (messages: UIMessage[]): UIMessage[] =>
  messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (
        !isToolUIPart(part) ||
        part.state !== "output-available" ||
        !["task_create", "task_update", "task_list"].includes(
          getToolName(part)
        ) ||
        typeof part.output !== "object" ||
        part.output === null ||
        Array.isArray(part.output)
      ) {
        return part
      }
      const { todos: _todos, ...output } = part.output as Record<
        string,
        unknown
      >
      return { ...part, output }
    })
  }))

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
    resolveAttachmentsForModelMessages(
      withoutTaskDisplaySnapshots(messages)
    ).then(convertToModelMessages)
  ])
  const { system } = buildMentionContext({
    mentions,
    projectPath
  })
  const sessionMemorySystem = buildSessionMemorySystemPrompt(memory)
  const digestSystem = buildProjectDigestSystemPrompt(projectDigest)
  const skillsSystem = buildSkillsSystemPrompt({
    loadOnDemand: settings.agents.enabled,
    projectPath,
    query: memoryQuery,
    selectedSkills,
    settings: settings.skills
  })
  const systemPrompts = [
    sessionMemorySystem,
    digestSystem,
    skillsSystem,
    system,
    buildWebElementMentionSystemPrompt(mentions)
  ].filter(isSystemPrompt)

  return {
    modelMessages: completeUnresolvedToolCallsInModelMessages(modelMessages),
    promptTemplates: listSkillPromptTemplates({
      projectPaths: [projectPath]
    }),
    systemPrompts
  }
}
