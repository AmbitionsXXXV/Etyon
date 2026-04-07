import type { ChatMention, ProjectSnapshotFileItem } from "@etyon/rpc"
import { Badge } from "@etyon/ui/components/badge"
import { Button } from "@etyon/ui/components/button"
import { Input } from "@etyon/ui/components/input"
import { Textarea } from "@etyon/ui/components/textarea"
import { cn } from "@etyon/ui/lib/utils"
import {
  Cancel01Icon,
  File01Icon,
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
  fileItems,
  footer,
  isLoadingFileItems = false,
  mentionEmptyLabel,
  mentionSearchPlaceholder,
  onMentionQueryChange,
  onSubmit,
  placeholder,
  submitLabel
}: {
  disabled?: boolean
  fileItems: ProjectSnapshotFileItem[]
  footer?: ReactNode
  isLoadingFileItems?: boolean
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
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [caretIndex, setCaretIndex] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [mentions, setMentions] = useState<ChatMention[]>([])
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const activeMentionMatch = useMemo(
    () => getActiveMentionMatch(text, caretIndex),
    [caretIndex, text]
  )
  const fileItemsByPath = useMemo(
    () => new Map(fileItems.map((file) => [file.path, file])),
    [fileItems]
  )

  useEffect(() => {
    onMentionQueryChange(activeMentionMatch ? activeMentionMatch.query : null)
  }, [activeMentionMatch, onMentionQueryChange])

  useEffect(() => {
    setActiveFileIndex(0)
  }, [fileItems])

  const handleRemoveMention = useCallback((relativePath: string) => {
    setMentions((previousMentions) =>
      previousMentions.filter(
        (mention) => mention.relativePath !== relativePath
      )
    )
  }, [])

  const handleSelectFile = useCallback(
    (file: ProjectSnapshotFileItem) => {
      if (!activeMentionMatch) {
        return
      }

      const nextMention: ChatMention = {
        kind: "file",
        path: file.path,
        relativePath: file.relativePath,
        snapshotId: file.snapshotId
      }
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

  const handleSelectFileClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { filePath } = event.currentTarget.dataset

      if (!filePath) {
        return
      }

      const file = fileItemsByPath.get(filePath)

      if (file) {
        handleSelectFile(file)
      }
    },
    [fileItemsByPath, handleSelectFile]
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
      if (activeMentionMatch && fileItems.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setActiveFileIndex((previousIndex) =>
            Math.min(previousIndex + 1, fileItems.length - 1)
          )
          return
        }

        if (event.key === "ArrowUp") {
          event.preventDefault()
          setActiveFileIndex((previousIndex) => Math.max(previousIndex - 1, 0))
          return
        }

        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault()
          const selectedFile = fileItems[activeFileIndex]

          if (selectedFile) {
            handleSelectFile(selectedFile)
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
      activeFileIndex,
      activeMentionMatch,
      fileItems,
      handleSelectFile,
      handleSubmit
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

          <div className="max-h-72 overflow-y-auto p-1">
            {isLoadingFileItems && (
              <div className="p-3 text-xs text-muted-foreground">
                {mentionSearchPlaceholder}
              </div>
            )}

            {!isLoadingFileItems && fileItems.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">
                {mentionEmptyLabel}
              </div>
            )}

            {!isLoadingFileItems &&
              fileItems.map((file, index) => (
                <button
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left text-xs/relaxed transition-colors",
                    index === activeFileIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                  data-file-path={file.path}
                  key={file.path}
                  onClick={handleSelectFileClick}
                  type="button"
                >
                  <HugeiconsIcon
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    icon={File01Icon}
                    strokeWidth={2}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {file.relativePath.split("/").at(-1)}
                    </span>
                    <span className="block truncate text-muted-foreground">
                      {file.relativePath}
                    </span>
                    <span className="block truncate text-muted-foreground">
                      {[
                        file.language ?? "text",
                        formatFileSize(file.size)
                      ].join(" · ")}
                    </span>
                  </span>
                </button>
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
