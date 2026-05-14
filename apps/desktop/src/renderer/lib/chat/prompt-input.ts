import type { ChatMention, ProjectSnapshotItem } from "@etyon/rpc"

export interface ActiveMentionMatch {
  query: string
  startIndex: number
}

const MENTION_PREFIX_PATTERN = /(^|[\s.,:;!?()[\]{}])@([^\s@]*)$/u

export const getActiveMentionMatch = (
  text: string,
  caretIndex: number
): ActiveMentionMatch | null => {
  const textBeforeCaret = text.slice(0, caretIndex)
  const match = textBeforeCaret.match(MENTION_PREFIX_PATTERN)

  if (!match || match.index === undefined) {
    return null
  }

  return {
    query: match[2] ?? "",
    startIndex: match.index + match[1].length
  }
}

export const replaceMentionQuery = ({
  nextQuery,
  selectionEnd,
  startIndex,
  text
}: {
  nextQuery: string
  selectionEnd: number
  startIndex: number
  text: string
}): { nextCaretIndex: number; nextText: string } => {
  const nextText = `${text.slice(0, startIndex + 1)}${nextQuery}${text.slice(
    selectionEnd
  )}`

  return {
    nextCaretIndex: startIndex + nextQuery.length + 1,
    nextText
  }
}

export const applyMentionSelection = ({
  selectionEnd,
  startIndex,
  text
}: {
  selectionEnd: number
  startIndex: number
  text: string
}): { nextCaretIndex: number; nextText: string } => {
  const nextText = `${text.slice(0, startIndex)}${text.slice(selectionEnd)}`
  const normalizedText =
    nextText.length > 0 && !/\s$/u.test(nextText) ? `${nextText} ` : nextText

  return {
    nextCaretIndex: normalizedText.length,
    nextText: normalizedText
  }
}

export const createMentionFromProjectSnapshotItem = (
  item: ProjectSnapshotItem
): ChatMention => {
  if (item.kind === "folder") {
    return {
      kind: "folder",
      path: item.path,
      relativePath: item.relativePath,
      snapshotId: item.snapshotId
    }
  }

  return {
    kind: "file",
    path: item.path,
    relativePath: item.relativePath,
    snapshotId: item.snapshotId
  }
}

export const scrollActiveMentionItemIntoView = (
  itemElement: Pick<HTMLElement, "scrollIntoView"> | null | undefined
): void => {
  itemElement?.scrollIntoView({
    block: "nearest",
    inline: "nearest"
  })
}

export const getMentionTokenTypeLabel = (
  mention: Pick<ChatMention, "kind" | "relativePath">
): string => {
  if (mention.kind === "folder") {
    return "DIR"
  }

  const fileName = mention.relativePath.split("/").at(-1) ?? ""
  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : null

  return extension ? extension.toUpperCase() : "TXT"
}
