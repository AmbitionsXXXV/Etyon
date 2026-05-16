import type { ChatMention, ProjectSnapshotItem } from "@etyon/rpc"

export interface ActiveMentionMatch {
  query: string
  startIndex: number
}

export interface PromptEditorActiveMentionRange {
  from: number
  query: string
  to: number
}

export type PromptTextDisplayPart =
  | {
      text: string
      type: "text"
    }
  | {
      mention: ChatMention
      type: "mention"
    }

interface PromptEditorJsonNode {
  attrs?: Record<string, unknown>
  content?: PromptEditorJsonNode[]
  text?: string
  type?: string
}

const MENTION_PREFIX_PATTERN = /(^|[\s.,:;!?()[\]{}])@([^\s@]*)$/u
export const PROJECT_MENTION_NODE_TYPE = "projectMention"

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

const createMentionFromEditorAttrs = (
  attrs: Record<string, unknown> | undefined
): ChatMention | null => {
  if (!attrs) {
    return null
  }

  const { kind, path, relativePath, snapshotId } = attrs
  const isValidKind = kind === "file" || kind === "folder"

  if (
    !isValidKind ||
    typeof path !== "string" ||
    typeof relativePath !== "string" ||
    typeof snapshotId !== "string"
  ) {
    return null
  }

  return {
    kind,
    path,
    relativePath,
    snapshotId
  }
}

export const extractPromptEditorPayload = (
  documentNode: PromptEditorJsonNode
): {
  mentions: ChatMention[]
  text: string
} => {
  const mentions: ChatMention[] = []
  const textParts: string[] = []

  const visitNode = (node: PromptEditorJsonNode): void => {
    if (node.type === "text" && node.text) {
      textParts.push(node.text)
      return
    }

    if (node.type === PROJECT_MENTION_NODE_TYPE) {
      const mention = createMentionFromEditorAttrs(node.attrs)

      if (mention) {
        mentions.push(mention)
        textParts.push(`@${mention.relativePath}`)
      }

      return
    }

    for (const childNode of node.content ?? []) {
      visitNode(childNode)
    }
  }

  visitNode(documentNode)

  return {
    mentions,
    text: textParts.join("").trim()
  }
}

export const getPromptEditorActiveMentionRange = ({
  selectionFrom,
  textBeforeCaret
}: {
  selectionFrom: number
  textBeforeCaret: string
}): PromptEditorActiveMentionRange | null => {
  const activeMentionMatch = getActiveMentionMatch(
    textBeforeCaret,
    textBeforeCaret.length
  )

  if (!activeMentionMatch) {
    return null
  }

  const from = selectionFrom - activeMentionMatch.query.length - 1

  if (from < 0) {
    return null
  }

  return {
    from,
    query: activeMentionMatch.query,
    to: selectionFrom
  }
}

export const splitPromptTextByMentions = ({
  mentions,
  text
}: {
  mentions: ChatMention[]
  text: string
}): PromptTextDisplayPart[] => {
  const parts: PromptTextDisplayPart[] = []
  let cursor = 0

  while (cursor < text.length) {
    let nextMatch:
      | {
          index: number
          mention: ChatMention
        }
      | undefined

    for (const mention of mentions) {
      const mentionIndex = text.indexOf(`@${mention.relativePath}`, cursor)

      if (
        mentionIndex !== -1 &&
        (!nextMatch || mentionIndex < nextMatch.index)
      ) {
        nextMatch = {
          index: mentionIndex,
          mention
        }
      }
    }

    if (!nextMatch) {
      parts.push({
        text: text.slice(cursor),
        type: "text"
      })
      break
    }

    if (nextMatch.index > cursor) {
      parts.push({
        text: text.slice(cursor, nextMatch.index),
        type: "text"
      })
    }

    parts.push({
      mention: nextMatch.mention,
      type: "mention"
    })
    cursor = nextMatch.index + nextMatch.mention.relativePath.length + 1
  }

  return parts
}
