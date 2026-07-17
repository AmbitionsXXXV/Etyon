import type {
  ChatMention,
  ProjectSnapshotItem,
  PromptTemplate
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { PromptInput as HeroPromptInput } from "@heroui-pro/react"
import type { ChatStatus } from "@heroui-pro/react"
import {
  Kbd,
  Popover,
  ProgressCircle,
  ToggleButton,
  Tooltip
} from "@heroui/react"
import {
  Attachment01Icon,
  Cancel01Icon,
  CubeIcon,
  PencilEdit02Icon,
  SentIcon,
  StopIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Editor } from "@tiptap/core"
import { Placeholder } from "@tiptap/extension-placeholder"
import { EditorContent, useEditor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import type { FileUIPart } from "ai"
import { motion } from "motion/react"
import type {
  ChangeEvent,
  ClipboardEvent,
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactNode
} from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  ComposerPlanHint,
  usePlanModeHint
} from "@/renderer/components/chat/composer-plan-hint"
import { ComposerPlanQueue } from "@/renderer/components/chat/composer-plan-queue"
import {
  ACCEPTED_ATTACHMENT_MEDIA_TYPES,
  attachmentToFilePart,
  classifyAttachmentCandidate
} from "@/renderer/lib/chat/attachments"
import type {
  AttachmentRejectionReason,
  ComposerAttachment
} from "@/renderer/lib/chat/attachments"
import type { ComposerPlanQueueProps } from "@/renderer/lib/chat/plan-queue"
import { ProjectMentionExtension } from "@/renderer/lib/chat/project-mention-extension"
import {
  CHAT_AGENT_MODE_OPTIONS,
  COMPOSITION_SUBMIT_GUARD_MS,
  EMPTY_PROMPT_TEMPLATE_ITEMS,
  EMPTY_QUEUED_PROMPT_MESSAGES,
  PERMISSION_MODE_OPTIONS,
  PROJECT_MENTION_NODE_TYPE,
  PROMPT_COMMAND_PALETTE_ITEM_LIMIT,
  applyPlanCommandPrefixToPromptEditorJson,
  buildPromptEditorJsonFromMessage,
  buildPromptMentionItemGroups,
  filterPromptCommandPaletteItems,
  createPromptTemplateCommandText,
  createPromptMentionItemsByKey,
  createMentionFromPromptMentionItem,
  extractPromptEditorPayload,
  getActivePromptMentionItemKey,
  getPromptEditorActiveCommandPaletteRange,
  getPromptEditorActiveMentionRange,
  getPromptEditorActivePromptTemplateCommandRange,
  getPromptMentionItemIcon,
  getPromptMentionItemKey,
  getPromptMentionItemName,
  getPromptMentionSelectionItems,
  getPromptSkillDescription,
  getPromptSkillDisplayName,
  getPromptSkillSourceLabel,
  getPromptTemplateArgumentHints,
  handleIndexedSuggestionKeyDown,
  isPlanModeKeyboardShortcut,
  isPromptImeConfirmKeyDown,
  isPromptNativeCompositionKeyDown,
  isPromptSubmitKeyDown,
  scrollActiveMentionItemIntoView
} from "@/renderer/lib/chat/prompt-input"
import type {
  PromptCommandPaletteItem,
  PromptMentionItemGroup,
  PromptMentionQueryState,
  PromptMentionItem,
  PromptSkillMentionItem,
  PromptMentionTrigger,
  QueuedPromptMessage
} from "@/renderer/lib/chat/prompt-input"
import { getNextPermissionMode } from "@/shared/agents/permission-mode"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"
import { getNextChatAgentMode } from "@/shared/chat/agent-mode"
import type { ChatAgentMode } from "@/shared/chat/agent-mode"

const MentionSkillRowContent = ({
  globalSkillSourceLabel,
  isActive,
  item
}: {
  globalSkillSourceLabel: string
  isActive: boolean
  item: PromptSkillMentionItem
}) => (
  <>
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span
        className={cn(
          "shrink-0 truncate font-medium",
          isActive ? "text-accent-foreground" : "text-foreground"
        )}
      >
        {getPromptSkillDisplayName(item)}
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          isActive ? "text-accent-foreground/85" : "text-muted-foreground"
        )}
      >
        {getPromptSkillDescription(item)}
      </span>
    </span>
    <span
      className={cn(
        "ml-3 max-w-24 shrink-0 truncate",
        isActive ? "text-accent-foreground/80" : "text-muted-foreground"
      )}
    >
      {getPromptSkillSourceLabel({
        globalLabel: globalSkillSourceLabel,
        item
      })}
    </span>
  </>
)

const MentionDefaultRowContent = ({
  isActive,
  item
}: {
  isActive: boolean
  item: ProjectSnapshotItem
}) => (
  <span className="min-w-0 flex-1">
    <span
      className={cn(
        "block truncate font-medium",
        isActive ? "text-accent-foreground" : "text-foreground"
      )}
    >
      {getPromptMentionItemName(item)}
    </span>
    <span
      className={cn(
        "block truncate",
        isActive ? "text-accent-foreground/85" : "text-muted-foreground"
      )}
    >
      {item.relativePath}
    </span>
  </span>
)

const PromptTemplateSuggestions = ({
  activeItemIndex,
  currentEmptyLabel,
  groupLabel,
  isLoading,
  items,
  onItemClick,
  onItemRef
}: {
  activeItemIndex: number
  currentEmptyLabel: string
  groupLabel: string
  isLoading: boolean
  items: PromptTemplate[]
  onItemClick: (event: MouseEvent<HTMLButtonElement>) => void
  onItemRef: (itemPath: string, element: HTMLButtonElement | null) => void
}) => {
  const showLoadingState = isLoading && items.length === 0
  const showEmptyState = !isLoading && items.length === 0

  return (
    <div className="absolute right-4 bottom-full left-4 z-20 mb-2 overflow-hidden rounded-[1.35rem] bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
      <div className="max-h-80 overflow-y-auto p-1.5">
        {(showLoadingState || showEmptyState) && (
          <div className="p-3 text-xs text-muted-foreground">
            {currentEmptyLabel}
          </div>
        )}

        {items.length > 0 && (
          <div>
            <div className="px-3 py-1 text-[0.68rem] font-medium tracking-normal text-muted-foreground uppercase">
              {groupLabel}
            </div>
            {items.map((item, itemIndex) => {
              const argumentHints = getPromptTemplateArgumentHints(item)
              const isActive = itemIndex === activeItemIndex

              return (
                <button
                  className={cn(
                    "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                  data-template-path={item.path}
                  key={item.path}
                  onClick={onItemClick}
                  ref={(element) => {
                    onItemRef(item.path, element)
                  }}
                  type="button"
                >
                  <HugeiconsIcon
                    className={cn(
                      "size-4 shrink-0",
                      isActive
                        ? "text-accent-foreground/85"
                        : "text-muted-foreground"
                    )}
                    icon={CubeIcon}
                    strokeWidth={2}
                  />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="shrink-0 truncate font-medium">
                      {item.name}
                    </span>
                    {item.description ? (
                      <span
                        className={cn(
                          "min-w-0 truncate",
                          isActive
                            ? "text-accent-foreground/85"
                            : "text-muted-foreground"
                        )}
                      >
                        {item.description}
                      </span>
                    ) : null}
                    {argumentHints.length > 0 ? (
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[0.68rem]",
                          isActive
                            ? "text-accent-foreground/75"
                            : "text-muted-foreground"
                        )}
                      >
                        {argumentHints.join(" ")}
                      </span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const PromptCommandPaletteSuggestions = ({
  activeItemIndex,
  currentEmptyLabel,
  groupLabel,
  items,
  onItemClick,
  onItemRef
}: {
  activeItemIndex: number
  currentEmptyLabel: string
  groupLabel: string
  items: PromptCommandPaletteItem[]
  onItemClick: (event: MouseEvent<HTMLButtonElement>) => void
  onItemRef: (itemId: string, element: HTMLButtonElement | null) => void
}) => (
  <div className="absolute right-4 bottom-full left-4 z-20 mb-2 overflow-hidden rounded-[1.35rem] bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
    <div className="max-h-80 overflow-y-auto p-1.5">
      {items.length === 0 ? (
        <div className="p-3 text-xs text-muted-foreground">
          {currentEmptyLabel}
        </div>
      ) : (
        <div>
          <div className="px-3 py-1 text-[0.68rem] font-medium tracking-normal text-muted-foreground uppercase">
            {groupLabel}
          </div>
          {items.map((item, itemIndex) => {
            const isActive = itemIndex === activeItemIndex
            const itemIcon = CubeIcon

            return (
              <button
                className={cn(
                  "flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
                data-command-id={item.id}
                key={item.id}
                onClick={onItemClick}
                ref={(element) => {
                  onItemRef(item.id, element)
                }}
                type="button"
              >
                <HugeiconsIcon
                  className={cn(
                    "size-4 shrink-0",
                    isActive
                      ? "text-accent-foreground/85"
                      : "text-muted-foreground"
                  )}
                  icon={itemIcon}
                  strokeWidth={2}
                />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="shrink-0 font-mono text-[0.75rem]">
                    {item.command}
                  </span>
                  <span className="shrink-0 truncate font-medium">
                    {item.label}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      isActive
                        ? "text-accent-foreground/85"
                        : "text-muted-foreground"
                    )}
                  >
                    {item.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  </div>
)

const MentionItemRow = ({
  activeItemIndex,
  globalSkillSourceLabel,
  item,
  mentionSelectionItems,
  onItemClick,
  onItemRef
}: {
  activeItemIndex: number
  globalSkillSourceLabel: string
  item: PromptMentionItem
  mentionSelectionItems: PromptMentionItem[]
  onItemClick: (event: MouseEvent<HTMLButtonElement>) => void
  onItemRef: (itemKey: string, element: HTMLButtonElement | null) => void
}) => {
  const itemKey = getPromptMentionItemKey(item)
  const itemIndex = mentionSelectionItems.findIndex(
    (mentionItem) => getPromptMentionItemKey(mentionItem) === itemKey
  )
  const itemIcon = getPromptMentionItemIcon(item)
  const isActive = itemIndex === activeItemIndex
  const isSkillItem = item.kind === "skill"

  return (
    <button
      className={cn(
        "flex w-full rounded-xl text-left transition-colors",
        isSkillItem
          ? "h-11 items-center gap-3 px-3 text-sm"
          : "items-start gap-3 px-3 py-2 text-xs/relaxed",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
      )}
      data-item-key={itemKey}
      key={itemKey}
      onClick={onItemClick}
      ref={(element) => {
        onItemRef(itemKey, element)
      }}
      type="button"
    >
      <HugeiconsIcon
        className={cn(
          "shrink-0",
          isActive ? "text-accent-foreground/85" : "text-muted-foreground",
          isSkillItem ? "size-4" : "mt-0.5 size-3.5"
        )}
        icon={itemIcon}
        strokeWidth={2}
      />
      {isSkillItem ? (
        <MentionSkillRowContent
          globalSkillSourceLabel={globalSkillSourceLabel}
          isActive={isActive}
          item={item}
        />
      ) : (
        <MentionDefaultRowContent isActive={isActive} item={item} />
      )}
    </button>
  )
}

const MentionSuggestions = ({
  activeItemIndex,
  currentEmptyLabel,
  globalSkillSourceLabel,
  groups,
  isLoading,
  isSkillMentionActive,
  mentionSelectionItems,
  onItemClick,
  onItemRef
}: {
  activeItemIndex: number
  currentEmptyLabel: string
  globalSkillSourceLabel: string
  groups: PromptMentionItemGroup[]
  isLoading: boolean
  isSkillMentionActive: boolean
  mentionSelectionItems: PromptMentionItem[]
  onItemClick: (event: MouseEvent<HTMLButtonElement>) => void
  onItemRef: (itemKey: string, element: HTMLButtonElement | null) => void
}) => {
  const hasMentionItems = mentionSelectionItems.length > 0
  const showLoadingState = isLoading && !hasMentionItems
  const showEmptyState = !isLoading && !hasMentionItems

  return (
    <div
      className={cn(
        "absolute right-4 bottom-full left-4 z-20 mb-2 overflow-hidden bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
        isSkillMentionActive ? "rounded-[1.35rem]" : "rounded-2xl"
      )}
    >
      <div
        className={cn(
          "overflow-y-auto",
          isSkillMentionActive ? "max-h-80 p-1.5" : "max-h-72 p-1"
        )}
      >
        {(showLoadingState || showEmptyState) && (
          <div className="p-3 text-xs text-muted-foreground">
            {currentEmptyLabel}
          </div>
        )}

        {hasMentionItems &&
          groups.map((group) => (
            <div className={cn(!isSkillMentionActive && "py-1")} key={group.id}>
              {isSkillMentionActive ? null : (
                <div className="px-3 py-1 text-[0.68rem] font-medium tracking-normal text-muted-foreground uppercase">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => (
                <MentionItemRow
                  activeItemIndex={activeItemIndex}
                  globalSkillSourceLabel={globalSkillSourceLabel}
                  item={item}
                  key={getPromptMentionItemKey(item)}
                  mentionSelectionItems={mentionSelectionItems}
                  onItemClick={onItemClick}
                  onItemRef={onItemRef}
                />
              ))}
            </div>
          ))}
      </div>
    </div>
  )
}

const PromptInputSuggestions = ({
  activeCommandPaletteRange,
  activeItemIndex,
  activeMentionRange,
  activePromptTemplateRange,
  commandPaletteEmptyLabel,
  commandPaletteGroupLabel,
  commandPaletteItems,
  currentMentionEmptyLabel,
  handleCommandPaletteItemRef,
  handleMentionItemRef,
  handlePromptTemplateRef,
  handleSelectCommandPaletteItemClick,
  handleSelectMentionItemClick,
  handleSelectPromptTemplateClick,
  isLoadingMentionItems,
  isLoadingPromptTemplateItems,
  isSkillMentionActive,
  mentionGlobalSkillSourceLabel,
  mentionItemGroups,
  mentionSelectionItems,
  promptTemplateEmptyLabel,
  promptTemplateGroupLabel,
  promptTemplateItems
}: {
  activeCommandPaletteRange: unknown
  activeItemIndex: number
  activeMentionRange: unknown
  activePromptTemplateRange: unknown
  commandPaletteEmptyLabel: string
  commandPaletteGroupLabel: string
  commandPaletteItems: PromptCommandPaletteItem[]
  currentMentionEmptyLabel: string
  handleCommandPaletteItemRef: (
    itemId: string,
    element: HTMLButtonElement | null
  ) => void
  handleMentionItemRef: (
    itemKey: string,
    element: HTMLButtonElement | null
  ) => void
  handlePromptTemplateRef: (
    itemPath: string,
    element: HTMLButtonElement | null
  ) => void
  handleSelectCommandPaletteItemClick: (
    event: MouseEvent<HTMLButtonElement>
  ) => void
  handleSelectMentionItemClick: (event: MouseEvent<HTMLButtonElement>) => void
  handleSelectPromptTemplateClick: (
    event: MouseEvent<HTMLButtonElement>
  ) => void
  isLoadingMentionItems: boolean
  isLoadingPromptTemplateItems: boolean
  isSkillMentionActive: boolean
  mentionGlobalSkillSourceLabel: string
  mentionItemGroups: PromptMentionItemGroup[]
  mentionSelectionItems: PromptMentionItem[]
  promptTemplateEmptyLabel: string
  promptTemplateGroupLabel: string
  promptTemplateItems: PromptTemplate[]
}) => {
  if (activePromptTemplateRange) {
    return (
      <PromptTemplateSuggestions
        activeItemIndex={activeItemIndex}
        currentEmptyLabel={promptTemplateEmptyLabel}
        groupLabel={promptTemplateGroupLabel}
        isLoading={isLoadingPromptTemplateItems}
        items={promptTemplateItems}
        onItemClick={handleSelectPromptTemplateClick}
        onItemRef={handlePromptTemplateRef}
      />
    )
  }

  if (activeCommandPaletteRange) {
    return (
      <PromptCommandPaletteSuggestions
        activeItemIndex={activeItemIndex}
        currentEmptyLabel={commandPaletteEmptyLabel}
        groupLabel={commandPaletteGroupLabel}
        items={commandPaletteItems}
        onItemClick={handleSelectCommandPaletteItemClick}
        onItemRef={handleCommandPaletteItemRef}
      />
    )
  }

  if (!activeMentionRange) {
    return null
  }

  return (
    <MentionSuggestions
      activeItemIndex={activeItemIndex}
      currentEmptyLabel={currentMentionEmptyLabel}
      globalSkillSourceLabel={mentionGlobalSkillSourceLabel}
      groups={mentionItemGroups}
      isLoading={isLoadingMentionItems}
      isSkillMentionActive={isSkillMentionActive}
      mentionSelectionItems={mentionSelectionItems}
      onItemClick={handleSelectMentionItemClick}
      onItemRef={handleMentionItemRef}
    />
  )
}

// Each mode tints the selected pill with its hue: saturated text/icon over a
// low-opacity background of the same base token. An opacity modifier is used
// because the base tokens exist in every theme but the `-soft` variants do not.
const SELECTED_CLASS_BY_AGENT_MODE: Record<ChatAgentMode, string> = {
  agent: "bg-success/15! text-success!",
  chat: "bg-accent/15! text-accent!",
  plan: "bg-warning/15! text-warning!"
}

// Permission mode escalates the tint with looseness: default stays neutral
// (base selected pill), acceptEdits warns because edits auto-run, and bypass is
// loud/destructive because nothing is gated.
const SELECTED_CLASS_BY_PERMISSION_MODE: Record<AgentPermissionMode, string> = {
  acceptEdits: "bg-warning/15! text-warning!",
  bypass: "bg-destructive/15! text-destructive!",
  default: ""
}

// HeroUI v3 Button type omits tabIndex, but Tooltip.Trigger's Focusable needs it on the child; spread bypasses the type restriction
const FOCUSABLE_TAB_INDEX = { tabIndex: 0 } as Record<string, unknown>

// A restrained mount pulse: remounting on permission-mode change (via `key`)
// replays this enter animation, giving the badge a subtle scale/opacity beat.
const PERMISSION_MODE_PULSE_MOTION = {
  animate: { opacity: 1, scale: 1 },
  initial: { opacity: 0.65, scale: 0.9 },
  transition: { duration: 0.18 }
}

const PromptInputAgentModeControl = ({
  agentLabel,
  chatLabel,
  disabled,
  isToggleDisabled,
  mode,
  onModeChange,
  planLabel,
  toggleLabel
}: {
  agentLabel: string
  chatLabel: string
  disabled: boolean
  isToggleDisabled?: boolean
  mode: ChatAgentMode
  onModeChange: (mode: ChatAgentMode) => void
  planLabel: string
  toggleLabel: string
}) => {
  const labelByMode = useMemo(
    () => ({
      agent: agentLabel,
      chat: chatLabel,
      plan: planLabel
    }),
    [agentLabel, chatLabel, planLabel]
  )
  const activeOption = useMemo(
    () => CHAT_AGENT_MODE_OPTIONS.find((option) => option.id === mode),
    [mode]
  )
  const handlePress = useCallback(() => {
    onModeChange(getNextChatAgentMode(mode))
  }, [mode, onModeChange])

  if (!activeOption) {
    return null
  }

  return (
    <ToggleButton
      aria-label={toggleLabel}
      className={cn(
        "h-8 min-w-0 shrink-0 px-2.5 text-xs",
        SELECTED_CLASS_BY_AGENT_MODE[mode]
      )}
      isDisabled={disabled || isToggleDisabled === true}
      isSelected
      onPress={handlePress}
      size="sm"
    >
      <HugeiconsIcon icon={activeOption.icon} size={14} strokeWidth={2} />
      <span>{labelByMode[mode]}</span>
    </ToggleButton>
  )
}

const PromptInputPermissionModeControl = ({
  acceptEditsLabel,
  bypassLabel,
  defaultLabel,
  disabled,
  isHidden,
  mode,
  onModeChange,
  toggleLabel
}: {
  acceptEditsLabel: string
  bypassLabel: string
  defaultLabel: string
  disabled: boolean
  isHidden: boolean
  mode: AgentPermissionMode
  onModeChange: (mode: AgentPermissionMode) => void
  toggleLabel: string
}) => {
  const labelByMode = useMemo(
    () => ({
      acceptEdits: acceptEditsLabel,
      bypass: bypassLabel,
      default: defaultLabel
    }),
    [acceptEditsLabel, bypassLabel, defaultLabel]
  )
  const activeOption = useMemo(
    () => PERMISSION_MODE_OPTIONS.find((option) => option.id === mode),
    [mode]
  )
  const handlePress = useCallback(() => {
    onModeChange(getNextPermissionMode(mode))
  }, [mode, onModeChange])

  // Hidden in chat mode: there are no tools to gate, so the control is noise.
  if (isHidden || !activeOption) {
    return null
  }

  return (
    <motion.span
      className="inline-flex shrink-0"
      key={mode}
      {...PERMISSION_MODE_PULSE_MOTION}
    >
      <Tooltip delay={300}>
        <ToggleButton
          aria-label={toggleLabel}
          className={cn(
            "h-8 min-w-0 shrink-0 px-2.5 text-xs",
            SELECTED_CLASS_BY_PERMISSION_MODE[mode]
          )}
          isDisabled={disabled}
          isSelected
          onPress={handlePress}
          size="sm"
          {...FOCUSABLE_TAB_INDEX}
        >
          <HugeiconsIcon icon={activeOption.icon} size={14} strokeWidth={2} />
          <span>{labelByMode[mode]}</span>
        </ToggleButton>
        <Tooltip.Content className="flex items-center gap-1.5">
          <span>{toggleLabel}</span>
          <Kbd className="text-popover-foreground">
            <Kbd.Abbr keyValue="shift" />
            <Kbd.Content>Tab</Kbd.Content>
          </Kbd>
        </Tooltip.Content>
      </Tooltip>
    </motion.span>
  )
}

const resolveContextUsageTone = (
  percent: number,
  limit: number
): "danger" | "default" | "warning" => {
  if (percent >= limit) {
    return "danger"
  }

  if (percent >= limit * 0.75) {
    return "warning"
  }

  return "default"
}

export interface PromptInputContextUsageSegment {
  key: "assistant" | "user"
  label: string
  percent: number
  valueLabel: string
}

const CONTEXT_USAGE_SEGMENT_COLOR: Record<
  PromptInputContextUsageSegment["key"],
  string
> = {
  assistant: "var(--ctx-assistant)",
  user: "var(--ctx-user)"
}

// HeroUI v3 ProgressCircle's track defaults to --default, which is the same
// color as the composer shell it sits on — invisible without this override.
const CONTEXT_USAGE_TRACK_STYLE = {
  "--progress-circle-track-stroke":
    "color-mix(in oklab, var(--muted) 35%, transparent)"
} as CSSProperties

const PromptInputContextUsage = ({
  contextUsage
}: {
  contextUsage?: {
    ariaLabel: string
    hintLabel: string
    percent: number
    remainingLabel: string
    segments: PromptInputContextUsageSegment[]
    summaryLabel: string
    thresholdFootnote?: string
    threshold?: number
    title: string
    windowFootnote?: string
  }
}) => {
  if (!contextUsage) {
    return null
  }

  const {
    ariaLabel,
    hintLabel,
    percent,
    remainingLabel,
    segments,
    summaryLabel,
    thresholdFootnote,
    threshold,
    title,
    windowFootnote
  } = contextUsage
  const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)))
  const tone = resolveContextUsageTone(clampedPercent, threshold ?? 100)
  const usedSegments = segments.filter((segment) => segment.percent > 0)
  const hasFootnote = Boolean(thresholdFootnote || windowFootnote)

  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger className="inline-flex">
        <Popover>
          <Popover.Trigger
            aria-label={ariaLabel}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground tabular-nums transition-colors hover:bg-default hover:text-foreground"
          >
            <ProgressCircle
              aria-label={ariaLabel}
              color={tone}
              size="sm"
              value={clampedPercent}
            >
              <ProgressCircle.Track>
                <ProgressCircle.TrackCircle style={CONTEXT_USAGE_TRACK_STYLE} />
                <ProgressCircle.FillCircle />
              </ProgressCircle.Track>
            </ProgressCircle>
            <span>{clampedPercent}%</span>
          </Popover.Trigger>
          <Popover.Content className="w-80" placement="top end">
            <Popover.Dialog>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">
                  {title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {summaryLabel}
                </span>
              </div>

              {usedSegments.length > 0 ? (
                <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted-foreground/20">
                  {usedSegments.map((segment) => (
                    <span
                      className="h-full"
                      key={segment.key}
                      style={{
                        backgroundColor:
                          CONTEXT_USAGE_SEGMENT_COLOR[segment.key],
                        width: `${segment.percent}%`
                      }}
                    />
                  ))}
                </div>
              ) : null}

              {usedSegments.length > 0 ? (
                <ul className="mt-3 flex flex-col">
                  {usedSegments.map((segment) => (
                    <li
                      className="flex items-center gap-2 border-t border-border/60 py-1.5 text-xs first:border-t-0"
                      key={segment.key}
                    >
                      <span
                        className="size-2 shrink-0 rounded-[3px]"
                        style={{
                          backgroundColor:
                            CONTEXT_USAGE_SEGMENT_COLOR[segment.key]
                        }}
                      />
                      <span className="text-foreground">{segment.label}</span>
                      <span className="ml-auto text-muted-foreground tabular-nums">
                        {segment.valueLabel}
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center gap-2 border-t border-border/60 py-1.5 text-xs">
                    <span className="size-2 shrink-0 rounded-[3px] bg-muted-foreground/25" />
                    <span className="text-muted-foreground">
                      {remainingLabel}
                    </span>
                  </li>
                </ul>
              ) : null}

              {hasFootnote ? (
                <div className="mt-3 flex flex-col gap-0.5 border-t border-border/60 pt-2 text-[0.6875rem] text-muted-foreground">
                  {thresholdFootnote ? <span>{thresholdFootnote}</span> : null}
                  {windowFootnote ? <span>{windowFootnote}</span> : null}
                </div>
              ) : null}
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </Tooltip.Trigger>
      <Tooltip.Content>{hintLabel}</Tooltip.Content>
    </Tooltip>
  )
}

const PromptInputActions = ({
  disabled,
  hasInput,
  isOutputActive,
  isSubmitting,
  onStop,
  stopLabel,
  submitLabel
}: {
  disabled: boolean
  hasInput: boolean
  isOutputActive: boolean
  isSubmitting: boolean
  onStop?: () => void
  stopLabel: string
  submitLabel: string
}) => {
  // While the model is responding the button stops the run, unless the user has
  // typed a follow-up — then it submits (queued by the parent) like a send.
  const isStopAction = isOutputActive && !hasInput
  const actionLabel = isStopAction ? stopLabel : submitLabel
  const actionIcon = isStopAction ? StopIcon : SentIcon
  const isActionDisabled = isStopAction ? !onStop : disabled || isSubmitting
  const status: ChatStatus = isStopAction ? "streaming" : "ready"

  return (
    <HeroPromptInput.Send
      aria-label={actionLabel}
      isDisabled={isActionDisabled}
      onStop={onStop}
      status={status}
      type="button"
    >
      <HugeiconsIcon icon={actionIcon} size={16} strokeWidth={2} />
    </HeroPromptInput.Send>
  )
}

const FILE_INPUT_ACCEPT = ACCEPTED_ATTACHMENT_MEDIA_TYPES.join(",")

const encodeBytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ""

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte)
  }

  return btoa(binary)
}

// arrayBuffer() + btoa avoids a hand-rolled FileReader promise wrapper; the
// composer's 8MB per-image cap keeps the synchronous encode cheap.
const readFileAsDataUrl = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer()

  return `data:${file.type};base64,${encodeBytesToBase64(new Uint8Array(buffer))}`
}

// Mirrors ComposerImageModeControl's conditional-tooltip recipe: a bare
// disabled button when the model can't see images, wrapped in the explanatory
// tooltip only when actionable.
const PromptInputAttachControl = ({
  attachLabel,
  disabledTooltip,
  isDisabled,
  onPress
}: {
  attachLabel: string
  disabledTooltip: string
  isDisabled: boolean
  onPress: () => void
}) => {
  const button = (
    <button
      aria-label={isDisabled ? disabledTooltip : attachLabel}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
        isDisabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-default hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      )}
      disabled={isDisabled}
      onClick={onPress}
      type="button"
    >
      <HugeiconsIcon icon={Attachment01Icon} size={16} strokeWidth={2} />
    </button>
  )

  if (isDisabled) {
    return button
  }

  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger>{button}</Tooltip.Trigger>
      <Tooltip.Content placement="top">{attachLabel}</Tooltip.Content>
    </Tooltip>
  )
}

const ComposerAttachmentChips = ({
  attachments,
  onRemove,
  removeLabel
}: {
  attachments: ComposerAttachment[]
  onRemove: (id: string) => void
  removeLabel: string
}) => {
  if (attachments.length === 0) {
    return null
  }

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div
          className="group relative size-16 overflow-hidden rounded-lg border border-border/60 bg-muted/40"
          key={attachment.id}
        >
          <img
            alt={attachment.name}
            className="size-full object-cover"
            src={attachment.dataUrl}
          />
          <button
            aria-label={removeLabel}
            className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white/60"
            onClick={() => onRemove(attachment.id)}
            type="button"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  )
}

const usePromptCommandPaletteItems = ({
  activeRange,
  imagenDescription,
  imagenLabel,
  planDescription,
  planLabel,
  promptDescription,
  promptLabel,
  skillDescription,
  skillLabel,
  workflowDescription,
  workflowLabel
}: {
  activeRange: { query: string } | null
  imagenDescription: string
  imagenLabel: string
  planDescription: string
  planLabel: string
  promptDescription: string
  promptLabel: string
  skillDescription: string
  skillLabel: string
  workflowDescription: string
  workflowLabel: string
}): PromptCommandPaletteItem[] => {
  const allItems = useMemo<PromptCommandPaletteItem[]>(
    () => [
      {
        command: "/plan",
        description: planDescription,
        id: "plan",
        insertText: "/plan ",
        label: planLabel
      },
      {
        command: "/imagen",
        description: imagenDescription,
        id: "imagen",
        insertText: "/imagen ",
        label: imagenLabel
      },
      {
        command: "/workflow",
        description: workflowDescription,
        id: "workflow",
        insertText: "/workflow ",
        label: workflowLabel
      },
      {
        command: "/prompt",
        description: promptDescription,
        id: "prompt",
        insertText: "/prompt ",
        label: promptLabel
      },
      {
        command: "/skill",
        description: skillDescription,
        id: "skill",
        insertText: "/skill ",
        label: skillLabel
      }
    ],
    [
      imagenDescription,
      imagenLabel,
      planDescription,
      planLabel,
      promptDescription,
      promptLabel,
      skillDescription,
      skillLabel,
      workflowDescription,
      workflowLabel
    ]
  )

  return useMemo(
    () =>
      filterPromptCommandPaletteItems({
        items: allItems,
        limit: PROMPT_COMMAND_PALETTE_ITEM_LIMIT,
        query: activeRange?.query ?? ""
      }),
    [activeRange?.query, allItems]
  )
}

// eslint-disable-next-line complexity -- The composer coordinates mentions, slash commands, agent/permission modes, IME guards, and image attachments in one input surface.
export const PromptInput = ({
  agentMode,
  agentModeAgentLabel,
  agentModeChatLabel,
  agentModePlanLabel,
  agentModeToggleLabel,
  commandPaletteEmptyLabel,
  commandPaletteGroupLabel,
  commandPaletteImagenDescription,
  commandPaletteImagenLabel,
  commandPalettePlanDescription,
  commandPalettePlanLabel,
  commandPalettePromptDescription,
  commandPalettePromptLabel,
  commandPaletteSkillDescription,
  commandPaletteSkillLabel,
  commandPaletteWorkflowDescription,
  commandPaletteWorkflowLabel,
  contextUsage,
  disabled = false,
  footer,
  imageInputAttachLabel = "",
  imageInputCountError = "",
  imageInputEnabled = false,
  imageInputNonVisionHint = "",
  imageInputRemoveLabel = "",
  imageInputSizeError = "",
  imageInputTypeError = "",
  imageInputUnsupportedLabel = "",
  isAgentModeToggleDisabled,
  isImageMode = false,
  isLoadingFileItems = false,
  isLoadingPromptTemplateItems = false,
  isLoadingSkillItems = false,
  isOutputActive = false,
  mentionGlobalSkillSourceLabel,
  mentionFileGroupLabel,
  mentionFolderGroupLabel,
  mentionItems,
  mentionEmptyLabel,
  mentionSkillEmptyLabel,
  mentionSkillGroupLabel,
  mentionSkillItems,
  onAgentModeChange,
  onMentionQueryChange,
  onPermissionModeChange,
  onPromptTemplateQueryChange,
  onQueuedMessagesReorder,
  onRemoveQueuedMessage,
  onStop,
  onSubmit,
  permissionMode,
  permissionModeAcceptEditsLabel,
  permissionModeBypassLabel,
  permissionModeDefaultLabel,
  permissionModeToggleLabel,
  placeholder,
  planHintDismissLabel,
  planHintSwitchLabel,
  planHintTitle,
  planQueue,
  promptTemplateEmptyLabel,
  promptTemplateGroupLabel,
  promptTemplateItems = EMPTY_PROMPT_TEMPLATE_ITEMS,
  queuedMessages = EMPTY_QUEUED_PROMPT_MESSAGES,
  queuedMessagesLabel,
  queueEditLabel,
  queueRemoveLabel,
  queueReorderLabel,
  status = "ready",
  stopLabel,
  submitLabel
}: {
  agentMode: ChatAgentMode
  agentModeAgentLabel: string
  agentModeChatLabel: string
  agentModePlanLabel: string
  agentModeToggleLabel: string
  commandPaletteEmptyLabel: string
  commandPaletteGroupLabel: string
  commandPaletteImagenDescription: string
  commandPaletteImagenLabel: string
  commandPalettePlanDescription: string
  commandPalettePlanLabel: string
  commandPalettePromptDescription: string
  commandPalettePromptLabel: string
  commandPaletteSkillDescription: string
  commandPaletteSkillLabel: string
  commandPaletteWorkflowDescription: string
  commandPaletteWorkflowLabel: string
  contextUsage?: {
    ariaLabel: string
    hintLabel: string
    percent: number
    remainingLabel: string
    segments: PromptInputContextUsageSegment[]
    summaryLabel: string
    thresholdFootnote?: string
    threshold?: number
    title: string
    windowFootnote?: string
  }
  disabled?: boolean
  footer?: ReactNode
  imageInputAttachLabel?: string
  imageInputCountError?: string
  imageInputEnabled?: boolean
  imageInputNonVisionHint?: string
  imageInputRemoveLabel?: string
  imageInputSizeError?: string
  imageInputTypeError?: string
  imageInputUnsupportedLabel?: string
  isAgentModeToggleDisabled?: boolean
  isImageMode?: boolean
  isLoadingFileItems?: boolean
  isLoadingPromptTemplateItems?: boolean
  isLoadingSkillItems?: boolean
  isOutputActive?: boolean
  mentionGlobalSkillSourceLabel: string
  mentionFileGroupLabel: string
  mentionFolderGroupLabel: string
  mentionItems: ProjectSnapshotItem[]
  mentionEmptyLabel: string
  mentionSkillEmptyLabel: string
  mentionSkillGroupLabel: string
  mentionSkillItems: PromptSkillMentionItem[]
  mentionSkillSearchPlaceholder: string
  onAgentModeChange: (mode: ChatAgentMode) => void
  onMentionQueryChange: (
    query: string | null,
    trigger: PromptMentionTrigger | null
  ) => void
  onPermissionModeChange: (mode: AgentPermissionMode) => void
  onPromptTemplateQueryChange?: (query: string | null) => void
  onQueuedMessagesReorder?: (messages: QueuedPromptMessage[]) => void
  onRemoveQueuedMessage?: (id: string) => void
  onStop?: () => void
  onSubmit: (payload: {
    files: FileUIPart[]
    mentions: ChatMention[]
    text: string
  }) => Promise<void>
  permissionMode: AgentPermissionMode
  permissionModeAcceptEditsLabel: string
  permissionModeBypassLabel: string
  permissionModeDefaultLabel: string
  permissionModeToggleLabel: string
  placeholder: string
  planHintDismissLabel: string
  planHintSwitchLabel: string
  planHintTitle: string
  planQueue?: ComposerPlanQueueProps
  promptTemplateEmptyLabel: string
  promptTemplateGroupLabel: string
  promptTemplateItems?: PromptTemplate[]
  queuedMessages?: QueuedPromptMessage[]
  queuedMessagesLabel?: string
  queueEditLabel?: string
  queueRemoveLabel?: string
  queueReorderLabel?: string
  status?: ChatStatus
  stopLabel: string
  submitLabel: string
}) => {
  const [activeItemIndex, setActiveItemIndex] = useState(0)
  const [activeMentionRange, setActiveMentionRange] = useState<
    (PromptMentionQueryState & { from: number; to: number }) | null
  >(null)
  const [activeCommandPaletteRange, setActiveCommandPaletteRange] = useState<{
    from: number
    query: string
    to: number
  } | null>(null)
  const [activePromptTemplateRange, setActivePromptTemplateRange] = useState<{
    from: number
    query: string
    to: number
  } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [promptInputValue, setPromptInputValue] = useState("")
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mentionItemElementByKeyRef = useRef(
    new Map<string, HTMLButtonElement>()
  )
  const commandPaletteElementByIdRef = useRef(
    new Map<string, HTMLButtonElement>()
  )
  const promptTemplateElementByPathRef = useRef(
    new Map<string, HTMLButtonElement>()
  )
  const isCompositionActiveRef = useRef(false)
  const compositionSubmitGuardRef = useRef(false)
  const compositionSubmitGuardTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const commandPaletteItems = usePromptCommandPaletteItems({
    activeRange: activeCommandPaletteRange,
    imagenDescription: commandPaletteImagenDescription,
    imagenLabel: commandPaletteImagenLabel,
    planDescription: commandPalettePlanDescription,
    planLabel: commandPalettePlanLabel,
    promptDescription: commandPalettePromptDescription,
    promptLabel: commandPalettePromptLabel,
    skillDescription: commandPaletteSkillDescription,
    skillLabel: commandPaletteSkillLabel,
    workflowDescription: commandPaletteWorkflowDescription,
    workflowLabel: commandPaletteWorkflowLabel
  })
  const mentionItemGroups = useMemo<PromptMentionItemGroup[]>(
    () =>
      buildPromptMentionItemGroups({
        activeTrigger: activeMentionRange?.trigger,
        mentionFileGroupLabel,
        mentionFolderGroupLabel,
        mentionItems,
        mentionSkillGroupLabel,
        mentionSkillItems
      }),
    [
      activeMentionRange?.trigger,
      mentionFileGroupLabel,
      mentionFolderGroupLabel,
      mentionItems,
      mentionSkillGroupLabel,
      mentionSkillItems
    ]
  )
  const mentionSelectionItems = useMemo<PromptMentionItem[]>(
    () => getPromptMentionSelectionItems(mentionItemGroups),
    [mentionItemGroups]
  )
  const activeMentionItemKey = getActivePromptMentionItemKey({
    activeItemIndex,
    items: mentionSelectionItems
  })
  const activeCommandPaletteItemId =
    commandPaletteItems[activeItemIndex]?.id ?? null
  const activePromptTemplateItemPath =
    promptTemplateItems[activeItemIndex]?.path ?? null
  const mentionItemsByKey = useMemo(
    () => createPromptMentionItemsByKey(mentionSelectionItems),
    [mentionSelectionItems]
  )
  const isSkillMentionActive = activeMentionRange?.trigger === "skill"
  const isLoadingMentionItems = isSkillMentionActive
    ? isLoadingSkillItems
    : isLoadingFileItems
  const currentMentionEmptyLabel = isSkillMentionActive
    ? mentionSkillEmptyLabel
    : mentionEmptyLabel
  const hasPromptInput = promptInputValue.trim().length > 0

  const attachmentErrorLabel = useCallback(
    (reason: AttachmentRejectionReason): string => {
      if (reason === "type") {
        return imageInputTypeError
      }

      if (reason === "size") {
        return imageInputSizeError
      }

      return imageInputCountError
    },
    [imageInputCountError, imageInputSizeError, imageInputTypeError]
  )

  // Validate → read accepted files to data URLs → append; the first rejected
  // file surfaces its reason inline. Ignored entirely when the model can't see
  // images, so the disabled attach button and paste path stay consistent.
  const addFiles = useCallback(
    async (incoming: File[]) => {
      if (!imageInputEnabled || incoming.length === 0) {
        return
      }

      setAttachmentError(null)
      const accepted: ComposerAttachment[] = []
      let rejection: AttachmentRejectionReason | null = null

      for (const file of incoming) {
        const classification = classifyAttachmentCandidate({
          existingCount: attachments.length + accepted.length,
          mediaType: file.type,
          sizeBytes: file.size
        })

        if (!classification.ok) {
          rejection ??= classification.reason
          continue
        }

        try {
          accepted.push({
            dataUrl: await readFileAsDataUrl(file),
            id: crypto.randomUUID(),
            mediaType: file.type,
            name: file.name
          })
        } catch {
          // Skip an unreadable file rather than failing the whole batch.
        }
      }

      if (accepted.length > 0) {
        setAttachments((current) => [...current, ...accepted])
      }

      if (rejection) {
        setAttachmentError(attachmentErrorLabel(rejection))
      }
    },
    [attachmentErrorLabel, attachments.length, imageInputEnabled]
  )

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    )
  }, [])

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { files } = event.target

      if (files) {
        void addFiles([...files])
      }

      // Reset so selecting the same file again re-triggers change.
      event.target.value = ""
    },
    [addFiles]
  )

  const handleEditorPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!imageInputEnabled) {
        return
      }

      const imageFiles = [...(event.clipboardData?.files ?? [])].filter(
        (file) => file.type.startsWith("image/")
      )

      if (imageFiles.length === 0) {
        return
      }

      event.preventDefault()
      void addFiles(imageFiles)
    },
    [addFiles, imageInputEnabled]
  )

  const clearCompositionSubmitGuard = useCallback(() => {
    if (compositionSubmitGuardTimeoutRef.current) {
      clearTimeout(compositionSubmitGuardTimeoutRef.current)
      compositionSubmitGuardTimeoutRef.current = null
    }

    compositionSubmitGuardRef.current = false
  }, [])

  const armCompositionSubmitGuard = useCallback(() => {
    clearCompositionSubmitGuard()
    compositionSubmitGuardRef.current = true
    compositionSubmitGuardTimeoutRef.current = setTimeout(() => {
      compositionSubmitGuardRef.current = false
      compositionSubmitGuardTimeoutRef.current = null
    }, COMPOSITION_SUBMIT_GUARD_MS)
  }, [clearCompositionSubmitGuard])

  const syncPromptInputValue = useCallback((nextEditor: Editor) => {
    setPromptInputValue(extractPromptEditorPayload(nextEditor.getJSON()).text)
  }, [])

  const updateActiveRanges = useCallback((nextEditor: Editor) => {
    const { selection } = nextEditor.state

    if (selection.from !== selection.to) {
      setActiveMentionRange(null)
      setActiveCommandPaletteRange(null)
      setActivePromptTemplateRange(null)
      return
    }

    const textBeforeCaret = nextEditor.state.doc.textBetween(
      0,
      selection.from,
      "\n",
      "\n"
    )
    const promptTemplateRange = getPromptEditorActivePromptTemplateCommandRange(
      {
        selectionFrom: selection.from,
        textBeforeCaret
      }
    )

    setActivePromptTemplateRange(promptTemplateRange)
    const commandPaletteRange = promptTemplateRange
      ? null
      : getPromptEditorActiveCommandPaletteRange({
          selectionFrom: selection.from,
          textBeforeCaret
        })

    setActiveCommandPaletteRange(commandPaletteRange)
    setActiveMentionRange(
      promptTemplateRange || commandPaletteRange
        ? null
        : getPromptEditorActiveMentionRange({
            selectionFrom: selection.from,
            textBeforeCaret
          })
    )
  }, [])
  const editor = useEditor(
    {
      content: "",
      editable: !(disabled || isSubmitting),
      editorProps: {
        attributes: {
          class: "min-h-32 whitespace-pre-wrap break-words text-sm outline-none"
        }
      },
      extensions: [
        StarterKit,
        ProjectMentionExtension,
        Placeholder.configure({
          placeholder
        })
      ],
      onSelectionUpdate: ({ editor: nextEditor }) => {
        updateActiveRanges(nextEditor)
      },
      onUpdate: ({ editor: nextEditor }) => {
        syncPromptInputValue(nextEditor)
        updateActiveRanges(nextEditor)
      }
    },
    [placeholder, syncPromptInputValue, updateActiveRanges]
  )

  useEffect(() => {
    onMentionQueryChange(
      activeMentionRange ? activeMentionRange.query : null,
      activeMentionRange ? activeMentionRange.trigger : null
    )
  }, [activeMentionRange, onMentionQueryChange])

  useEffect(() => {
    onPromptTemplateQueryChange?.(
      activePromptTemplateRange ? activePromptTemplateRange.query : null
    )
  }, [activePromptTemplateRange, onPromptTemplateQueryChange])

  useEffect(() => {
    editor?.setEditable(!(disabled || isSubmitting))
  }, [disabled, editor, isSubmitting])

  useEffect(
    () => () => {
      clearCompositionSubmitGuard()
    },
    [clearCompositionSubmitGuard]
  )

  useEffect(() => {
    setActiveItemIndex(0)
  }, [commandPaletteItems, mentionSelectionItems, promptTemplateItems])

  useEffect(() => {
    if (!activeMentionRange || !activeMentionItemKey) {
      return
    }

    scrollActiveMentionItemIntoView(
      mentionItemElementByKeyRef.current.get(activeMentionItemKey)
    )
  }, [activeMentionItemKey, activeMentionRange])

  useEffect(() => {
    if (!activeCommandPaletteRange || !activeCommandPaletteItemId) {
      return
    }

    scrollActiveMentionItemIntoView(
      commandPaletteElementByIdRef.current.get(activeCommandPaletteItemId)
    )
  }, [activeCommandPaletteItemId, activeCommandPaletteRange])

  useEffect(() => {
    if (!activePromptTemplateRange || !activePromptTemplateItemPath) {
      return
    }

    scrollActiveMentionItemIntoView(
      promptTemplateElementByPathRef.current.get(activePromptTemplateItemPath)
    )
  }, [activePromptTemplateItemPath, activePromptTemplateRange])

  // Timed plan-mode hint (Feature D): only offered from chat/agent mode, with no
  // request in flight and image mode off. Switching keeps the draft and refocuses.
  const isPlanHintEligible =
    !disabled && !isOutputActive && !isImageMode && agentMode !== "plan"
  const {
    conceal: concealPlanHint,
    dismiss: dismissPlanHint,
    isVisible: isPlanHintVisible
  } = usePlanModeHint({
    draft: promptInputValue,
    isEligible: isPlanHintEligible
  })
  const handleSwitchToPlan = useCallback(() => {
    onAgentModeChange("plan")
    editor?.commands.focus()
  }, [editor, onAgentModeChange])

  const handleSelectMentionItem = useCallback(
    (item: PromptMentionItem) => {
      if (!activeMentionRange || !editor) {
        return
      }

      const nextMention = createMentionFromPromptMentionItem(item)

      editor
        .chain()
        .focus()
        .deleteRange({
          from: activeMentionRange.from,
          to: activeMentionRange.to
        })
        .insertContent([
          {
            attrs: nextMention,
            type: PROJECT_MENTION_NODE_TYPE
          },
          {
            text: " ",
            type: "text"
          }
        ])
        .run()
      setActiveMentionRange(null)
    },
    [activeMentionRange, editor]
  )

  const handleSelectCommandPaletteItem = useCallback(
    (item: PromptCommandPaletteItem) => {
      if (!activeCommandPaletteRange || !editor) {
        return
      }

      editor
        .chain()
        .focus()
        .deleteRange({
          from: activeCommandPaletteRange.from,
          to: activeCommandPaletteRange.to
        })
        .insertContent(item.insertText)
        .run()
      setActiveCommandPaletteRange(null)
    },
    [activeCommandPaletteRange, editor]
  )

  const handleSelectPromptTemplateItem = useCallback(
    (item: PromptTemplate) => {
      if (!activePromptTemplateRange || !editor) {
        return
      }

      editor
        .chain()
        .focus()
        .deleteRange({
          from: activePromptTemplateRange.from,
          to: activePromptTemplateRange.to
        })
        .insertContent(createPromptTemplateCommandText(item))
        .run()
      setActivePromptTemplateRange(null)
    },
    [activePromptTemplateRange, editor]
  )

  const handleSubmit = useCallback(async () => {
    if (!editor) {
      return
    }

    const { mentions, text } = extractPromptEditorPayload(editor.getJSON())
    const normalizedText = text.trim()
    const hasAttachments = attachments.length > 0

    if (
      (normalizedText === "" && mentions.length === 0 && !hasAttachments) ||
      disabled
    ) {
      return
    }

    // Block sending images to a model that can't see them (e.g. attached on a
    // vision model, then switched away): the user removes them or switches back.
    if (hasAttachments && !imageInputEnabled) {
      setAttachmentError(imageInputNonVisionHint)
      return
    }

    setIsSubmitting(true)

    try {
      await onSubmit({
        files: attachments.map(attachmentToFilePart),
        mentions,
        text: normalizedText
      })
      editor.commands.clearContent()
      setPromptInputValue("")
      setAttachments([])
      setAttachmentError(null)
      editor.commands.focus()
      setActiveMentionRange(null)
      setActiveCommandPaletteRange(null)
      setActivePromptTemplateRange(null)
    } finally {
      setIsSubmitting(false)
    }
  }, [
    attachments,
    disabled,
    editor,
    imageInputEnabled,
    imageInputNonVisionHint,
    onSubmit
  ])

  const handleEditQueuedMessage = useCallback(
    (message: QueuedPromptMessage) => {
      if (!editor) {
        return
      }

      editor
        .chain()
        .setContent(buildPromptEditorJsonFromMessage(message))
        .focus("end")
        .run()
      syncPromptInputValue(editor)
      // Restore any attached images so editing a queued message is lossless
      // (queued file urls are still inline data URLs, not yet persisted).
      setAttachments(
        (message.files ?? []).map((file) => ({
          dataUrl: file.url,
          id: crypto.randomUUID(),
          mediaType: file.mediaType,
          name: file.filename ?? "image"
        }))
      )
      setAttachmentError(null)
      onRemoveQueuedMessage?.(message.id)
    },
    [editor, onRemoveQueuedMessage, syncPromptInputValue]
  )

  const handleSelectMentionItemClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { itemKey } = event.currentTarget.dataset

      if (!itemKey) {
        return
      }

      const item = mentionItemsByKey.get(itemKey)

      if (item) {
        handleSelectMentionItem(item)
      }
    },
    [handleSelectMentionItem, mentionItemsByKey]
  )

  const handleSelectCommandPaletteItemClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { commandId } = event.currentTarget.dataset

      if (!commandId) {
        return
      }

      const item = commandPaletteItems.find(
        (commandItem) => commandItem.id === commandId
      )

      if (item) {
        handleSelectCommandPaletteItem(item)
      }
    },
    [commandPaletteItems, handleSelectCommandPaletteItem]
  )

  const handleSelectPromptTemplateClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { templatePath } = event.currentTarget.dataset

      if (!templatePath) {
        return
      }

      const item = promptTemplateItems.find(
        (template) => template.path === templatePath
      )

      if (item) {
        handleSelectPromptTemplateItem(item)
      }
    },
    [handleSelectPromptTemplateItem, promptTemplateItems]
  )

  const handleMentionItemRef = useCallback(
    (itemKey: string, element: HTMLButtonElement | null) => {
      if (!element) {
        mentionItemElementByKeyRef.current.delete(itemKey)
        return
      }

      mentionItemElementByKeyRef.current.set(itemKey, element)
    },
    []
  )

  const handleCommandPaletteItemRef = useCallback(
    (itemId: string, element: HTMLButtonElement | null) => {
      if (!element) {
        commandPaletteElementByIdRef.current.delete(itemId)
        return
      }

      commandPaletteElementByIdRef.current.set(itemId, element)
    },
    []
  )

  const handlePromptTemplateRef = useCallback(
    (itemPath: string, element: HTMLButtonElement | null) => {
      if (!element) {
        promptTemplateElementByPathRef.current.delete(itemPath)
        return
      }

      promptTemplateElementByPathRef.current.set(itemPath, element)
    },
    []
  )

  const handleEditorCompositionStart = useCallback(() => {
    clearCompositionSubmitGuard()
    isCompositionActiveRef.current = true
  }, [clearCompositionSubmitGuard])

  const handleEditorCompositionEnd = useCallback(() => {
    isCompositionActiveRef.current = false
    armCompositionSubmitGuard()
  }, [armCompositionSubmitGuard])

  const handleEditorKeyDown = useCallback(
    async (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        isPromptImeConfirmKeyDown({
          event,
          isCompositionActive: isCompositionActiveRef.current,
          isCompositionEndGuardActive: compositionSubmitGuardRef.current
        })
      ) {
        event.stopPropagation()

        if (
          compositionSubmitGuardRef.current &&
          !isCompositionActiveRef.current &&
          !isPromptNativeCompositionKeyDown(event)
        ) {
          event.preventDefault()
          clearCompositionSubmitGuard()
        }

        return
      }

      if (isPlanModeKeyboardShortcut(event)) {
        event.preventDefault()

        if (editor) {
          editor
            .chain()
            .setContent(
              applyPlanCommandPrefixToPromptEditorJson(editor.getJSON())
            )
            .focus("end")
            .run()
        }

        return
      }

      if (
        activePromptTemplateRange &&
        handleIndexedSuggestionKeyDown({
          activeItemIndex,
          event,
          items: promptTemplateItems,
          onSelect: handleSelectPromptTemplateItem,
          setActiveItemIndex
        })
      ) {
        return
      }

      if (
        activeCommandPaletteRange &&
        handleIndexedSuggestionKeyDown({
          activeItemIndex,
          event,
          items: commandPaletteItems,
          onSelect: handleSelectCommandPaletteItem,
          setActiveItemIndex
        })
      ) {
        return
      }

      if (
        activeMentionRange &&
        handleIndexedSuggestionKeyDown({
          activeItemIndex,
          event,
          items: mentionSelectionItems,
          onSelect: handleSelectMentionItem,
          setActiveItemIndex
        })
      ) {
        return
      }

      if (isPromptSubmitKeyDown(event)) {
        event.preventDefault()
        await handleSubmit()
      }
    },
    [
      activeItemIndex,
      activeCommandPaletteRange,
      activeMentionRange,
      activePromptTemplateRange,
      clearCompositionSubmitGuard,
      commandPaletteItems,
      editor,
      handleSelectCommandPaletteItem,
      handleSelectMentionItem,
      handleSelectPromptTemplateItem,
      handleSubmit,
      mentionSelectionItems,
      promptTemplateItems
    ]
  )

  return (
    <HeroPromptInput
      className="relative shadow-none"
      isDisabled={disabled}
      layout="stacked"
      lockInputOnRun={false}
      onStop={onStop}
      onSubmit={() => {
        void handleSubmit()
      }}
      status={status}
      value={promptInputValue}
      variant="secondary"
    >
      <ComposerPlanHint
        dismissLabel={planHintDismissLabel}
        isVisible={isPlanHintVisible}
        onConceal={concealPlanHint}
        onDismiss={dismissPlanHint}
        onSwitch={handleSwitchToPlan}
        switchLabel={planHintSwitchLabel}
        title={planHintTitle}
      />
      <PromptInputSuggestions
        activeCommandPaletteRange={activeCommandPaletteRange}
        activeItemIndex={activeItemIndex}
        activeMentionRange={activeMentionRange}
        activePromptTemplateRange={activePromptTemplateRange}
        commandPaletteEmptyLabel={commandPaletteEmptyLabel}
        commandPaletteGroupLabel={commandPaletteGroupLabel}
        commandPaletteItems={commandPaletteItems}
        currentMentionEmptyLabel={currentMentionEmptyLabel}
        handleCommandPaletteItemRef={handleCommandPaletteItemRef}
        handleMentionItemRef={handleMentionItemRef}
        handlePromptTemplateRef={handlePromptTemplateRef}
        handleSelectCommandPaletteItemClick={
          handleSelectCommandPaletteItemClick
        }
        handleSelectMentionItemClick={handleSelectMentionItemClick}
        handleSelectPromptTemplateClick={handleSelectPromptTemplateClick}
        isLoadingMentionItems={isLoadingMentionItems}
        isLoadingPromptTemplateItems={isLoadingPromptTemplateItems}
        isSkillMentionActive={isSkillMentionActive}
        mentionGlobalSkillSourceLabel={mentionGlobalSkillSourceLabel}
        mentionItemGroups={mentionItemGroups}
        mentionSelectionItems={mentionSelectionItems}
        promptTemplateEmptyLabel={promptTemplateEmptyLabel}
        promptTemplateGroupLabel={promptTemplateGroupLabel}
        promptTemplateItems={promptTemplateItems}
      />

      {planQueue ? <ComposerPlanQueue {...planQueue} /> : null}

      {queuedMessages.length > 0 ? (
        <HeroPromptInput.Queue aria-label={queuedMessagesLabel}>
          <HeroPromptInput.Queue.List
            onReorder={onQueuedMessagesReorder}
            values={queuedMessages}
          >
            {queuedMessages.map((message) => (
              <HeroPromptInput.Queue.Item key={message.id} value={message}>
                <HeroPromptInput.Queue.Item.Handle
                  aria-label={queueReorderLabel}
                />
                <HeroPromptInput.Queue.Item.Body>
                  <HeroPromptInput.Queue.Item.Icon />
                  <HeroPromptInput.Queue.Item.Content>
                    {message.text}
                  </HeroPromptInput.Queue.Item.Content>
                </HeroPromptInput.Queue.Item.Body>
                <HeroPromptInput.Queue.Item.Actions>
                  <HeroPromptInput.Queue.Item.Action
                    aria-label={queueEditLabel}
                    onPress={() => handleEditQueuedMessage(message)}
                    type="button"
                  >
                    <HugeiconsIcon
                      icon={PencilEdit02Icon}
                      size={15}
                      strokeWidth={2}
                    />
                  </HeroPromptInput.Queue.Item.Action>
                  <HeroPromptInput.Queue.Item.Remove
                    aria-label={queueRemoveLabel}
                    onPress={() => onRemoveQueuedMessage?.(message.id)}
                    type="button"
                  />
                </HeroPromptInput.Queue.Item.Actions>
              </HeroPromptInput.Queue.Item>
            ))}
          </HeroPromptInput.Queue.List>
        </HeroPromptInput.Queue>
      ) : null}

      <HeroPromptInput.Shell className="block rounded-[1.75rem]! hover:bg-default!">
        <HeroPromptInput.Content className="p-4">
          <ComposerAttachmentChips
            attachments={attachments}
            onRemove={removeAttachment}
            removeLabel={imageInputRemoveLabel}
          />
          {attachmentError ? (
            <p className="mb-2 text-xs text-destructive">{attachmentError}</p>
          ) : null}
          <div
            className={cn(
              "min-h-32 cursor-text text-sm",
              "data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50",
              "[&_.ProseMirror]:min-h-32 [&_.ProseMirror]:outline-none",
              "[&_.ProseMirror_p]:my-0",
              "[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
              "[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left",
              "[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0",
              "[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground",
              "[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
            )}
            data-disabled={disabled || isSubmitting}
            onCompositionEndCapture={handleEditorCompositionEnd}
            onCompositionStartCapture={handleEditorCompositionStart}
            onKeyDownCapture={handleEditorKeyDown}
            onPasteCapture={handleEditorPaste}
          >
            <EditorContent editor={editor} />
          </div>
        </HeroPromptInput.Content>

        <HeroPromptInput.Toolbar className="flex items-center justify-between gap-3 px-4 py-3">
          <HeroPromptInput.ToolbarStart className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-3">
              <PromptInputAgentModeControl
                agentLabel={agentModeAgentLabel}
                chatLabel={agentModeChatLabel}
                disabled={disabled}
                isToggleDisabled={isAgentModeToggleDisabled}
                mode={agentMode}
                onModeChange={onAgentModeChange}
                planLabel={agentModePlanLabel}
                toggleLabel={agentModeToggleLabel}
              />
              <PromptInputPermissionModeControl
                acceptEditsLabel={permissionModeAcceptEditsLabel}
                bypassLabel={permissionModeBypassLabel}
                defaultLabel={permissionModeDefaultLabel}
                disabled={disabled}
                isHidden={agentMode === "chat"}
                mode={permissionMode}
                onModeChange={onPermissionModeChange}
                toggleLabel={permissionModeToggleLabel}
              />
              {footer}
              <PromptInputAttachControl
                attachLabel={imageInputAttachLabel}
                disabledTooltip={imageInputUnsupportedLabel}
                isDisabled={disabled || !imageInputEnabled}
                onPress={handleAttachClick}
              />
              <input
                accept={FILE_INPUT_ACCEPT}
                aria-hidden="true"
                className="hidden"
                multiple
                onChange={handleFileInputChange}
                ref={fileInputRef}
                tabIndex={-1}
                type="file"
              />
            </div>
          </HeroPromptInput.ToolbarStart>
          <HeroPromptInput.ToolbarEnd>
            <PromptInputContextUsage contextUsage={contextUsage} />
            <PromptInputActions
              disabled={disabled}
              hasInput={hasPromptInput}
              isOutputActive={isOutputActive}
              isSubmitting={isSubmitting}
              onStop={onStop}
              stopLabel={stopLabel}
              submitLabel={submitLabel}
            />
          </HeroPromptInput.ToolbarEnd>
        </HeroPromptInput.Toolbar>
      </HeroPromptInput.Shell>
    </HeroPromptInput>
  )
}
