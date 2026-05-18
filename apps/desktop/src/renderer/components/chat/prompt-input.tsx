import type { ChatMention, ProjectSnapshotItem } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Button } from "@heroui/react"
import { CubeIcon, File01Icon, Folder01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Editor } from "@tiptap/core"
import { Placeholder } from "@tiptap/extension-placeholder"
import { EditorContent, useEditor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import type { KeyboardEvent, MouseEvent, ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ProjectMentionExtension } from "@/renderer/lib/chat/project-mention-extension"
import {
  PROJECT_MENTION_NODE_TYPE,
  createMentionFromPromptMentionItem,
  extractPromptEditorPayload,
  getPromptEditorActiveMentionRange,
  getPromptMentionItemKey,
  scrollActiveMentionItemIntoView
} from "@/renderer/lib/chat/prompt-input"
import type {
  PromptMentionItem,
  PromptMentionTrigger,
  PromptSkillMentionItem
} from "@/renderer/lib/chat/prompt-input"

interface MentionItemGroup {
  id: string
  items: PromptMentionItem[]
  label: string
}

interface MentionQueryState {
  query: string
  trigger: PromptMentionTrigger
}

const getMentionItemName = (item: ProjectSnapshotItem): string =>
  item.relativePath.split("/").at(-1) ?? item.relativePath

const getSkillDescription = (item: PromptSkillMentionItem): string =>
  item.description

const getSkillDisplayName = (item: PromptSkillMentionItem): string =>
  item.name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")

const getPathBaseName = (value: string): string =>
  value.split(/[\\/]/u).findLast((part) => part.length > 0) ?? value

const getSkillSourceLabel = ({
  globalLabel,
  item
}: {
  globalLabel: string
  item: PromptSkillMentionItem
}): string => {
  if (!item.projectPath) {
    return globalLabel
  }

  return getPathBaseName(item.projectPath)
}

const getMentionItemIcon = (item: PromptMentionItem) => {
  if (item.kind === "folder") {
    return Folder01Icon
  }

  if (item.kind === "skill") {
    return CubeIcon
  }

  return File01Icon
}

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
        {getSkillDisplayName(item)}
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          isActive ? "text-accent-foreground/85" : "text-muted-foreground"
        )}
      >
        {getSkillDescription(item)}
      </span>
    </span>
    <span
      className={cn(
        "ml-3 max-w-24 shrink-0 truncate",
        isActive ? "text-accent-foreground/80" : "text-muted-foreground"
      )}
    >
      {getSkillSourceLabel({
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
      {getMentionItemName(item)}
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
  const itemIcon = getMentionItemIcon(item)
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
  groups: MentionItemGroup[]
  isLoading: boolean
  isSkillMentionActive: boolean
  mentionSelectionItems: PromptMentionItem[]
  onItemClick: (event: MouseEvent<HTMLButtonElement>) => void
  onItemRef: (itemKey: string, element: HTMLButtonElement | null) => void
}) => (
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
      {isLoading && (
        <div className="p-3 text-xs text-muted-foreground">
          {currentEmptyLabel}
        </div>
      )}

      {!isLoading && mentionSelectionItems.length === 0 && (
        <div className="p-3 text-xs text-muted-foreground">
          {currentEmptyLabel}
        </div>
      )}

      {!isLoading &&
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

export const PromptInput = ({
  disabled = false,
  footer,
  isLoadingFileItems = false,
  isLoadingSkillItems = false,
  mentionGlobalSkillSourceLabel,
  mentionFileGroupLabel,
  mentionFolderGroupLabel,
  mentionItems,
  mentionEmptyLabel,
  mentionSkillEmptyLabel,
  mentionSkillGroupLabel,
  mentionSkillItems,
  onMentionQueryChange,
  onSubmit,
  placeholder,
  submitLabel
}: {
  disabled?: boolean
  footer?: ReactNode
  isLoadingFileItems?: boolean
  isLoadingSkillItems?: boolean
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
  onSubmit: (payload: {
    mentions: ChatMention[]
    text: string
  }) => Promise<void>
  placeholder: string
  submitLabel: string
}) => {
  const [activeItemIndex, setActiveItemIndex] = useState(0)
  const [activeMentionRange, setActiveMentionRange] = useState<
    (MentionQueryState & { from: number; to: number }) | null
  >(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const mentionItemElementByKeyRef = useRef(
    new Map<string, HTMLButtonElement>()
  )
  const mentionItemGroups = useMemo<MentionItemGroup[]>(() => {
    if (activeMentionRange?.trigger === "skill") {
      return [
        {
          id: "skills",
          items: mentionSkillItems,
          label: mentionSkillGroupLabel
        }
      ].filter((group) => group.items.length > 0)
    }

    if (activeMentionRange?.trigger !== "project") {
      return []
    }

    return [
      {
        id: "skills",
        items: mentionSkillItems,
        label: mentionSkillGroupLabel
      },
      {
        id: "folders",
        items: mentionItems.filter((item) => item.kind === "folder"),
        label: mentionFolderGroupLabel
      },
      {
        id: "files",
        items: mentionItems.filter((item) => item.kind === "file"),
        label: mentionFileGroupLabel
      }
    ].filter((group) => group.items.length > 0)
  }, [
    activeMentionRange?.trigger,
    mentionFileGroupLabel,
    mentionFolderGroupLabel,
    mentionItems,
    mentionSkillGroupLabel,
    mentionSkillItems
  ])
  const mentionSelectionItems = useMemo<PromptMentionItem[]>(
    () => mentionItemGroups.flatMap((group) => group.items),
    [mentionItemGroups]
  )
  const activeMentionItemKey = mentionSelectionItems[activeItemIndex]
    ? getPromptMentionItemKey(mentionSelectionItems[activeItemIndex])
    : null
  const mentionItemsByKey = useMemo(
    () =>
      new Map(
        mentionSelectionItems.map((item) => [
          getPromptMentionItemKey(item),
          item
        ])
      ),
    [mentionSelectionItems]
  )
  const isSkillMentionActive = activeMentionRange?.trigger === "skill"
  const isLoadingMentionItems = isSkillMentionActive
    ? isLoadingSkillItems
    : isLoadingFileItems
  const currentMentionEmptyLabel = isSkillMentionActive
    ? mentionSkillEmptyLabel
    : mentionEmptyLabel

  const updateActiveMentionRange = useCallback((nextEditor: Editor) => {
    const { selection } = nextEditor.state

    if (selection.from !== selection.to) {
      setActiveMentionRange(null)
      return
    }

    const textBeforeCaret = nextEditor.state.doc.textBetween(
      0,
      selection.from,
      "\n",
      "\n"
    )

    setActiveMentionRange(
      getPromptEditorActiveMentionRange({
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
        updateActiveMentionRange(nextEditor)
      },
      onUpdate: ({ editor: nextEditor }) => {
        updateActiveMentionRange(nextEditor)
      }
    },
    [placeholder, updateActiveMentionRange]
  )

  useEffect(() => {
    onMentionQueryChange(
      activeMentionRange ? activeMentionRange.query : null,
      activeMentionRange ? activeMentionRange.trigger : null
    )
  }, [activeMentionRange, onMentionQueryChange])

  useEffect(() => {
    editor?.setEditable(!(disabled || isSubmitting))
  }, [disabled, editor, isSubmitting])

  useEffect(() => {
    setActiveItemIndex(0)
  }, [mentionSelectionItems])

  useEffect(() => {
    if (!activeMentionRange || !activeMentionItemKey) {
      return
    }

    scrollActiveMentionItemIntoView(
      mentionItemElementByKeyRef.current.get(activeMentionItemKey)
    )
  }, [activeMentionItemKey, activeMentionRange])

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

  const handleSubmit = useCallback(async () => {
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
      await onSubmit({
        mentions,
        text: normalizedText
      })
      editor.commands.clearContent()
      editor.commands.focus()
      setActiveMentionRange(null)
    } finally {
      setIsSubmitting(false)
    }
  }, [disabled, editor, onSubmit])

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

  const handleEditorKeyDown = useCallback(
    async (event: KeyboardEvent<HTMLDivElement>) => {
      if (activeMentionRange && mentionSelectionItems.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setActiveItemIndex((previousIndex) =>
            Math.min(previousIndex + 1, mentionSelectionItems.length - 1)
          )
          return
        }

        if (event.key === "ArrowUp") {
          event.preventDefault()
          setActiveItemIndex((previousIndex) => Math.max(previousIndex - 1, 0))
          return
        }

        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault()
          const selectedItem = mentionSelectionItems[activeItemIndex]

          if (selectedItem) {
            handleSelectMentionItem(selectedItem)
          }

          return
        }
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        await handleSubmit()
      }
    },
    [
      activeItemIndex,
      activeMentionRange,
      handleSelectMentionItem,
      handleSubmit,
      mentionSelectionItems
    ]
  )

  const handleSubmitClick = useCallback(() => {
    void handleSubmit()
  }, [handleSubmit])

  return (
    <div className="relative rounded-[1.75rem] border border-border bg-transparent shadow-none">
      {activeMentionRange && (
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
      )}

      <div className="p-4">
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
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
        <div className="min-w-0 flex-1">{footer}</div>
        <Button
          isDisabled={disabled || isSubmitting}
          onPress={handleSubmitClick}
          size="sm"
          type="button"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
