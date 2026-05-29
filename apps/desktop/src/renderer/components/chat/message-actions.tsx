import { useI18n } from "@etyon/i18n/react"
import { cn } from "@etyon/ui/lib/utils"
import { ChatMessage, ChatMessageActions } from "@heroui-pro/react"
import {
  ArrowReloadHorizontalIcon,
  CheckmarkCircle01Icon,
  Copy01Icon,
  PencilEdit02Icon,
  ThumbsDownIcon,
  ThumbsUpIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import { useCallback, useEffect, useState } from "react"

const COPY_FEEDBACK_RESET_MS = 1600

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

const MessageActionButton = ({
  ariaLabel,
  icon,
  isDisabled = false,
  isPressed,
  onPress,
  tooltipLabel
}: {
  ariaLabel: string
  icon: IconSvgElement
  isDisabled?: boolean
  isPressed?: boolean
  onPress: () => void
  tooltipLabel: string
}) => (
  <ChatMessage.Action
    aria-label={ariaLabel}
    aria-pressed={isPressed}
    className={cn(
      "size-7 min-w-7 text-muted-foreground hover:text-foreground",
      isPressed && "text-foreground"
    )}
    isDisabled={isDisabled}
    onPress={onPress}
    tooltip={isDisabled ? undefined : tooltipLabel}
    type="button"
    variant={isPressed ? "secondary" : "ghost"}
  >
    <HugeiconsIcon icon={icon} size={15} strokeWidth={2} />
  </ChatMessage.Action>
)

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
            <MessageActionButton
              ariaLabel={copied ? t("copied") : t("copy")}
              icon={copied ? CheckmarkCircle01Icon : Copy01Icon}
              key={action}
              onPress={handleCopy}
              tooltipLabel={copied ? t("copied") : t("copy")}
            />
          )
        }

        if (action === "good") {
          return (
            <MessageActionButton
              ariaLabel={t("goodResponse")}
              icon={ThumbsUpIcon}
              isPressed={responseAction === "good"}
              key={action}
              onPress={handleGoodResponse}
              tooltipLabel={t("goodResponse")}
            />
          )
        }

        if (action === "bad") {
          return (
            <MessageActionButton
              ariaLabel={t("badResponse")}
              icon={ThumbsDownIcon}
              isPressed={responseAction === "bad"}
              key={action}
              onPress={handleBadResponse}
              tooltipLabel={t("badResponse")}
            />
          )
        }

        if (action === "edit") {
          return (
            <MessageActionButton
              ariaLabel={t("edit")}
              icon={PencilEdit02Icon}
              isDisabled={!onEdit || isRegenerating}
              key={action}
              onPress={() => onEdit?.()}
              tooltipLabel={t("edit")}
            />
          )
        }

        return (
          <MessageActionButton
            ariaLabel={t("regenerate")}
            icon={ArrowReloadHorizontalIcon}
            isDisabled={isRegenerating}
            key={action}
            onPress={onRegenerate}
            tooltipLabel={t("regenerate")}
          />
        )
      })}
    </ChatMessageActions>
  )
}

export { ASSISTANT_MESSAGE_ACTIONS, USER_MESSAGE_ACTIONS }
