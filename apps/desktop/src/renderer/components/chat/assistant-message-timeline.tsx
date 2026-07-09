import { useI18n } from "@etyon/i18n/react"
import type { StreamdownAnimation } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { ChainOfThought } from "@heroui-pro/react"
import { BrowserIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useState } from "react"
import type { ComponentPropsWithoutRef } from "react"
import { Streamdown } from "streamdown"
import type { Components, ExtraProps } from "streamdown"

import { ImagenMessageImage } from "@/renderer/components/chat/imagen-message"
import { StructuredToolTraceCard } from "@/renderer/components/chat/message-tool-trace"
import {
  getPublishedArtifactRef,
  isArtifactToolPart
} from "@/renderer/lib/chat/artifact-panel"
import type { ChatArtifactRef } from "@/renderer/lib/chat/artifact-panel"
import {
  buildAssistantChainEntries,
  getAssistantBodyText,
  getRunLimitData,
  getUrlHost,
  hasPendingApproval,
  isReferencePart,
  openExternalUrl
} from "@/renderer/lib/chat/assistant-message-timeline"
import type {
  ChainEntry,
  ChatToolPart,
  ChatUiMessage,
  FileChatPart,
  SourceDocumentChatPart,
  SourceUrlChatPart
} from "@/renderer/lib/chat/assistant-message-timeline"
import { isImagenToolPart } from "@/renderer/lib/chat/imagen-message"
import { getStreamdownAnimateOptions } from "@/renderer/lib/chat/streamdown-settings"
import type { AssistantToolApprovalResponseOptions } from "@/renderer/lib/chat/tool-ui"

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
// CHAIN_OF_THOUGHT_ANCHOR

const AssistantChainOfThought = ({
  entries,
  isApprovalActionDisabled,
  isStreaming,
  onApprovalResponse
}: {
  entries: ChainEntry[]
  isApprovalActionDisabled: boolean
  isStreaming: boolean
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
}) => {
  const { t } = useI18n()
  const shouldAutoExpand = isStreaming || hasPendingApproval(entries)
  const [isExpanded, setIsExpanded] = useState(shouldAutoExpand)

  useEffect(() => {
    if (shouldAutoExpand) {
      setIsExpanded(true)
    }
  }, [shouldAutoExpand])

  if (entries.length === 0) {
    return null
  }

  return (
    <ChainOfThought
      className="rounded-xl border border-border/70 bg-background/60"
      isExpanded={isExpanded}
      isStreaming={isStreaming}
      onExpandedChange={setIsExpanded}
    >
      <ChainOfThought.Trigger className="px-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{t("chat.chainOfThought.label")}</span>
          <span className="shrink-0 text-[0.625rem] text-muted-foreground">
            {t("chat.chainOfThought.stepCount", { count: entries.length })}
          </span>
        </span>
      </ChainOfThought.Trigger>
      <ChainOfThought.Content className="px-3">
        <ChainOfThought.Steps>
          {entries.map((entry) =>
            entry.kind === "reasoning" ? (
              <ChainOfThought.Step key={entry.key}>
                <p className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
                  {entry.text}
                </p>
              </ChainOfThought.Step>
            ) : (
              <ChainOfThought.Step key={entry.key}>
                <StructuredToolTraceCard
                  isApprovalActionDisabled={isApprovalActionDisabled}
                  onApprovalResponse={(toolPart, approved, options) => {
                    onApprovalResponse(
                      toolPart as ChatToolPart,
                      approved,
                      options
                    )
                  }}
                  part={entry.part as never}
                  repeatCount={entry.repeatCount}
                />
              </ChainOfThought.Step>
            )
          )}
        </ChainOfThought.Steps>
      </ChainOfThought.Content>
    </ChainOfThought>
  )
}

const AssistantArtifactCard = ({
  onOpenArtifact,
  part
}: {
  onOpenArtifact?: (artifact: ChatArtifactRef) => void
  part: ChatToolPart
}) => {
  const { t } = useI18n()
  const publishedArtifact = getPublishedArtifactRef(part)
  const isFailed =
    part.state === "output-error" || part.state === "output-denied"
  const pendingTitle =
    typeof (part.input as { title?: unknown } | undefined)?.title === "string"
      ? (part.input as { title: string }).title
      : null

  if (isFailed) {
    return (
      <div className="inline-flex max-w-full items-center gap-2.5 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-xs">
        <HugeiconsIcon
          className="shrink-0 text-danger"
          icon={BrowserIcon}
          size={18}
          strokeWidth={2}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium text-foreground">
            {pendingTitle ?? t("chat.artifact.badge")}
          </span>
          <span className="truncate text-danger">
            {t("chat.artifact.publishFailed")}
          </span>
        </span>
      </div>
    )
  }

  if (!publishedArtifact) {
    return (
      <div className="inline-flex max-w-full animate-pulse items-center gap-2.5 rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-xs">
        <HugeiconsIcon
          className="shrink-0 text-muted-foreground"
          icon={BrowserIcon}
          size={18}
          strokeWidth={2}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium text-foreground">
            {pendingTitle ?? t("chat.artifact.badge")}
          </span>
          <span className="truncate text-muted-foreground">
            {t("chat.artifact.publishing")}
          </span>
        </span>
      </div>
    )
  }

  return (
    <button
      aria-label={t("chat.artifact.open", { title: publishedArtifact.title })}
      className="group inline-flex max-w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted"
      onClick={() => onOpenArtifact?.(publishedArtifact)}
      type="button"
    >
      <HugeiconsIcon
        className="shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
        icon={BrowserIcon}
        size={18}
        strokeWidth={2}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium text-foreground">
          {publishedArtifact.title}
        </span>
        <span className="truncate text-muted-foreground">
          {t("chat.artifact.badge")} · {publishedArtifact.path}
        </span>
      </span>
    </button>
  )
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

const AssistantReferencePart = ({
  part
}: {
  part: ChatUiMessage["parts"][number]
}) => {
  if (part.type === "file") {
    return <AssistantFilePartTimeline part={part as FileChatPart} />
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

  return null
}

export const AssistantMessageTimeline = ({
  className,
  isStreamdownAnimating,
  isApprovalActionDisabled,
  message,
  onApprovalResponse,
  onOpenArtifact,
  sessionId,
  streamdownAnimation
}: {
  className?: string
  isStreamdownAnimating: boolean
  isApprovalActionDisabled: boolean
  message: ChatUiMessage
  onApprovalResponse: (
    part: ChatToolPart,
    approved: boolean,
    options?: AssistantToolApprovalResponseOptions
  ) => void
  onOpenArtifact?: (artifact: ChatArtifactRef) => void
  sessionId: string
  streamdownAnimation: StreamdownAnimation
}) => {
  const { t } = useI18n()
  const chainEntries = buildAssistantChainEntries(message)
  const bodyText = getAssistantBodyText(message)
  const runLimit = getRunLimitData(message)
  const artifactParts = message.parts.filter((part) =>
    isArtifactToolPart(part)
  ) as ChatToolPart[]
  const imagenParts = message.parts.filter((part) =>
    isImagenToolPart(part)
  ) as ChatToolPart[]
  const referenceParts = message.parts
    .map((part, index) => ({ index, part }))
    .filter(({ part }) => isReferencePart(part))

  return (
    <div className={cn("space-y-2", className)}>
      <AssistantChainOfThought
        entries={chainEntries}
        isApprovalActionDisabled={isApprovalActionDisabled}
        isStreaming={isStreamdownAnimating}
        onApprovalResponse={onApprovalResponse}
      />
      <AssistantMarkdownContent
        isAnimating={isStreamdownAnimating}
        streamdownAnimation={streamdownAnimation}
        text={bodyText}
      />
      {runLimit ? (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t("chat.runLimit.notice", { maxSteps: runLimit.maxSteps })}
        </p>
      ) : null}
      {artifactParts.map((part) => (
        <AssistantArtifactCard
          key={`${message.id}-artifact-${part.toolCallId}`}
          onOpenArtifact={onOpenArtifact}
          part={part}
        />
      ))}
      {imagenParts.map((part) => (
        <ImagenMessageImage
          key={`${message.id}-imagen-${part.toolCallId}`}
          part={part}
          sessionId={sessionId}
        />
      ))}
      {referenceParts.map(({ index, part }) => (
        <AssistantReferencePart
          key={`${message.id}-reference-${index}`}
          part={part}
        />
      ))}
    </div>
  )
}
