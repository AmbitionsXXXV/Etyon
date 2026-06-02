import type { UIMessage } from "@ai-sdk/react"
import { useI18n } from "@etyon/i18n/react"
import type { StreamdownAnimation } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { isToolUIPart } from "ai"
import type { ComponentPropsWithoutRef } from "react"
import { Streamdown } from "streamdown"
import type { Components, ExtraProps } from "streamdown"

import {
  AssistantThinkingTrace,
  CommandTextTraceCard,
  FunctionCallTextTraceCard,
  StructuredToolTraceCard
} from "@/renderer/components/chat/message-tool-trace"
import type { ChatMessageMetadata } from "@/renderer/lib/chat/message-metadata"
import { getStreamdownAnimateOptions } from "@/renderer/lib/chat/streamdown-settings"
import {
  shouldRenderAssistantToolPart,
  splitAssistantRenderableTextSegments
} from "@/renderer/lib/chat/tool-ui"
import type {
  AssistantTextSegment,
  AssistantToolApprovalResponseOptions
} from "@/renderer/lib/chat/tool-ui"
import type { ChatStreamDataTypes } from "@/shared/chat/stream-data"

type ChatUiMessage = UIMessage<ChatMessageMetadata, ChatStreamDataTypes>
type ChatToolPart = Extract<
  ChatUiMessage["parts"][number],
  { toolCallId: string }
>
type ReasoningChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "reasoning" }
>
type SourceDocumentChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "source-document" }
>
type SourceUrlChatPart = Extract<
  ChatUiMessage["parts"][number],
  { type: "source-url" }
>
type TextChatPart = Extract<ChatUiMessage["parts"][number], { type: "text" }>
type FileChatPart = Extract<ChatUiMessage["parts"][number], { type: "file" }>
type MarkdownTableProps = ComponentPropsWithoutRef<"table"> & ExtraProps

const STREAMDOWN_MARKDOWN_CLASS_NAME = cn(
  "min-w-0 text-sm leading-6 text-foreground",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-md [&_code]:bg-muted/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_li]:my-1",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_p]:my-2",
  "[&_pre]:m-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_[data-streamdown=code-block]]:my-3 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-lg [&_[data-streamdown=code-block]]:border-border/80 [&_[data-streamdown=code-block]]:bg-muted/80 [&_[data-streamdown=code-block]]:p-0",
  "[&_[data-streamdown=code-block-actions]]:top-0 [&_[data-streamdown=code-block-actions]]:-mt-8 [&_[data-streamdown=code-block-actions]]:opacity-0 [&_[data-streamdown=code-block-actions]]:transition-opacity",
  "[&_[data-streamdown=code-block-actions]>div]:border-0 [&_[data-streamdown=code-block-actions]>div]:bg-transparent [&_[data-streamdown=code-block-actions]>div]:px-2",
  "[&_[data-streamdown=code-block]:focus-within_[data-streamdown=code-block-actions]]:opacity-100",
  "[&_[data-streamdown=code-block]:hover_[data-streamdown=code-block-actions]]:opacity-100",
  "[&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-0",
  "[&_[data-streamdown=code-block-body]>pre]:bg-transparent [&_[data-streamdown=code-block-body]>pre]:p-3",
  "[&_[data-streamdown=code-block-header]]:h-8 [&_[data-streamdown=code-block-header]]:border-b [&_[data-streamdown=code-block-header]]:border-border/60 [&_[data-streamdown=code-block-header]]:px-3",
  "[&_[data-streamdown=code-block-header]>span]:ml-0",
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/70 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
)

const MarkdownTable = ({
  children,
  className,
  node: _node,
  ...props
}: MarkdownTableProps) => (
  <table
    className={cn("my-3 w-full border-collapse text-sm", className)}
    {...props}
  >
    {children}
  </table>
)

const STREAMDOWN_MARKDOWN_COMPONENTS = {
  table: MarkdownTable
} satisfies Components

const AssistantMarkdownContent = ({
  isAnimating,
  streamdownAnimation,
  text
}: {
  isAnimating: boolean
  streamdownAnimation: StreamdownAnimation
  text: string
}) => {
  if (!text.trim()) {
    return null
  }

  const animated = isAnimating
    ? false
    : getStreamdownAnimateOptions(streamdownAnimation)

  return (
    <Streamdown
      animated={animated}
      className={STREAMDOWN_MARKDOWN_CLASS_NAME}
      components={STREAMDOWN_MARKDOWN_COMPONENTS}
      isAnimating={false}
      skipHtml
    >
      {text}
    </Streamdown>
  )
}

const getTimelinePartKey = (
  messageId: string,
  part: ChatUiMessage["parts"][number],
  index: number
): string => {
  if (isToolUIPart(part as never)) {
    const toolPart = part as ChatToolPart

    return `${messageId}-tool-${toolPart.toolCallId}`
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
  isStreamdownAnimating,
  messageId,
  partIndex,
  showToolTraces,
  streamdownAnimation,
  text
}: {
  isStreamdownAnimating: boolean
  messageId: string
  partIndex: number
  showToolTraces: boolean
  streamdownAnimation: StreamdownAnimation
  text: string
}) => {
  const segments = splitAssistantRenderableTextSegments({
    showToolTraces,
    text
  })

  return (
    <>
      {segments.map((segment, segmentIndex) => (
        <AssistantTextSegmentTimelineItem
          key={`${messageId}-${partIndex}-segment-${segmentIndex}`}
          isStreamdownAnimating={isStreamdownAnimating}
          segment={segment}
          streamdownAnimation={streamdownAnimation}
        />
      ))}
    </>
  )
}

const AssistantTextSegmentTimelineItem = ({
  isStreamdownAnimating,
  segment,
  streamdownAnimation
}: {
  isStreamdownAnimating: boolean
  segment: AssistantTextSegment
  streamdownAnimation: StreamdownAnimation
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
        <AssistantMarkdownContent
          isAnimating={isStreamdownAnimating}
          streamdownAnimation={streamdownAnimation}
          text={segment.text}
        />
      )
    }
    default: {
      return null
    }
  }
}

const openExternalUrl = (url: string): void => {
  window.electron.ipcRenderer.invoke("open-external-url", url)
}

const getUrlHost = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const AssistantFilePartTimeline = ({ part }: { part: FileChatPart }) => (
  <div className="inline-flex max-w-full flex-col gap-1 rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-xs">
    <span className="font-medium text-foreground">File</span>
    <span className="truncate text-muted-foreground">{part.mediaType}</span>
  </div>
)

const AssistantSourceDocumentPartTimeline = ({
  part
}: {
  part: SourceDocumentChatPart
}) => (
  <div className="inline-flex max-w-full flex-col gap-1 rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-xs">
    <span className="truncate font-medium text-foreground">{part.title}</span>
    <span className="truncate text-muted-foreground">
      {part.filename ?? part.mediaType}
    </span>
  </div>
)

const AssistantSourceUrlPartTimeline = ({
  part
}: {
  part: SourceUrlChatPart
}) => {
  const host = getUrlHost(part.url)

  return (
    <button
      className="inline-flex max-w-full flex-col gap-1 rounded-md border border-border/70 bg-muted/50 px-3 py-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted"
      onClick={() => {
        openExternalUrl(part.url)
      }}
      type="button"
    >
      <span className="truncate font-medium text-foreground">
        {part.title ?? host}
      </span>
      <span className="truncate text-muted-foreground">{host}</span>
    </button>
  )
}

const hasVisibleAssistantBodyPart = ({
  part,
  showToolTraces
}: {
  part: ChatUiMessage["parts"][number]
  showToolTraces: boolean
}): boolean => {
  if (
    part.type === "file" ||
    part.type === "source-document" ||
    part.type === "source-url"
  ) {
    return true
  }

  if (part.type === "reasoning") {
    return (part as ReasoningChatPart).text.trim().length > 0
  }

  if (part.type === "text") {
    return splitAssistantRenderableTextSegments({
      showToolTraces,
      text: (part as TextChatPart).text
    }).some((segment) => "text" in segment && segment.text.trim().length > 0)
  }

  return false
}

const AssistantTimelinePart = ({
  chatSessionId,
  isStreamdownAnimating,
  isApprovalActionDisabled,
  messageId,
  onApprovalResponse,
  part,
  partIndex,
  showToolTraces,
  streamdownAnimation
}: {
  chatSessionId: string
  isStreamdownAnimating: boolean
  isApprovalActionDisabled: boolean
  messageId: string
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  part: ChatUiMessage["parts"][number]
  partIndex: number
  showToolTraces: boolean
  streamdownAnimation: StreamdownAnimation
}) => {
  if (part.type === "file") {
    return <AssistantFilePartTimeline part={part as FileChatPart} />
  }

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
        isStreamdownAnimating={isStreamdownAnimating}
        messageId={messageId}
        partIndex={partIndex}
        showToolTraces={showToolTraces}
        streamdownAnimation={streamdownAnimation}
        text={textPart.text}
      />
    )
  }

  if (part.type === "source-document") {
    return (
      <AssistantSourceDocumentPartTimeline
        part={part as SourceDocumentChatPart}
      />
    )
  }

  if (part.type === "source-url") {
    return <AssistantSourceUrlPartTimeline part={part as SourceUrlChatPart} />
  }

  if (
    isToolUIPart(part as never) &&
    shouldRenderAssistantToolPart({
      showToolTraces,
      state: (part as ChatToolPart).state
    })
  ) {
    return (
      <StructuredToolTraceCard
        chatSessionId={chatSessionId}
        isApprovalActionDisabled={isApprovalActionDisabled}
        onApprovalResponse={(toolPart, approved, options) => {
          onApprovalResponse(toolPart as ChatToolPart, approved, options)
        }}
        part={part as never}
      />
    )
  }

  return null
}

export const AssistantMessageTimeline = ({
  chatSessionId,
  className,
  isStreamdownAnimating,
  isApprovalActionDisabled,
  message,
  onApprovalResponse,
  showToolTraces,
  streamdownAnimation
}: {
  chatSessionId: string
  className?: string
  isStreamdownAnimating: boolean
  isApprovalActionDisabled: boolean
  message: ChatUiMessage
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  showToolTraces: boolean
  streamdownAnimation: StreamdownAnimation
}) => {
  const { t } = useI18n()
  const shouldRenderToolsAsBody = !message.parts.some((part) =>
    hasVisibleAssistantBodyPart({
      part,
      showToolTraces
    })
  )

  return (
    <div className={cn("space-y-2", className)}>
      {message.metadata?.continuation ? (
        <div className="ml-1 inline-flex w-fit items-center rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
          {t("chat.messageContinuation")}
        </div>
      ) : null}
      {message.parts.map((part, index) => (
        <AssistantTimelinePart
          chatSessionId={chatSessionId}
          isStreamdownAnimating={isStreamdownAnimating}
          isApprovalActionDisabled={isApprovalActionDisabled}
          key={getTimelinePartKey(message.id, part, index)}
          messageId={message.id}
          onApprovalResponse={onApprovalResponse}
          part={part}
          partIndex={index}
          showToolTraces={showToolTraces || shouldRenderToolsAsBody}
          streamdownAnimation={streamdownAnimation}
        />
      ))}
    </div>
  )
}
