import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { ChatMessage, ChatMessageActions } from "@heroui-pro/react"
import { PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useCallback, useEffect, useState } from "react"

const COPY_FEEDBACK_RESET_MS = 1600
// HeroUI v3 Button type omits tabIndex, but Tooltip.Trigger's Focusable needs it on the child; spread bypasses the type restriction
const FOCUSABLE_TAB_INDEX = { tabIndex: 0 } as Record<string, unknown>
const MESSAGE_ACTION_CLASS_NAME =
  "size-7 min-w-7 text-muted-foreground hover:text-foreground"

type ResponseAction = "bad" | "good" | null
type MessageActionKind = "bad" | "copy" | "edit" | "good" | "regenerate"

const ASSISTANT_MESSAGE_ACTIONS = [
  "copy",
  "good",
  "bad",
  "regenerate"
] satisfies MessageActionKind[]
const USER_MESSAGE_ACTIONS = [
  "copy",
  "regenerate",
  "edit"
] satisfies MessageActionKind[]

export const MessageActions = ({
  align = "start",
  actions = ASSISTANT_MESSAGE_ACTIONS,
  isRegenerating = false,
  onEdit,
  messageText,
  onRegenerate
}: {
  actions?: readonly MessageActionKind[]
  align?: "end" | "start"
  isRegenerating?: boolean
  onEdit?: () => void
  messageText: string
  onRegenerate: () => void
}) => {
  const { t } = useI18n({ keyPrefix: "chat.messageActions" })
  const [copied, setCopied] = useState(false)
  const [responseAction, setResponseAction] = useState<ResponseAction>(null)

  useEffect(() => {
    if (!copied) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setCopied(false)
    }, COPY_FEEDBACK_RESET_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [copied])

  const copyMessageText = useCallback(async (copyText: string) => {
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }, [])

  const handleCopy = useCallback(() => {
    const copyText = messageText.trim()

    if (!copyText || !navigator.clipboard) {
      return
    }

    void copyMessageText(copyText)
  }, [copyMessageText, messageText])

  const handleBadResponse = useCallback(() => {
    setResponseAction((currentAction) =>
      currentAction === "bad" ? null : "bad"
    )
  }, [])

  const handleGoodResponse = useCallback(() => {
    setResponseAction((currentAction) =>
      currentAction === "good" ? null : "good"
    )
  }, [])

  return (
    <ChatMessageActions
      aria-label={t("label")}
      className={cn(
        "invisible mt-1.5 flex h-8 items-center gap-0.5 px-1 opacity-0 transition-opacity group-hover/message:visible group-hover/message:opacity-100 group-focus-within/message:visible group-focus-within/message:opacity-100",
        align === "end" && "justify-end"
      )}
      role="toolbar"
    >
      {actions.map((action) => {
        if (action === "copy") {
          return (
            <ChatMessageActions.Copy
              aria-label={copied ? t("copied") : t("copy")}
              className={MESSAGE_ACTION_CLASS_NAME}
              isCopied={copied}
              key={action}
              onPress={handleCopy}
              tooltip={copied ? t("copied") : t("copy")}
              type="button"
              {...FOCUSABLE_TAB_INDEX}
            />
          )
        }

        if (action === "good") {
          return (
            <ChatMessageActions.ThumbsUp
              aria-label={t("goodResponse")}
              aria-pressed={responseAction === "good"}
              className={cn(
                MESSAGE_ACTION_CLASS_NAME,
                responseAction === "good" && "text-foreground"
              )}
              key={action}
              onPress={handleGoodResponse}
              tooltip={t("goodResponse")}
              type="button"
              variant={responseAction === "good" ? "secondary" : "ghost"}
              {...FOCUSABLE_TAB_INDEX}
            />
          )
        }

        if (action === "bad") {
          return (
            <ChatMessageActions.ThumbsDown
              aria-label={t("badResponse")}
              aria-pressed={responseAction === "bad"}
              className={cn(
                MESSAGE_ACTION_CLASS_NAME,
                responseAction === "bad" && "text-foreground"
              )}
              key={action}
              onPress={handleBadResponse}
              tooltip={t("badResponse")}
              type="button"
              variant={responseAction === "bad" ? "secondary" : "ghost"}
              {...FOCUSABLE_TAB_INDEX}
            />
          )
        }

        if (action === "edit") {
          return (
            <ChatMessage.Action
              aria-label={t("edit")}
              className={MESSAGE_ACTION_CLASS_NAME}
              isDisabled={!onEdit || isRegenerating}
              key={action}
              onPress={() => onEdit?.()}
              tooltip={!onEdit || isRegenerating ? undefined : t("edit")}
              type="button"
              variant="ghost"
              {...FOCUSABLE_TAB_INDEX}
            >
              <HugeiconsIcon
                icon={PencilEdit02Icon}
                size={15}
                strokeWidth={2}
              />
            </ChatMessage.Action>
          )
        }

        return (
          <ChatMessageActions.Regenerate
            aria-label={t("regenerate")}
            className={MESSAGE_ACTION_CLASS_NAME}
            isDisabled={isRegenerating}
            key={action}
            onPress={onRegenerate}
            tooltip={isRegenerating ? undefined : t("regenerate")}
            type="button"
            {...FOCUSABLE_TAB_INDEX}
          />
        )
      })}
    </ChatMessageActions>
  )
}

export { ASSISTANT_MESSAGE_ACTIONS, USER_MESSAGE_ACTIONS }
