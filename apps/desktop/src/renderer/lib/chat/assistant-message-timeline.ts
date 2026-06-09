import type { UIMessage } from "@ai-sdk/react"
import { isToolUIPart } from "ai"

import type { ChatMessageMetadata } from "@/renderer/lib/chat/message-metadata"
import { compactStructuredToolTraceParts } from "@/renderer/lib/chat/message-tool-trace"
import type { ChatStreamDataTypes } from "@/shared/chat/stream-data"

export type ChatUiMessage = UIMessage<ChatMessageMetadata, ChatStreamDataTypes>

export type ChatToolPart = Extract<
  ChatUiMessage["parts"][number],
  { toolCallId: string }
>

export type ReasoningChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "reasoning" }
>

export type SourceDocumentChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "source-document" }
>

export type SourceUrlChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "source-url" }
>

export type TextChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "text" }
>

export type FileChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "file" }
>

export type ChainEntry =
  | {
      key: string
      kind: "reasoning"
      text: string
    }
  | {
      key: string
      kind: "tool"
      part: ChatToolPart
      repeatCount: number
    }

export const buildAssistantChainEntries = (
  message: ChatUiMessage
): ChainEntry[] => {
  const entries: ChainEntry[] = []
  let toolRun: ChatToolPart[] = []
  let reasoningIndex = 0

  const flushToolRun = () => {
    if (toolRun.length === 0) {
      return
    }

    for (const { part, repeatCount } of compactStructuredToolTraceParts(
      toolRun
    )) {
      entries.push({
        key: `tool-${(part as ChatToolPart).toolCallId}`,
        kind: "tool",
        part: part as ChatToolPart,
        repeatCount
      })
    }

    toolRun = []
  }

  for (const part of message.parts) {
    if (isToolUIPart(part as never)) {
      toolRun.push(part as ChatToolPart)
      continue
    }

    if (part.type === "reasoning") {
      const reasoningText = (part as ReasoningChatPart).text.trim()

      if (reasoningText.length === 0) {
        continue
      }

      flushToolRun()
      entries.push({
        key: `reasoning-${reasoningIndex}`,
        kind: "reasoning",
        text: reasoningText
      })
      reasoningIndex += 1
    }
  }

  flushToolRun()

  return entries
}

export const hasPendingApproval = (entries: readonly ChainEntry[]): boolean =>
  entries.some(
    (entry) =>
      entry.kind === "tool" && entry.part.state === "approval-requested"
  )

export const getAssistantBodyText = (message: ChatUiMessage): string =>
  message.parts
    .filter((part): part is TextChatPart => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")

export const openExternalUrl = (url: string): void => {
  window.electron.ipcRenderer.invoke("open-external-url", url)
}

export const getUrlHost = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export const isReferencePart = (
  part: ChatUiMessage["parts"][number]
): boolean =>
  part.type === "file" ||
  part.type === "source-document" ||
  part.type === "source-url"
