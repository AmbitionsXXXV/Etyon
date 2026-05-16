import type { ChatMention, ProjectSnapshotItem } from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Input } from "@heroui/react"
import {
  File01Icon,
  Folder01Icon,
  Search01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { Editor } from "@tiptap/core"
import { Placeholder } from "@tiptap/extension-placeholder"
import { EditorContent, useEditor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ProjectMentionExtension } from "@/renderer/lib/chat/project-mention-extension"
import {
  PROJECT_MENTION_NODE_TYPE,
  createMentionFromProjectSnapshotItem,
  extractPromptEditorPayload,
  getPromptEditorActiveMentionRange,
  scrollActiveMentionItemIntoView
} from "@/renderer/lib/chat/prompt-input"

const formatFileSize = (size: number): string => {
  if (size >= 1_000_000) {
    return `${(size / 1_000_000).toFixed(1)} MB`
  }

  if (size >= 1000) {
    return `${(size / 1000).toFixed(1)} KB`
  }

  return `${size} B`
}

const formatMentionItemMetadata = (item: ProjectSnapshotItem): string => {
  if (item.kind === "folder") {
    return `${item.fileCount} files`
  }

  return [item.language ?? "text", formatFileSize(item.size)].join(" · ")
}

const getMentionItemName = (item: ProjectSnapshotItem): string =>
  item.relativePath.split("/").at(-1) ?? item.relativePath

export const PromptInput = ({
  disabled = false,
  footer,
  isLoadingFileItems = false,
  mentionFileGroupLabel,
  mentionFolderGroupLabel,
  mentionItems,
  mentionEmptyLabel,
  mentionSearchPlaceholder,
  onMentionQueryChange,
  onSubmit,
  placeholder,
  submitLabel
}: {
  disabled?: boolean
  footer?: ReactNode
  isLoadingFileItems?: boolean
  mentionFileGroupLabel: string
  mentionFolderGroupLabel: string
  mentionItems: ProjectSnapshotItem[]
  mentionEmptyLabel: string
  mentionSearchPlaceholder: string
  onMentionQueryChange: (query: string | null) => void
  onSubmit: (payload: {
    mentions: ChatMention[]
    text: string
  }) => Promise<void>
  placeholder: string
  submitLabel: string
}) => {
  const [activeItemIndex, setActiveItemIndex] = useState(0)
  const [activeMentionRange, setActiveMentionRange] = useState<{
    from: number
    query: string
    to: number
  } | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const mentionItemElementByPathRef = useRef(
    new Map<string, HTMLButtonElement>()
  )
  const activeMentionItemPath = mentionItems[activeItemIndex]?.path ?? null
  const mentionItemsByPath = useMemo(
    () => new Map(mentionItems.map((item) => [item.path, item])),
    [mentionItems]
  )
  const mentionItemGroups = useMemo(
    () =>
      [
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
      ].filter((group) => group.items.length > 0),
    [mentionFileGroupLabel, mentionFolderGroupLabel, mentionItems]
  )

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
    onMentionQueryChange(activeMentionRange ? activeMentionRange.query : null)
  }, [activeMentionRange, onMentionQueryChange])

  useEffect(() => {
    editor?.setEditable(!(disabled || isSubmitting))
  }, [disabled, editor, isSubmitting])

  useEffect(() => {
    setActiveItemIndex(0)
  }, [mentionItems])

  useEffect(() => {
    if (!activeMentionRange || !activeMentionItemPath) {
      return
    }

    scrollActiveMentionItemIntoView(
      mentionItemElementByPathRef.current.get(activeMentionItemPath)
    )
  }, [activeMentionItemPath, activeMentionRange])

  const handleSelectMentionItem = useCallback(
    (item: ProjectSnapshotItem) => {
      if (!activeMentionRange || !editor) {
        return
      }

      const nextMention = createMentionFromProjectSnapshotItem(item)

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

  const handleEmbeddedSearchChange = useCallback(
    (nextQuery: string) => {
      if (!activeMentionRange || !editor) {
        return
      }

      const nextCaretPosition = activeMentionRange.from + nextQuery.length + 1

      editor
        .chain()
        .focus()
        .insertContentAt(
          {
            from: activeMentionRange.from,
            to: activeMentionRange.to
          },
          `@${nextQuery}`
        )
        .setTextSelection(nextCaretPosition)
        .run()
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

  const handleEmbeddedSearchInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleEmbeddedSearchChange(event.currentTarget.value)
    },
    [handleEmbeddedSearchChange]
  )

  const handleSelectMentionItemClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { itemPath } = event.currentTarget.dataset

      if (!itemPath) {
        return
      }

      const item = mentionItemsByPath.get(itemPath)

      if (item) {
        handleSelectMentionItem(item)
      }
    },
    [handleSelectMentionItem, mentionItemsByPath]
  )

  const handleMentionItemRef = useCallback(
    (itemPath: string, element: HTMLButtonElement | null) => {
      if (!element) {
        mentionItemElementByPathRef.current.delete(itemPath)
        return
      }

      mentionItemElementByPathRef.current.set(itemPath, element)
    },
    []
  )

  const handleEditorKeyDown = useCallback(
    async (event: KeyboardEvent<HTMLDivElement>) => {
      if (activeMentionRange && mentionItems.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setActiveItemIndex((previousIndex) =>
            Math.min(previousIndex + 1, mentionItems.length - 1)
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
          const selectedItem = mentionItems[activeItemIndex]

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
      mentionItems
    ]
  )

  const handleSubmitClick = useCallback(() => {
    void handleSubmit()
  }, [handleSubmit])

  return (
    <div className="relative rounded-[1.75rem] border border-border bg-transparent shadow-none">
      {activeMentionRange && (
        <div className="absolute right-4 bottom-full left-4 z-20 mb-2 overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
          <div className="border-b border-border/60 p-2">
            <div className="relative">
              <HugeiconsIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                icon={Search01Icon}
                strokeWidth={2}
              />
              <Input
                className="h-8 rounded-xl bg-none pl-8"
                onChange={handleEmbeddedSearchInputChange}
                placeholder={mentionSearchPlaceholder}
                value={activeMentionRange.query}
              />
            </div>
          </div>

          <div
            aria-label={mentionSearchPlaceholder}
            className="max-h-72 overflow-y-auto p-1"
            role="listbox"
          >
            {isLoadingFileItems && (
              <div className="p-3 text-xs text-muted-foreground">
                {mentionSearchPlaceholder}
              </div>
            )}

            {!isLoadingFileItems && mentionItems.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">
                {mentionEmptyLabel}
              </div>
            )}

            {!isLoadingFileItems &&
              mentionItemGroups.map((group) => (
                <div className="py-1" key={group.id}>
                  <div className="px-3 py-1 text-[0.68rem] font-medium tracking-normal text-muted-foreground uppercase">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    const itemIndex = mentionItems.findIndex(
                      (mentionItem) => mentionItem.path === item.path
                    )

                    return (
                      <button
                        aria-selected={itemIndex === activeItemIndex}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left text-xs/relaxed transition-colors",
                          itemIndex === activeItemIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50"
                        )}
                        data-item-path={item.path}
                        key={item.path}
                        onClick={handleSelectMentionItemClick}
                        ref={(element) => {
                          handleMentionItemRef(item.path, element)
                        }}
                        role="option"
                        type="button"
                      >
                        <HugeiconsIcon
                          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                          icon={
                            item.kind === "folder" ? Folder01Icon : File01Icon
                          }
                          strokeWidth={2}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {getMentionItemName(item)}
                          </span>
                          <span className="block truncate text-muted-foreground">
                            {item.relativePath}
                          </span>
                          <span className="block truncate text-muted-foreground">
                            {formatMentionItemMetadata(item)}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
          </div>
        </div>
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
