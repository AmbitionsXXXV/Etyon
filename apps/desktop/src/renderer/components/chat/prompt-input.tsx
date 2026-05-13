import type { ChatMention, ProjectSnapshotItem } from "@etyon/rpc"
import { Badge } from "@etyon/ui/components/badge"
import { Button } from "@etyon/ui/components/button"
import { Input } from "@etyon/ui/components/input"
import { Textarea } from "@etyon/ui/components/textarea"
import { cn } from "@etyon/ui/lib/utils"
import {
  Cancel01Icon,
  File01Icon,
  Folder01Icon,
  Search01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type {
  ChangeEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  SyntheticEvent
} from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  applyMentionSelection,
  createMentionFromProjectSnapshotItem,
  getActiveMentionMatch,
  replaceMentionQuery
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

const focusTextareaAt = (
  nextCaretIndex: number,
  textareaElement: HTMLTextAreaElement | null
): void => {
  if (!textareaElement) {
    return
  }

  requestAnimationFrame(() => {
    textareaElement.focus()
    textareaElement.setSelectionRange(nextCaretIndex, nextCaretIndex)
  })
}

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
  const [caretIndex, setCaretIndex] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [mentions, setMentions] = useState<ChatMention[]>([])
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const activeMentionMatch = useMemo(
    () => getActiveMentionMatch(text, caretIndex),
    [caretIndex, text]
  )
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

  useEffect(() => {
    onMentionQueryChange(activeMentionMatch ? activeMentionMatch.query : null)
  }, [activeMentionMatch, onMentionQueryChange])

  useEffect(() => {
    setActiveItemIndex(0)
  }, [mentionItems])

  const handleRemoveMention = useCallback((relativePath: string) => {
    setMentions((previousMentions) =>
      previousMentions.filter(
        (mention) => mention.relativePath !== relativePath
      )
    )
  }, [])

  const handleSelectMentionItem = useCallback(
    (item: ProjectSnapshotItem) => {
      if (!activeMentionMatch) {
        return
      }

      const nextMention = createMentionFromProjectSnapshotItem(item)
      const { nextCaretIndex, nextText } = applyMentionSelection({
        selectionEnd: caretIndex,
        startIndex: activeMentionMatch.startIndex,
        text
      })

      setMentions((previousMentions) =>
        previousMentions.some(
          (previousMention) =>
            previousMention.relativePath === nextMention.relativePath
        )
          ? previousMentions
          : [...previousMentions, nextMention]
      )
      setText(nextText)
      setCaretIndex(nextCaretIndex)
      focusTextareaAt(nextCaretIndex, textareaRef.current)
    },
    [activeMentionMatch, caretIndex, text]
  )

  const handleEmbeddedSearchChange = useCallback(
    (nextQuery: string) => {
      if (!activeMentionMatch) {
        return
      }

      const { nextCaretIndex, nextText } = replaceMentionQuery({
        nextQuery,
        selectionEnd: caretIndex,
        startIndex: activeMentionMatch.startIndex,
        text
      })

      setText(nextText)
      setCaretIndex(nextCaretIndex)
      focusTextareaAt(nextCaretIndex, textareaRef.current)
    },
    [activeMentionMatch, caretIndex, text]
  )

  const handleSubmit = useCallback(async () => {
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
      setMentions([])
      setText("")
      setCaretIndex(0)
      focusTextareaAt(0, textareaRef.current)
    } finally {
      setIsSubmitting(false)
    }
  }, [disabled, mentions, onSubmit, text])

  const handleEmbeddedSearchInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      handleEmbeddedSearchChange(event.currentTarget.value)
    },
    [handleEmbeddedSearchChange]
  )

  const handleRemoveMentionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { relativePath } = event.currentTarget.dataset

      if (!relativePath) {
        return
      }

      handleRemoveMention(relativePath)
    },
    [handleRemoveMention]
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

  const handleTextareaChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setText(event.currentTarget.value)
      setCaretIndex(event.currentTarget.selectionStart)
    },
    []
  )

  const handleTextareaClick = useCallback(
    (event: MouseEvent<HTMLTextAreaElement>) => {
      setCaretIndex(event.currentTarget.selectionStart)
    },
    []
  )

  const handleTextareaKeyDown = useCallback(
    async (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (activeMentionMatch && mentionItems.length > 0) {
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
      activeMentionMatch,
      handleSelectMentionItem,
      handleSubmit,
      mentionItems
    ]
  )

  const handleTextareaSelect = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      setCaretIndex(event.currentTarget.selectionStart)
    },
    []
  )

  const handleSubmitClick = useCallback(() => {
    void handleSubmit()
  }, [handleSubmit])

  return (
    <div className="relative rounded-[1.75rem] border border-border bg-transparent shadow-none">
      {activeMentionMatch && (
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
                value={activeMentionMatch.query}
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

      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-4">
          {mentions.map((mention) => (
            <Badge
              className="gap-1.5"
              key={mention.relativePath}
              variant="outline"
            >
              <span className="max-w-60 truncate">{mention.relativePath}</span>
              <button
                className="rounded-full opacity-60 transition-opacity hover:opacity-100"
                data-relative-path={mention.relativePath}
                onClick={handleRemoveMentionClick}
                type="button"
              >
                <HugeiconsIcon
                  className="size-3"
                  icon={Cancel01Icon}
                  strokeWidth={2}
                />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="p-4">
        <Textarea
          className="min-h-28 border-0 bg-transparent px-0 py-0 text-sm shadow-none ring-0 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
          disabled={disabled || isSubmitting}
          onChange={handleTextareaChange}
          onClick={handleTextareaClick}
          onKeyDown={handleTextareaKeyDown}
          onSelect={handleTextareaSelect}
          placeholder={placeholder}
          ref={textareaRef}
          value={text}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
        <div className="min-w-0 flex-1">{footer}</div>
        <Button
          disabled={disabled || isSubmitting}
          onClick={handleSubmitClick}
          size="sm"
          type="button"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
