import type { AppSettings } from "@etyon/rpc"
import type { UIMessage } from "ai"

import { summarizeChatCompaction } from "@/main/memory/summarization"
import {
  estimateChatContextUsagePercent,
  getMessageText
} from "@/shared/chat/context-usage"

export const AUTO_COMPACT_MESSAGE_ID = "etyon-auto-compact-summary"
export { estimateChatContextUsagePercent }

const MESSAGE_TEXT_MAX_CHARS = 1200
const SUMMARY_MAX_CHARS = 6000

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 3)}...`
}

const buildCompactedSummary = ({
  compactedMessages,
  previousSummary
}: {
  compactedMessages: UIMessage[]
  previousSummary: string
}): string => {
  const roleCounts = new Map<string, number>()

  for (const message of compactedMessages) {
    roleCounts.set(message.role, (roleCounts.get(message.role) ?? 0) + 1)
  }

  const roleSummary = [...roleCounts.entries()]
    .map(([role, count]) => `${role}: ${count}`)
    .join(", ")
  const compactedText = compactedMessages
    .map((message) => {
      const text = truncateText(getMessageText(message), MESSAGE_TEXT_MAX_CHARS)

      if (!text) {
        return ""
      }

      return `${message.role}: ${text}`
    })
    .filter(Boolean)
    .join("\n")
  const sections = [
    "Auto compacted conversation summary:",
    previousSummary ? `Previous summary:\n${previousSummary}` : "",
    `Compacted messages: ${compactedMessages.length}`,
    roleSummary ? `Original roles: ${roleSummary}` : "",
    compactedText ? `Conversation:\n${compactedText}` : ""
  ].filter(Boolean)

  return truncateText(sections.join("\n\n"), SUMMARY_MAX_CHARS)
}

const createAutoCompactMessage = (content: string): UIMessage => ({
  id: AUTO_COMPACT_MESSAGE_ID,
  parts: [
    {
      text: content,
      type: "text"
    }
  ],
  role: "system"
})

export const maybeCompactChatMessages = ({
  messages,
  settings
}: {
  messages: UIMessage[]
  settings: AppSettings
}): UIMessage[] => {
  const { autoCompact } = settings.chat

  if (!autoCompact.enabled) {
    return messages
  }

  if (estimateChatContextUsagePercent(messages) < autoCompact.threshold) {
    return messages
  }

  const { keepRecentMessages } = autoCompact

  if (messages.length <= keepRecentMessages + 1) {
    return messages
  }

  const previousSummaryMessage = messages.find(
    (message) => message.id === AUTO_COMPACT_MESSAGE_ID
  )
  const previousSummary = previousSummaryMessage
    ? getMessageText(previousSummaryMessage)
    : ""
  const messagesWithoutPreviousSummary = messages.filter(
    (message) => message.id !== AUTO_COMPACT_MESSAGE_ID
  )
  const compactedMessages = messagesWithoutPreviousSummary.slice(
    0,
    Math.max(0, messagesWithoutPreviousSummary.length - keepRecentMessages)
  )
  const recentMessages =
    messagesWithoutPreviousSummary.slice(-keepRecentMessages)

  if (compactedMessages.length === 0) {
    return messages
  }

  return [
    createAutoCompactMessage(
      buildCompactedSummary({
        compactedMessages,
        previousSummary
      })
    ),
    ...recentMessages
  ]
}

export const compactChatMessages = async ({
  messages,
  settings
}: {
  messages: UIMessage[]
  settings: AppSettings
}): Promise<UIMessage[]> => {
  const compactedMessages = maybeCompactChatMessages({
    messages,
    settings
  })

  if (compactedMessages === messages) {
    return messages
  }

  const [summaryMessage, ...recentMessages] = compactedMessages

  if (summaryMessage?.id !== AUTO_COMPACT_MESSAGE_ID) {
    return compactedMessages
  }

  const fallbackContent = getMessageText(summaryMessage)
  const summaryContent = await summarizeChatCompaction({
    fallbackContent,
    settings
  })

  return [createAutoCompactMessage(summaryContent), ...recentMessages]
}
