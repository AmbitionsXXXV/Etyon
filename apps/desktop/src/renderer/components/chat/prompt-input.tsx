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
import type {
  Dispatch,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  SetStateAction
} from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { listAgentComposerQueueActions } from "@/renderer/lib/chat/agent-queue"
import { ProjectMentionExtension } from "@/renderer/lib/chat/project-mention-extension"
import {
  PROJECT_MENTION_NODE_TYPE,
  applyPlanCommandPrefixToPromptEditorJson,
  buildPromptMentionItemGroups,
  createPromptTemplateCommandText,
  createPromptMentionItemsByKey,
  createMentionFromPromptMentionItem,
  extractPromptEditorPayload,
  getActivePromptMentionItemKey,
  getPromptEditorActiveMentionRange,
  getPromptEditorActivePromptTemplateCommandRange,
  getPromptMentionItemIcon,
  getPromptMentionItemKey,
  getPromptMentionItemName,
  getPromptMentionSelectionItems,
  getPromptSkillDescription,
  getPromptSkillDisplayName,
  getPromptSkillSourceLabel,
  isPlanModeKeyboardShortcut,
  scrollActiveMentionItemIntoView
} from "@/renderer/lib/chat/prompt-input"
import type {
  PromptMentionItemGroup,
  PromptMentionQueryState,
  PromptMentionItem,
  PromptSkillMentionItem,
  PromptMentionTrigger
} from "@/renderer/lib/chat/prompt-input"

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

const handleIndexedSuggestionKeyDown = <TItem,>({
  activeItemIndex,
  event,
  items,
  onSelect,
  setActiveItemIndex
}: {
  activeItemIndex: number
  event: KeyboardEvent<HTMLDivElement>
  items: TItem[]
  onSelect: (item: TItem) => void
  setActiveItemIndex: Dispatch<SetStateAction<number>>
}): boolean => {
  if (items.length === 0) {
    return false
  }

  if (event.key === "ArrowDown") {
    event.preventDefault()
    setActiveItemIndex((previousIndex) =>
      Math.min(previousIndex + 1, items.length - 1)
    )
    return true
  }

  if (event.key === "ArrowUp") {
    event.preventDefault()
    setActiveItemIndex((previousIndex) => Math.max(previousIndex - 1, 0))
    return true
  }

  if (event.key !== "Enter" || event.shiftKey) {
    return false
  }

  event.preventDefault()

  const selectedItem = items[activeItemIndex]

  if (selectedItem) {
    onSelect(selectedItem)
  }

  return true
}

const PromptInputSuggestions = ({
  activeItemIndex,
  activeMentionRange,
  activePromptTemplateRange,
  currentMentionEmptyLabel,
  handleMentionItemRef,
  handlePromptTemplateRef,
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
  activeItemIndex: number
  activeMentionRange: unknown
  activePromptTemplateRange: unknown
  currentMentionEmptyLabel: string
  handleMentionItemRef: (
    itemKey: string,
    element: HTMLButtonElement | null
  ) => void
  handlePromptTemplateRef: (
    itemPath: string,
    element: HTMLButtonElement | null
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
  queue,
  steerLabel
}: {
  followUpLabel: string
  queue: AgentSessionQueuedMessageQueue
  steerLabel: string
}): string => (queue === "follow-up" ? followUpLabel : steerLabel)

const QueuedPromptMessageList = ({
  editLabel,
  followUpLabel,
  messages,
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
          const nextQueue =
            message.queue === "follow-up"
              ? ("steer" as const)
              : ("follow-up" as const)
          const queueLabel = getQueueLabel({
            followUpLabel,
            queue: message.queue,
            steerLabel
          })
          const nextQueueLabel = getQueueLabel({
            followUpLabel,
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

const PromptInputActions = ({
  disabled,
  isOutputActive,
  isQueueSubmitEnabled,
  isSubmitting,
  onQueueSubmit,
  onStop,
  queueFollowUpLabel,
  queueSteerLabel,
  stopLabel,
  submitLabel
}: {
  disabled: boolean
  isOutputActive: boolean
  isQueueSubmitEnabled: boolean
  isSubmitting: boolean
  onQueueSubmit: (queue?: AgentSessionQueuedMessageQueue) => Promise<void>
  onStop?: () => void
  queueFollowUpLabel: string
  queueSteerLabel: string
  stopLabel: string
  submitLabel: string
}) => {
  const queueActions = listAgentComposerQueueActions({
    canQueueMessage: isOutputActive && isQueueSubmitEnabled
  })
  const actionLabel = isOutputActive ? stopLabel : submitLabel
  const actionIcon = isOutputActive ? StopIcon : SentIcon
  const status: ChatStatus = isOutputActive ? "streaming" : "ready"

  if (queueActions.length > 0) {
    return (
      <div className="flex items-center gap-2">
        <HeroPromptInput.Action
          aria-label={stopLabel}
          onPress={onStop}
          tooltip={stopLabel}
          type="button"
          variant="danger"
        >
          <HugeiconsIcon icon={StopIcon} size={16} strokeWidth={2} />
        </HeroPromptInput.Action>
        {queueActions.map((action) => {
          const icon = action.queue === "follow-up" ? Queue02Icon : SentIcon
          const label =
            action.queue === "follow-up" ? queueFollowUpLabel : queueSteerLabel

          return (
            <HeroPromptInput.Action
              aria-label={label}
              isDisabled={disabled || isSubmitting}
              key={action.queue}
              onPress={() => {
                void onQueueSubmit(action.queue)
              }}
              tooltip={label}
              type="button"
              variant={action.queue === "follow-up" ? "secondary" : "primary"}
            >
              <HugeiconsIcon icon={icon} size={16} strokeWidth={2} />
            </HeroPromptInput.Action>
          )
        })}
      </div>
    )
  }

  return (
    <HeroPromptInput.Send
      aria-label={actionLabel}
      isDisabled={isOutputActive ? false : disabled || isSubmitting}
      onStop={onStop}
      status={status}
      type="button"
    >
      <HugeiconsIcon icon={actionIcon} size={16} strokeWidth={2} />
    </HeroPromptInput.Send>
  )
}

export const PromptInput = ({
  disabled = false,
  footer,
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
  promptTemplateItems = [],
  queueEditLabel,
  queueFollowUpLabel,
  queueRemoveLabel,
  queueReorderLabel,
  queueSteerLabel,
  queuedMessages = [],
  queuedMessagesLabel,
  status = "ready",
  stopLabel,
  submitLabel
}: {
  disabled?: boolean
  footer?: ReactNode
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
  const promptTemplateElementByPathRef = useRef(
    new Map<string, HTMLButtonElement>()
  )
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

  const syncPromptInputValue = useCallback((nextEditor: Editor) => {
    setPromptInputValue(extractPromptEditorPayload(nextEditor.getJSON()).text)
  }, [])

  const updateActiveRanges = useCallback((nextEditor: Editor) => {
    const { selection } = nextEditor.state

    if (selection.from !== selection.to) {
      setActiveMentionRange(null)
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
    setActiveMentionRange(
      promptTemplateRange
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
          class: "min-h-28 whitespace-pre-wrap break-words text-sm outline-none"
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
  }, [mentionSelectionItems, promptTemplateItems])

  useEffect(() => {
    if (!activeMentionRange || !activeMentionItemKey) {
      return
    }

    scrollActiveMentionItemIntoView(
      mentionItemElementByKeyRef.current.get(activeMentionItemKey)
    )
  }, [activeMentionItemKey, activeMentionRange])

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

      if ((normalizedText === "" && mentions.length === 0) || disabled) {
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
      } finally {
        setIsSubmitting(false)
      }
    },
    [disabled, editingQueuedMessageId, editor, onQueuedMessageUpdate, onSubmit]
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
        setActivePromptTemplateRange(null)
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

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        await handleSubmit()
      }
    },
    [
      activeItemIndex,
      activeMentionRange,
      activePromptTemplateRange,
      disabled,
      editor,
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
      allowSubmitWhileRunning
      className="relative rounded-[1.75rem] border border-border bg-transparent shadow-none"
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
        activeItemIndex={activeItemIndex}
        activeMentionRange={activeMentionRange}
        activePromptTemplateRange={activePromptTemplateRange}
        currentMentionEmptyLabel={currentMentionEmptyLabel}
        handleMentionItemRef={handleMentionItemRef}
        handlePromptTemplateRef={handlePromptTemplateRef}
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
        onEdit={handleStartEditQueuedMessage}
        onRemove={onQueuedMessageRemove}
        onReorder={onQueuedMessageReorder}
        onUpdate={onQueuedMessageUpdate}
        removeLabel={queueRemoveLabel}
        reorderLabel={queueReorderLabel}
        steerLabel={queueSteerLabel}
        titleLabel={queuedMessagesLabel}
      />

      <HeroPromptInput.Shell className="block">
        <HeroPromptInput.Content className="p-4">
          <div
            className={cn(
              "min-h-28 cursor-text text-sm",
              "data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50",
              "[&_.ProseMirror]:min-h-28 [&_.ProseMirror]:outline-none",
              "[&_.ProseMirror_p]:my-0",
              "[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
              "[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left",
              "[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0",
              "[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground",
              "[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
            )}
            data-disabled={disabled || isSubmitting}
            onKeyDownCapture={handleEditorKeyDown}
          >
            <EditorContent editor={editor} />
          </div>
        </HeroPromptInput.Content>

        <HeroPromptInput.Toolbar className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
          <HeroPromptInput.ToolbarStart className="min-w-0 flex-1">
            {footer}
          </HeroPromptInput.ToolbarStart>
          <HeroPromptInput.ToolbarEnd>
            <PromptInputActions
              disabled={disabled}
              isOutputActive={isOutputActive}
              isQueueSubmitEnabled={isQueueSubmitEnabled}
              isSubmitting={isSubmitting}
              onQueueSubmit={handleSubmit}
              onStop={onStop}
              queueFollowUpLabel={queueFollowUpLabel}
              queueSteerLabel={queueSteerLabel}
              stopLabel={stopLabel}
              submitLabel={submitLabel}
            />
          </HeroPromptInput.ToolbarEnd>
        </HeroPromptInput.Toolbar>
      </HeroPromptInput.Shell>
    </HeroPromptInput>
  )
}
