import type { ChatMention } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai"
import { isToolUIPart } from "ai"

import {
  AssistantThinkingTrace,
  CommandTextTraceCard,
  FunctionCallTextTraceCard,
  StructuredToolTraceCard
} from "@/renderer/components/chat/message-tool-trace"
import type { ChatMessageMetadata } from "@/renderer/lib/chat/message-metadata"
import {
  getMentionDisplayName,
  getMentionTitle,
  getMentionTokenTypeLabel,
  splitPromptTextByMentions
} from "@/renderer/lib/chat/prompt-input"
import { splitAssistantTextSegments } from "@/renderer/lib/chat/tool-ui"
import type { AssistantTextSegment } from "@/renderer/lib/chat/tool-ui"
import type { ChatStreamDataTypes } from "@/shared/chat/stream-data"

type ChatToolPart = DynamicToolUIPart | ToolUIPart
type ChatUiMessage = UIMessage<ChatMessageMetadata, ChatStreamDataTypes>
type ReasoningChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "reasoning" }
>
type TextChatPart = Extract<ChatUiMessage["parts"][number], { type: "text" }>

const InlineMentionToken = ({ mention }: { mention: ChatMention }) => (
  <span
    className="mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted/80 px-1.5 py-1 align-baseline text-sm font-medium text-foreground ring-1 ring-border/70"
    title={getMentionTitle(mention)}
  >
    <span className="grid h-5 min-w-5 place-items-center rounded-[4px] bg-foreground/15 px-1 text-[0.62rem] leading-none font-semibold text-muted-foreground uppercase">
      {getMentionTokenTypeLabel(mention)}
    </span>
    <span className="max-w-52 truncate">{getMentionDisplayName(mention)}</span>
  </span>
)

const MessageTextContent = ({
  mentions,
  messageId,
  text
}: {
  mentions: ChatMention[]
  messageId: string
  text: string
}) => {
  if (!text.trim()) {
    return null
  }

  const messageParts = splitPromptTextByMentions({
    mentions,
    text
  })

  return (
    <p className="whitespace-pre-wrap">
      {messageParts.map((part, index) =>
        part.type === "mention" ? (
          <InlineMentionToken
            key={`${messageId}-mention-${part.mention.kind}-${part.mention.path}-${index}`}
            mention={part.mention}
          />
        ) : (
          <span key={`${messageId}-text-${index}`}>{part.text}</span>
        )
      )}
    </p>
  )
}

const getTimelinePartKey = (
  messageId: string,
  part: ChatUiMessage["parts"][number],
  index: number
): string => {
  if (isToolUIPart(part)) {
    return `${messageId}-tool-${part.toolCallId}`
  }

  if (part.type === "reasoning") {
    return `${messageId}-reasoning-${index}`
  }

  if (part.type === "text") {
    return `${messageId}-text-${index}`
  }

  return `${messageId}-part-${index}`
}

const AssistantTextPartTimeline = ({
  mentions,
  messageId,
  partIndex,
  showToolTraces,
  text
}: {
  mentions: ChatMention[]
  messageId: string
  partIndex: number
  showToolTraces: boolean
  text: string
}) => {
  if (!showToolTraces) {
    return (
      <MessageTextContent
        mentions={mentions}
        messageId={`${messageId}-${partIndex}`}
        text={text}
      />
    )
  }

  const segments = splitAssistantTextSegments(text)

  return (
    <>
      {segments.map((segment, segmentIndex) => (
        <AssistantTextSegmentTimelineItem
          key={`${messageId}-${partIndex}-segment-${segmentIndex}`}
          mentions={mentions}
          messageId={`${messageId}-${partIndex}-${segmentIndex}`}
          segment={segment}
        />
      ))}
    </>
  )
}

const AssistantTextSegmentTimelineItem = ({
  mentions,
  messageId,
  segment
}: {
  mentions: ChatMention[]
  messageId: string
  segment: AssistantTextSegment
}) => {
  switch (segment.type) {
    case "executed-command": {
      return <CommandTextTraceCard segment={segment} />
    }
    case "function-call": {
      return <FunctionCallTextTraceCard segment={segment} />
    }
    case "thinking": {
      return <AssistantThinkingTrace text={segment.text} />
    }
    case "text": {
      return (
        <MessageTextContent
          mentions={mentions}
          messageId={messageId}
          text={segment.text}
        />
      )
    }
    default: {
      return null
    }
  }
}

const AssistantTimelinePart = ({
  isApprovalActionDisabled,
  mentions,
  messageId,
  onApprovalResponse,
  part,
  partIndex,
  showToolTraces
}: {
  isApprovalActionDisabled: boolean
  mentions: ChatMention[]
  messageId: string
  onApprovalResponse: (part: ChatToolPart, approved: boolean) => void
  part: ChatUiMessage["parts"][number]
  partIndex: number
  showToolTraces: boolean
}) => {
  if (part.type === "reasoning") {
    const reasoningPart = part as ReasoningChatPart

    if (!reasoningPart.text.trim()) {
      return null
    }

    return <AssistantThinkingTrace text={reasoningPart.text} />
  }

  if (part.type === "text") {
    const textPart = part as TextChatPart

    return (
      <AssistantTextPartTimeline
        mentions={mentions}
        messageId={messageId}
        partIndex={partIndex}
        showToolTraces={showToolTraces}
        text={textPart.text}
      />
    )
  }

  if (showToolTraces && isToolUIPart(part)) {
    return (
      <StructuredToolTraceCard
        isApprovalActionDisabled={isApprovalActionDisabled}
        onApprovalResponse={onApprovalResponse}
        part={part}
      />
    )
  }

  return null
}

export const AssistantMessageTimeline = ({
  className,
  isApprovalActionDisabled,
  mentions,
  message,
  onApprovalResponse,
  showToolTraces
}: {
  className?: string
  isApprovalActionDisabled: boolean
  mentions: ChatMention[]
  message: ChatUiMessage
  onApprovalResponse: (part: ChatToolPart, approved: boolean) => void
  showToolTraces: boolean
}) => (
  <div className={cn("space-y-2", className)}>
    {message.parts.map((part, index) => (
      <AssistantTimelinePart
        isApprovalActionDisabled={isApprovalActionDisabled}
        key={getTimelinePartKey(message.id, part, index)}
        mentions={mentions}
        messageId={message.id}
        onApprovalResponse={onApprovalResponse}
        part={part}
        partIndex={index}
        showToolTraces={showToolTraces}
      />
    ))}
  </div>
)
