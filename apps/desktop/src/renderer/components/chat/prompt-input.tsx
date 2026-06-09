import type {
  AgentSessionQueuedMessage,
  AgentSessionQueuedMessageQueue,
  ChatMention,
  ProjectSnapshotItem,
  PromptTemplate
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { PromptInput as HeroPromptInput } from "@heroui-pro/react"
import type { ChatStatus } from "@heroui-pro/react"
import type { Key } from "@heroui/react"
import { ToggleButton, ToggleButtonGroup } from "@heroui/react"
import {
  CubeIcon,
  Delete02Icon,
  DragDropVerticalIcon,
  PencilEdit02Icon,
  Queue02Icon,
  SentIcon,
  StopIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Editor } from "@tiptap/core"
import { Placeholder } from "@tiptap/extension-placeholder"
import { EditorContent, useEditor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { resolveAgentComposerPrimaryAction } from "@/renderer/lib/chat/agent-queue"
import { ProjectMentionExtension } from "@/renderer/lib/chat/project-mention-extension"
import {
  CHAT_AGENT_MODE_OPTIONS,
  COMPOSITION_SUBMIT_GUARD_MS,
  EMPTY_PROMPT_TEMPLATE_ITEMS,
  EMPTY_QUEUED_MESSAGES,
  PROJECT_MENTION_NODE_TYPE,
  PROMPT_COMMAND_PALETTE_ITEM_LIMIT,
  applyPlanCommandPrefixToPromptEditorJson,
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
  isPromptImeConfirmKeyDown,
  isPromptNativeCompositionKeyDown,
  isPlanModeKeyboardShortcut,
  isPromptSubmitKeyDown,
  scrollActiveMentionItemIntoView
} from "@/renderer/lib/chat/prompt-input"
import type {
  PromptCommandPaletteItem,
  PromptMentionItemGroup,
  PromptMentionQueryState,
  PromptMentionItem,
  PromptSkillMentionItem,
  PromptMentionTrigger
} from "@/renderer/lib/chat/prompt-input"
import { isChatAgentMode } from "@/shared/chat/agent-mode"
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
            const itemIcon = item.id === "plan" ? PencilEdit02Icon : CubeIcon

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

const getQueueLabel = ({
  followUpLabel,
  nextTurnLabel,
  queue,
  steerLabel
}: {
  followUpLabel: string
  nextTurnLabel: string
  queue: AgentSessionQueuedMessageQueue
  steerLabel: string
}): string => {
  if (queue === "follow-up") {
    return followUpLabel
  }

  if (queue === "next-turn") {
    return nextTurnLabel
  }

  return steerLabel
}

const getNextQueue = (
  queue: AgentSessionQueuedMessageQueue
): AgentSessionQueuedMessageQueue =>
  queue === "follow-up" ? "steer" : "follow-up"

const QueuedPromptMessageList = ({
  editLabel,
  followUpLabel,
  messages,
  nextTurnLabel,
  onEdit,
  onRemove,
  onReorder,
  onUpdate,
  removeLabel,
  reorderLabel,
  steerLabel,
  titleLabel
}: {
  editLabel: string
  followUpLabel: string
  messages: AgentSessionQueuedMessage[]
  nextTurnLabel: string
  onEdit: (message: AgentSessionQueuedMessage) => void
  onRemove?: (id: string) => Promise<void> | void
  onReorder?: (ids: string[]) => Promise<void> | void
  onUpdate?: (input: {
    id: string
    queue?: AgentSessionQueuedMessageQueue
  }) => Promise<void> | void
  removeLabel: string
  reorderLabel: string
  steerLabel: string
  titleLabel: string
}) => {
  if (messages.length === 0) {
    return null
  }

  return (
    <HeroPromptInput.Queue
      actionsVisibility="always"
      aria-label={titleLabel}
      className="border-b border-border/70"
    >
      <HeroPromptInput.Queue.List
        onReorder={(nextMessages) => {
          void onReorder?.(nextMessages.map((message) => message.id))
        }}
        values={messages}
      >
        {messages.map((message) => {
          const nextQueue = getNextQueue(message.queue)
          const queueLabel = getQueueLabel({
            followUpLabel,
            nextTurnLabel,
            queue: message.queue,
            steerLabel
          })
          const nextQueueLabel = getQueueLabel({
            followUpLabel,
            nextTurnLabel,
            queue: nextQueue,
            steerLabel
          })

          return (
            <HeroPromptInput.Queue.Item key={message.id} value={message}>
              <HeroPromptInput.Queue.Item.Handle
                aria-label={reorderLabel}
                type="button"
              >
                <HugeiconsIcon
                  icon={DragDropVerticalIcon}
                  size={14}
                  strokeWidth={2}
                />
              </HeroPromptInput.Queue.Item.Handle>
              <HeroPromptInput.Queue.Item.Icon>
                <HugeiconsIcon
                  icon={message.queue === "follow-up" ? Queue02Icon : SentIcon}
                  size={14}
                  strokeWidth={2}
                />
              </HeroPromptInput.Queue.Item.Icon>
              <HeroPromptInput.Queue.Item.Body>
                <HeroPromptInput.Queue.Item.Content>
                  {message.content}
                </HeroPromptInput.Queue.Item.Content>
                <HeroPromptInput.Queue.Item.Description>
                  {queueLabel}
                </HeroPromptInput.Queue.Item.Description>
              </HeroPromptInput.Queue.Item.Body>
              <HeroPromptInput.Queue.Item.Actions>
                <HeroPromptInput.Queue.Item.Steer
                  aria-label={nextQueueLabel}
                  onPress={() => {
                    void onUpdate?.({
                      id: message.id,
                      queue: nextQueue
                    })
                  }}
                  type="button"
                >
                  <HugeiconsIcon
                    icon={nextQueue === "follow-up" ? Queue02Icon : SentIcon}
                    size={14}
                    strokeWidth={2}
                  />
                </HeroPromptInput.Queue.Item.Steer>
                <HeroPromptInput.Queue.Item.Action
                  aria-label={editLabel}
                  onPress={() => onEdit(message)}
                  type="button"
                >
                  <HugeiconsIcon
                    icon={PencilEdit02Icon}
                    size={14}
                    strokeWidth={2}
                  />
                </HeroPromptInput.Queue.Item.Action>
                <HeroPromptInput.Queue.Item.Remove
                  aria-label={removeLabel}
                  onPress={() => {
                    void onRemove?.(message.id)
                  }}
                  type="button"
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={14}
                    strokeWidth={2}
                  />
                </HeroPromptInput.Queue.Item.Remove>
              </HeroPromptInput.Queue.Item.Actions>
            </HeroPromptInput.Queue.Item>
          )
        })}
      </HeroPromptInput.Queue.List>
    </HeroPromptInput.Queue>
  )
}

const PromptInputAgentModeControl = ({
  agentLabel,
  chatLabel,
  disabled,
  isToggleDisabled,
  mode,
  onModeChange,
  toggleLabel
}: {
  agentLabel: string
  chatLabel: string
  disabled: boolean
  isToggleDisabled?: boolean
  mode: ChatAgentMode
  onModeChange: (mode: ChatAgentMode) => void
  toggleLabel: string
}) => {
  const selectedKeys = useMemo(() => new Set<Key>([mode]), [mode])
  const labelByMode = useMemo(
    () => ({
      agent: agentLabel,
      chat: chatLabel
    }),
    [agentLabel, chatLabel]
  )
  const handleSelectionChange = useCallback(
    (keys: Set<Key>) => {
      const nextMode = [...keys].find(isChatAgentMode)

      if (nextMode) {
        onModeChange(nextMode)
      }
    },
    [onModeChange]
  )

  return (
    <ToggleButtonGroup
      aria-label={toggleLabel}
      className="shrink-0"
      disallowEmptySelection
      isDisabled={disabled || isToggleDisabled === true}
      onSelectionChange={handleSelectionChange}
      selectedKeys={selectedKeys}
      selectionMode="single"
      size="sm"
    >
      {CHAT_AGENT_MODE_OPTIONS.map((option, index) => (
        <ToggleButton
          aria-label={labelByMode[option.id as keyof typeof labelByMode]}
          className="h-8 min-w-0 px-2.5 text-xs"
          id={option.id}
          key={option.id}
        >
          {index > 0 ? <ToggleButtonGroup.Separator /> : null}
          <HugeiconsIcon icon={option.icon} size={14} strokeWidth={2} />
          <span>{labelByMode[option.id as keyof typeof labelByMode]}</span>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

const PromptInputActions = ({
  disabled,
  hasPromptInputValue,
  isOutputActive,
  isQueueSubmitEnabled,
  isSubmitting,
  onStop,
  stopLabel,
  submitLabel
}: {
  disabled: boolean
  hasPromptInputValue: boolean
  isOutputActive: boolean
  isQueueSubmitEnabled: boolean
  isSubmitting: boolean
  onStop?: () => void
  stopLabel: string
  submitLabel: string
}) => {
  const primaryAction = resolveAgentComposerPrimaryAction({
    hasPromptInputValue,
    isOutputActive,
    isQueueSubmitEnabled
  })
  const isStopAction = primaryAction === "stop"
  const actionLabel = isStopAction ? stopLabel : submitLabel
  const actionIcon = isStopAction ? StopIcon : SentIcon
  const isActionDisabled = isStopAction ? !onStop : disabled || isSubmitting
  const status: ChatStatus = isOutputActive ? "streaming" : "ready"

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

const usePromptCommandPaletteItems = ({
  activeRange,
  planDescription,
  planLabel,
  promptDescription,
  promptLabel,
  skillDescription,
  skillLabel
}: {
  activeRange: { query: string } | null
  planDescription: string
  planLabel: string
  promptDescription: string
  promptLabel: string
  skillDescription: string
  skillLabel: string
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
      planDescription,
      planLabel,
      promptDescription,
      promptLabel,
      skillDescription,
      skillLabel
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

export const PromptInput = ({
  agentMode,
  agentModeAgentLabel,
  agentModeChatLabel,
  agentModeToggleLabel,
  commandPaletteEmptyLabel,
  commandPaletteGroupLabel,
  commandPalettePlanDescription,
  commandPalettePlanLabel,
  commandPalettePromptDescription,
  commandPalettePromptLabel,
  commandPaletteSkillDescription,
  commandPaletteSkillLabel,
  disabled = false,
  footer,
  isAgentModeToggleDisabled,
  isLoadingFileItems = false,
  isLoadingPromptTemplateItems = false,
  isLoadingSkillItems = false,
  isOutputActive = false,
  isQueueSubmitEnabled = false,
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
  onPromptTemplateQueryChange,
  onQueuedMessageRemove,
  onQueuedMessageReorder,
  onQueuedMessageUpdate,
  onStop,
  onSubmit,
  placeholder,
  promptTemplateEmptyLabel,
  promptTemplateGroupLabel,
  promptTemplateItems = EMPTY_PROMPT_TEMPLATE_ITEMS,
  queueEditLabel,
  queueFollowUpLabel,
  queueNextTurnLabel,
  queueRemoveLabel,
  queueReorderLabel,
  queueSteerLabel,
  queuedMessages = EMPTY_QUEUED_MESSAGES,
  queuedMessagesLabel,
  status = "ready",
  stopLabel,
  submitLabel
}: {
  agentMode: ChatAgentMode
  agentModeAgentLabel: string
  agentModeChatLabel: string
  agentModeToggleLabel: string
  commandPaletteEmptyLabel: string
  commandPaletteGroupLabel: string
  commandPalettePlanDescription: string
  commandPalettePlanLabel: string
  commandPalettePromptDescription: string
  commandPalettePromptLabel: string
  commandPaletteSkillDescription: string
  commandPaletteSkillLabel: string
  disabled?: boolean
  footer?: ReactNode
  isAgentModeToggleDisabled?: boolean
  isLoadingFileItems?: boolean
  isLoadingPromptTemplateItems?: boolean
  isLoadingSkillItems?: boolean
  isOutputActive?: boolean
  isQueueSubmitEnabled?: boolean
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
  onPromptTemplateQueryChange?: (query: string | null) => void
  onQueuedMessageRemove?: (id: string) => Promise<void> | void
  onQueuedMessageReorder?: (ids: string[]) => Promise<void> | void
  onQueuedMessageUpdate?: (input: {
    content?: string
    id: string
    queue?: AgentSessionQueuedMessageQueue
  }) => Promise<void> | void
  onStop?: () => void
  onSubmit: (payload: {
    mentions: ChatMention[]
    queue?: AgentSessionQueuedMessageQueue
    text: string
  }) => Promise<void>
  placeholder: string
  promptTemplateEmptyLabel: string
  promptTemplateGroupLabel: string
  promptTemplateItems?: PromptTemplate[]
  queueEditLabel: string
  queueFollowUpLabel: string
  queueNextTurnLabel: string
  queueRemoveLabel: string
  queueReorderLabel: string
  queueSteerLabel: string
  queuedMessages?: AgentSessionQueuedMessage[]
  queuedMessagesLabel: string
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
  const [editingQueuedMessageId, setEditingQueuedMessageId] = useState<
    string | null
  >(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [promptInputValue, setPromptInputValue] = useState("")
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
    planDescription: commandPalettePlanDescription,
    planLabel: commandPalettePlanLabel,
    promptDescription: commandPalettePromptDescription,
    promptLabel: commandPalettePromptLabel,
    skillDescription: commandPaletteSkillDescription,
    skillLabel: commandPaletteSkillLabel
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
    if (
      editingQueuedMessageId &&
      !queuedMessages.some((message) => message.id === editingQueuedMessageId)
    ) {
      setEditingQueuedMessageId(null)
    }
  }, [editingQueuedMessageId, queuedMessages])

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

  const handleStartEditQueuedMessage = useCallback(
    (message: AgentSessionQueuedMessage) => {
      if (!editor) {
        return
      }

      setEditingQueuedMessageId(message.id)
      editor.commands.setContent(message.content)
      editor.commands.focus("end")
      setPromptInputValue(message.content)
      setActiveMentionRange(null)
      setActiveCommandPaletteRange(null)
      setActivePromptTemplateRange(null)
    },
    [editor]
  )

  const handleSubmit = useCallback(
    async (queue?: AgentSessionQueuedMessageQueue) => {
      if (!editor) {
        return
      }

      const { mentions, text } = extractPromptEditorPayload(editor.getJSON())
      const normalizedText = text.trim()

      if (
        (normalizedText === "" && mentions.length === 0) ||
        disabled ||
        (isOutputActive && !isQueueSubmitEnabled)
      ) {
        return
      }

      setIsSubmitting(true)

      try {
        if (editingQueuedMessageId) {
          await onQueuedMessageUpdate?.({
            content: normalizedText,
            id: editingQueuedMessageId
          })
          setEditingQueuedMessageId(null)
        } else {
          await onSubmit({
            mentions,
            ...(queue ? { queue } : {}),
            text: normalizedText
          })
        }
        editor.commands.clearContent()
        setPromptInputValue("")
        editor.commands.focus()
        setActiveMentionRange(null)
        setActiveCommandPaletteRange(null)
        setActivePromptTemplateRange(null)
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      disabled,
      editingQueuedMessageId,
      editor,
      isOutputActive,
      isQueueSubmitEnabled,
      onQueuedMessageUpdate,
      onSubmit
    ]
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
      if (isPlanModeKeyboardShortcut(event)) {
        event.preventDefault()

        if (!editor || disabled || isSubmitting) {
          return
        }

        editor.commands.setContent(
          applyPlanCommandPrefixToPromptEditorJson(editor.getJSON())
        )
        editor.commands.focus("end")
        setActiveMentionRange(null)
        setActiveCommandPaletteRange(null)
        setActivePromptTemplateRange(null)
        return
      }

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
      disabled,
      editor,
      handleSelectCommandPaletteItem,
      handleSelectMentionItem,
      handleSelectPromptTemplateItem,
      handleSubmit,
      isSubmitting,
      mentionSelectionItems,
      promptTemplateItems
    ]
  )

  return (
    <HeroPromptInput
      allowSubmitWhileRunning={isQueueSubmitEnabled}
      className="relative shadow-none"
      isDisabled={disabled}
      lockInputOnRun={false}
      onStop={onStop}
      onSubmit={() => {
        void handleSubmit()
      }}
      status={status}
      value={promptInputValue}
      variant="secondary"
    >
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

      <QueuedPromptMessageList
        editLabel={queueEditLabel}
        followUpLabel={queueFollowUpLabel}
        messages={queuedMessages}
        nextTurnLabel={queueNextTurnLabel}
        onEdit={handleStartEditQueuedMessage}
        onRemove={onQueuedMessageRemove}
        onReorder={onQueuedMessageReorder}
        onUpdate={onQueuedMessageUpdate}
        removeLabel={queueRemoveLabel}
        reorderLabel={queueReorderLabel}
        steerLabel={queueSteerLabel}
        titleLabel={queuedMessagesLabel}
      />

      <HeroPromptInput.Shell className="block rounded-[1.75rem]! hover:bg-default!">
        <HeroPromptInput.Content className="p-4">
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
                toggleLabel={agentModeToggleLabel}
              />
              {footer}
            </div>
          </HeroPromptInput.ToolbarStart>
          <HeroPromptInput.ToolbarEnd>
            <PromptInputActions
              disabled={disabled}
              hasPromptInputValue={promptInputValue.trim().length > 0}
              isOutputActive={isOutputActive}
              isQueueSubmitEnabled={isQueueSubmitEnabled}
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
