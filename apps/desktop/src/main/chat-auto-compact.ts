import type { AppSettings } from "@etyon/rpc"
import type { UIMessage } from "ai"

import { summarizeChatCompaction } from "@/main/memory/summarization"
import {
  estimateChatContextUsagePercent,
  getMessageContextText,
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

  const marker = "\n... [truncated] ...\n"
  const headLength = Math.ceil((maxLength - marker.length) / 2)
  const tailLength = maxLength - marker.length - headLength
  return `${value.slice(0, headLength)}${marker}${value.slice(-tailLength)}`
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
      const text = truncateText(
        getMessageContextText(message),
        MESSAGE_TEXT_MAX_CHARS
      )

      if (!text) {
        return ""
      }

      return `${message.role}: ${text}`
    })
    .filter(Boolean)
    .join("\n")
  const sections = [
    "Auto compacted conversation summary:",
    `Compacted messages: ${compactedMessages.length}`,
    roleSummary ? `Original roles: ${roleSummary}` : "",
    compactedText
      ? `New conversation:\n${truncateText(compactedText, 3600)}`
      : "",
    previousSummary
      ? `Previous summary:\n${truncateText(previousSummary, 2000)}`
      : ""
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

  if (messages.length <= keepRecentMessages) {
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
  // Never compact a tool still waiting on input or approval. Its original
  // call is required by approval/question continuation on the next request.
  const pendingIndex = messagesWithoutPreviousSummary.findIndex((message) =>
    message.parts.some(
      (part) =>
        "state" in part &&
        [
          "input-streaming",
          "input-available",
          "approval-requested",
          "approval-responded"
        ].includes(String(part.state))
    )
  )
  const compactEnd = Math.min(
    Math.max(0, messagesWithoutPreviousSummary.length - keepRecentMessages),
    pendingIndex === -1 ? messagesWithoutPreviousSummary.length : pendingIndex
  )
  const compactedMessages = messagesWithoutPreviousSummary.slice(0, compactEnd)
  const recentMessages = messagesWithoutPreviousSummary.slice(compactEnd)

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
  // The model must see the source, not only the small deterministic fallback.
  // Reserve independent budgets so an old summary cannot crowd out new facts.
  const retainedMessages = new Set(recentMessages)
  const newSource = messages
    .filter(
      (message) =>
        message.id !== AUTO_COMPACT_MESSAGE_ID && !retainedMessages.has(message)
    )
    .map((message) => `${message.role}: ${getMessageContextText(message)}`)
    .join("\n")
  const previousSummary = messages.find(
    (message) => message.id === AUTO_COMPACT_MESSAGE_ID
  )
  const sourceContent = [
    `New conversation:\n${truncateText(newSource, 18000)}`,
    previousSummary
      ? `Previous summary:\n${truncateText(getMessageText(previousSummary), 5000)}`
      : ""
  ]
    .filter(Boolean)
    .join("\n\n")
  const summaryContent = await summarizeChatCompaction({
    fallbackContent,
    settings,
    sourceContent
  })

  return [createAutoCompactMessage(summaryContent), ...recentMessages]
}
