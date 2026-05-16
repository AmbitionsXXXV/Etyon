import { useI18n } from "@etyon/i18n/react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@etyon/ui/components/tooltip"
import { cn } from "@etyon/ui/lib/utils"
import { Button } from "@heroui/react"
import {
  ArrowReloadHorizontalIcon,
  CheckmarkCircle01Icon,
  Copy01Icon,
  ThumbsDownIcon,
  ThumbsUpIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { IconSvgElement } from "@hugeicons/react"
import { useCallback, useEffect, useState } from "react"

const COPY_FEEDBACK_RESET_MS = 1600

type ResponseAction = "bad" | "good" | null

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
  <Tooltip>
    <TooltipTrigger
      render={
        <Button
          aria-label={ariaLabel}
          aria-pressed={isPressed}
          className={cn(
            "size-7 min-w-7 text-muted-foreground hover:text-foreground",
            isPressed && "text-foreground"
          )}
          isDisabled={isDisabled}
          isIconOnly
          onPress={onPress}
          size="sm"
          type="button"
          variant={isPressed ? "secondary" : "ghost"}
        >
          <HugeiconsIcon icon={icon} size={15} strokeWidth={2} />
        </Button>
      }
    />
    <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
  </Tooltip>
)

export const MessageActions = ({
  isRegenerating = false,
  messageText,
  onRegenerate
}: {
  isRegenerating?: boolean
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
    <div
      aria-label={t("label")}
      className="mt-1.5 flex items-center gap-0.5 px-1"
      role="toolbar"
    >
      <MessageActionButton
        ariaLabel={copied ? t("copied") : t("copy")}
        icon={copied ? CheckmarkCircle01Icon : Copy01Icon}
        onPress={handleCopy}
        tooltipLabel={copied ? t("copied") : t("copy")}
      />
      <MessageActionButton
        ariaLabel={t("goodResponse")}
        icon={ThumbsUpIcon}
        isPressed={responseAction === "good"}
        onPress={handleGoodResponse}
        tooltipLabel={t("goodResponse")}
      />
      <MessageActionButton
        ariaLabel={t("badResponse")}
        icon={ThumbsDownIcon}
        isPressed={responseAction === "bad"}
        onPress={handleBadResponse}
        tooltipLabel={t("badResponse")}
      />
      <MessageActionButton
        ariaLabel={t("regenerate")}
        icon={ArrowReloadHorizontalIcon}
        isDisabled={isRegenerating}
        onPress={onRegenerate}
        tooltipLabel={t("regenerate")}
      />
    </div>
  )
}
