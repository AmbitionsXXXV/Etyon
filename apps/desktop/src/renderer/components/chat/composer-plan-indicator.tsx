import { useI18n } from "@etyon/i18n/react"
import { Dropdown } from "@etyon/ui/components/dropdown"
import { Separator } from "@etyon/ui/components/separator"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Popover, ScrollShadow } from "@heroui/react"
import {
  CheckmarkCircle01Icon,
  ClipboardIcon,
  Delete02Icon,
  MoreHorizontalIcon,
  ViewIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Streamdown } from "streamdown"

import { getPlanIndicatorProgress } from "@/renderer/lib/chat/plan-indicator"
import type { ComposerPlanIndicatorProps } from "@/renderer/lib/chat/plan-indicator"
import { useTodos } from "@/renderer/lib/chat/todo-store"

// Compact markdown styling for the plan preview inside the view popover — a
// trimmed sibling of the timeline body class, sized for a narrow overlay.
const PLAN_MARKDOWN_CLASS_NAME = cn(
  "min-w-0 text-sm leading-6 text-foreground",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded-md [&_code]:bg-muted/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold",
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold",
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_li]:my-1",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_p]:my-2",
  "[&_pre]:m-0 [&_pre]:max-w-full [&_pre]:overflow-x-auto",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
)

const PLAN_ACTION_DONE_KEY = "done"
const PLAN_ACTION_DISMISS_KEY = "dismiss"

/**
 * In-flow row above the composer while a saved plan is being executed
 * (`status === "implementing"`). Warning-tinted to match the plan pill; shows the
 * plan title, live `{completed}/{total}` progress from the todo store while a run
 * streams, a view popover with the full plan markdown, and an overflow menu to
 * mark the plan done or discard it. Rendered only when the route passes a
 * `planIndicator` prop, so hooks here run unconditionally.
 */
export const ComposerPlanIndicator = ({
  isBusy,
  onDismiss,
  onMarkDone,
  planMarkdown,
  runId,
  title
}: ComposerPlanIndicatorProps) => {
  const { t } = useI18n()
  const progress = getPlanIndicatorProgress(useTodos(runId))

  const handleAction = (key: string): void => {
    if (key === PLAN_ACTION_DONE_KEY) {
      onMarkDone()
    } else if (key === PLAN_ACTION_DISMISS_KEY) {
      onDismiss()
    }
  }

  return (
    <div className="mb-2 flex items-center gap-2 rounded-2xl border border-warning/25 bg-warning/10 px-3 py-2">
      <HugeiconsIcon
        className="shrink-0 text-warning"
        icon={ClipboardIcon}
        size={15}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {t("chat.planIndicator.executing", { title })}
      </span>
      {progress ? (
        <span
          aria-label={t("chat.planIndicator.progress", {
            completed: progress.completed,
            total: progress.total
          })}
          className="shrink-0 text-xs text-warning tabular-nums"
        >
          {progress.completed}/{progress.total}
        </span>
      ) : null}
      <div className="flex shrink-0 items-center gap-0.5">
        <Popover>
          <Popover.Trigger
            aria-label={t("chat.planIndicator.view")}
            className="inline-flex size-7 items-center justify-center rounded-lg text-warning/80 transition-colors hover:bg-warning/15 hover:text-warning"
          >
            <HugeiconsIcon icon={ViewIcon} size={15} />
          </Popover.Trigger>
          <Popover.Content className="w-80" placement="top end">
            <Popover.Dialog className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-foreground">
                {title}
              </span>
              <ScrollShadow className="max-h-[360px] rounded-lg border border-border/60 bg-background/50 px-3 py-2">
                <Streamdown
                  animated={false}
                  className={PLAN_MARKDOWN_CLASS_NAME}
                  isAnimating={false}
                  skipHtml
                >
                  {planMarkdown}
                </Streamdown>
              </ScrollShadow>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
        <Dropdown>
          <Button
            aria-label={t("chat.planIndicator.more")}
            className="size-7 text-warning/80 hover:bg-warning/15 hover:text-warning"
            isDisabled={isBusy}
            isIconOnly
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
          </Button>
          <Dropdown.Popover className="min-w-52 rounded-2xl border border-border/70 bg-popover/95 p-1.5 text-popover-foreground shadow-overlay backdrop-blur-xl">
            <Dropdown.Menu onAction={(key) => handleAction(String(key))}>
              <Dropdown.Item
                id={PLAN_ACTION_DONE_KEY}
                textValue={t("chat.planIndicator.markDone")}
              >
                <HugeiconsIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  icon={CheckmarkCircle01Icon}
                  strokeWidth={2}
                />
                <span>{t("chat.planIndicator.markDone")}</span>
              </Dropdown.Item>
              <Separator className="my-1" />
              <Dropdown.Item
                id={PLAN_ACTION_DISMISS_KEY}
                textValue={t("chat.planIndicator.dismiss")}
                variant="danger"
              >
                <HugeiconsIcon
                  className="size-4 shrink-0 text-danger"
                  icon={Delete02Icon}
                  strokeWidth={2}
                />
                <span>{t("chat.planIndicator.dismiss")}</span>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
    </div>
  )
}
