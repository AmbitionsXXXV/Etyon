import { useI18n } from "@etyon/i18n/react"
import { Dropdown } from "@etyon/ui/components/dropdown"
import { Separator } from "@etyon/ui/components/separator"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Popover, ScrollShadow } from "@heroui/react"
import {
  ArrowDown01Icon,
  CheckListIcon,
  CheckmarkCircle01Icon,
  ClipboardIcon,
  Delete02Icon,
  MoreHorizontalIcon,
  ViewIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState } from "react"
import { Streamdown } from "streamdown"

import {
  TodoItemRow,
  TodoStatusIndicator
} from "@/renderer/components/chat/work-entries"
import {
  getActiveTodoIndex,
  getComposerPlanQueueMode,
  getPlanQueueProgress,
  getTodoDisplayLabel
} from "@/renderer/lib/chat/plan-queue"
import type { ComposerPlanQueueProps } from "@/renderer/lib/chat/plan-queue"
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

// Leading status glyph: a pulsing dot while a step is running, else the plan's
// clipboard (warning-tinted) or the neutral todo checklist icon.
const PlanQueueStatusGlyph = ({
  hasPlan,
  isActive
}: {
  hasPlan: boolean
  isActive: boolean
}) => {
  if (isActive) {
    return <TodoStatusIndicator status="in_progress" />
  }

  return (
    <HugeiconsIcon
      className={cn(
        "shrink-0",
        hasPlan ? "text-warning" : "text-muted-foreground"
      )}
      icon={hasPlan ? ClipboardIcon : CheckListIcon}
      size={15}
    />
  )
}

// Saved-plan controls, shown only while a plan is being executed: a view
// popover with the full plan markdown and an overflow menu to mark it done or
// discard it. Migrated verbatim from the former composer plan indicator.
const PlanQueueActions = ({
  isBusy,
  onDismiss,
  onMarkDone,
  planMarkdown,
  title
}: {
  isBusy: boolean
  onDismiss: () => void
  onMarkDone: () => void
  planMarkdown: string
  title: string
}) => {
  const { t } = useI18n()

  const handleAction = (key: string): void => {
    if (key === PLAN_ACTION_DONE_KEY) {
      onMarkDone()
    } else if (key === PLAN_ACTION_DISMISS_KEY) {
      onDismiss()
    }
  }

  return (
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
  )
}

// Icon-only chevron that folds the step list; its own button (not a full-row
// trigger) so it never nests inside another interactive control.
const PlanQueueCollapseToggle = ({
  hasPlan,
  isCollapsed,
  onToggle
}: {
  hasPlan: boolean
  isCollapsed: boolean
  onToggle: () => void
}) => {
  const { t } = useI18n()

  return (
    <Button
      aria-label={
        isCollapsed
          ? t("chat.planIndicator.expandSteps")
          : t("chat.planIndicator.collapseSteps")
      }
      className={cn(
        "size-7 shrink-0",
        hasPlan
          ? "text-warning/80 hover:bg-warning/15 hover:text-warning"
          : "text-muted-foreground hover:bg-muted/60"
      )}
      isIconOnly
      onPress={onToggle}
      size="sm"
      variant="ghost"
    >
      <HugeiconsIcon
        className={cn("transition-transform", !isCollapsed && "rotate-180")}
        icon={ArrowDown01Icon}
        size={16}
      />
    </Button>
  )
}

/**
 * The live plan/todo strip anchored above the composer (same slot as the
 * queued-drafts list). Three faces, chosen by `getComposerPlanQueueMode`:
 * `steps` renders the full run-wide checklist while live todos exist — pinned
 * here so it never jumps around the streaming timeline; `header` shows a saved
 * plan being executed (title + view popover + mark-done/discard) once its run
 * settles and the live todos clear; `hidden` renders nothing. Rendered only when
 * the route passes a `planQueue` prop, so hooks here run unconditionally.
 */
export const ComposerPlanQueue = ({
  isBusy,
  onDismiss,
  onMarkDone,
  plan,
  runId
}: ComposerPlanQueueProps) => {
  const { t } = useI18n()
  const todos = useTodos(runId)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const activeIndex = todos ? getActiveTodoIndex(todos) : -1

  // Keep the running step in view as it advances (and when re-expanding).
  useEffect(() => {
    if (activeIndex < 0 || isCollapsed) {
      return
    }

    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, isCollapsed])

  const mode = getComposerPlanQueueMode({ hasPlan: plan !== undefined, todos })

  if (mode === "hidden") {
    return null
  }

  const stepTodos = todos ?? []
  const progress = getPlanQueueProgress(todos)
  const activeTodo = activeIndex >= 0 ? stepTodos[activeIndex] : undefined
  const activeLabel = activeTodo ? getTodoDisplayLabel(activeTodo) : null
  const isSteps = mode === "steps"

  return (
    <div
      className={cn(
        "mb-2 overflow-hidden rounded-2xl border",
        plan
          ? "border-warning/25 bg-warning/10"
          : "border-border/70 bg-muted/40"
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <PlanQueueStatusGlyph
          hasPlan={plan !== undefined}
          isActive={activeTodo !== undefined}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium text-foreground",
              activeLabel ? "min-w-0 max-w-[50%]" : "min-w-0 flex-1"
            )}
          >
            {plan
              ? t("chat.planIndicator.executing", { title: plan.title })
              : t("chat.workSection.todos")}
          </span>
          {activeLabel ? (
            <span className="min-w-0 flex-1 shimmer truncate text-xs text-muted-foreground">
              {activeLabel}
            </span>
          ) : null}
        </div>
        {isSteps && progress ? (
          <span
            aria-label={t("chat.planIndicator.progress", {
              completed: progress.completed,
              total: progress.total
            })}
            className={cn(
              "shrink-0 text-xs tabular-nums",
              plan ? "text-warning" : "text-muted-foreground"
            )}
          >
            {progress.completed}/{progress.total}
          </span>
        ) : null}
        {plan ? (
          <PlanQueueActions
            isBusy={isBusy}
            onDismiss={onDismiss}
            onMarkDone={onMarkDone}
            planMarkdown={plan.planMarkdown}
            title={plan.title}
          />
        ) : null}
        {isSteps ? (
          <PlanQueueCollapseToggle
            hasPlan={plan !== undefined}
            isCollapsed={isCollapsed}
            onToggle={() => setIsCollapsed((value) => !value)}
          />
        ) : null}
      </div>
      {isSteps && !isCollapsed ? (
        <div
          className={cn(
            "border-t",
            plan ? "border-warning/25" : "border-border/70"
          )}
        >
          <ScrollShadow className="max-h-40">
            <ul className="flex flex-col gap-1 px-3 py-2" ref={listRef}>
              {stepTodos.map((todo, index) => (
                <TodoItemRow key={`${index}-${todo.content}`} todo={todo} />
              ))}
            </ul>
          </ScrollShadow>
        </div>
      ) : null}
    </div>
  )
}
