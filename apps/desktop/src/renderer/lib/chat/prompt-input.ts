import type { ChatMention, ParsedSkill, ProjectSnapshotItem } from "@etyon/rpc"

export interface ActiveMentionMatch {
  query: string
  startIndex: number
  trigger: PromptMentionTrigger
}

export type PromptMentionTrigger = "project" | "skill"

export interface PromptEditorActiveMentionRange {
  from: number
  query: string
  to: number
  trigger: PromptMentionTrigger
}

export interface PromptSkillMentionItem {
  body: string
  description: string
  kind: "skill"
  name: string
  path: string
  projectPath: string | null
  relativePath: string
  scope: ParsedSkill["scope"]
  shortDescription: string | null
}

export type PromptMentionItem = ProjectSnapshotItem | PromptSkillMentionItem

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

const MENTION_PREFIX_PATTERN = /(^|[\s.,:;!?()[\]{}])([@$])([^\s@$]*)$/u
const SKILL_QUERY_SEPARATOR = "\n"
export const PROJECT_MENTION_NODE_TYPE = "projectMention"

const getMentionTriggerFromPrefix = (
  value: string | undefined
): PromptMentionTrigger | null => {
  if (value === "$") {
    return "skill"
  }

  if (value === "@") {
    return "project"
  }

  return null
}

export const getActiveMentionMatch = (
  text: string,
  caretIndex: number
): ActiveMentionMatch | null => {
  const textBeforeCaret = text.slice(0, caretIndex)
  const match = textBeforeCaret.match(MENTION_PREFIX_PATTERN)

  if (!match || match.index === undefined) {
    return null
  }

  const trigger = getMentionTriggerFromPrefix(match[2])

  if (!trigger) {
    return null
  }

  return {
    query: match[3] ?? "",
    startIndex: match.index + match[1].length,
    trigger
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

export const createPromptSkillMentionItem = (
  skill: ParsedSkill
): PromptSkillMentionItem => ({
  body: skill.body,
  description: skill.description,
  kind: "skill",
  name: skill.name,
  path: skill.path,
  projectPath: skill.projectPath,
  relativePath: skill.name,
  scope: skill.scope,
  shortDescription: skill.shortDescription
})

export const createMentionFromPromptMentionItem = (
  item: PromptMentionItem
): ChatMention => {
  if (item.kind === "skill") {
    return {
      description: item.description,
      kind: "skill",
      name: item.name,
      path: item.path,
      projectPath: item.projectPath,
      relativePath: item.relativePath,
      scope: item.scope,
      shortDescription: item.shortDescription
    }
  }

  return createMentionFromProjectSnapshotItem(item)
}

export const getPromptMentionItemKey = (item: PromptMentionItem): string =>
  `${item.kind}:${item.path}`

const normalizeSkillQuery = (value: string): string =>
  value.trim().toLowerCase()

const getSkillSearchText = (skill: ParsedSkill): string =>
  [
    skill.name,
    skill.description,
    skill.shortDescription,
    skill.body,
    skill.path
  ]
    .filter(Boolean)
    .join(SKILL_QUERY_SEPARATOR)
    .toLowerCase()

export const filterPromptSkillMentionItems = ({
  limit,
  projectPath,
  query,
  skills
}: {
  limit: number
  projectPath: string
  query: string
  skills: ParsedSkill[]
}): PromptSkillMentionItem[] => {
  const normalizedQuery = normalizeSkillQuery(query)

  return skills
    .filter(
      (skill) => skill.scope === "global" || skill.projectPath === projectPath
    )
    .filter(
      (skill) =>
        normalizedQuery === "" ||
        getSkillSearchText(skill).includes(normalizedQuery)
    )
    .slice(0, limit)
    .map(createPromptSkillMentionItem)
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
  if (mention.kind === "skill") {
    return "SKILL"
  }

  if (mention.kind === "folder") {
    return "DIR"
  }

  const fileName = mention.relativePath.split("/").at(-1) ?? ""
  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : null

  return extension ? extension.toUpperCase() : "TXT"
}

export const getMentionTextValue = (mention: ChatMention): string => {
  if (mention.kind === "skill") {
    return mention.name
  }

  return mention.relativePath
}

const formatSkillName = (name: string): string =>
  name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")

export const getMentionDisplayName = (mention: ChatMention): string => {
  if (mention.kind === "skill") {
    return formatSkillName(mention.name)
  }

  return mention.relativePath.split("/").at(-1) ?? mention.relativePath
}

export const getMentionTextPrefix = (mention: ChatMention): "@" | "$" =>
  mention.kind === "skill" ? "$" : "@"

const getMentionTextToken = (mention: ChatMention): string =>
  `${getMentionTextPrefix(mention)}${getMentionTextValue(mention)}`

export const getMentionTitle = (mention: ChatMention): string => {
  if (mention.kind === "skill") {
    return mention.shortDescription ?? mention.description
  }

  return mention.relativePath
}

export const createMentionFromEditorAttrs = (
  attrs: Record<string, unknown> | undefined
): ChatMention | null => {
  if (!attrs) {
    return null
  }

  const { kind, path, relativePath, snapshotId } = attrs

  if (kind === "skill") {
    const { description, name, projectPath, scope, shortDescription } = attrs

    if (
      typeof name !== "string" ||
      typeof path !== "string" ||
      (scope !== "global" && scope !== "project")
    ) {
      return null
    }

    return {
      description: typeof description === "string" ? description : "",
      kind,
      name,
      path,
      projectPath: typeof projectPath === "string" ? projectPath : null,
      relativePath: typeof relativePath === "string" ? relativePath : name,
      scope,
      shortDescription:
        typeof shortDescription === "string" ? shortDescription : null
    }
  }

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
        textParts.push(getMentionTextToken(mention))
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
    to: selectionFrom,
    trigger: activeMentionMatch.trigger
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
      const mentionText = getMentionTextToken(mention)
      const fallbackMentionText =
        mention.kind === "skill" ? `@${getMentionTextValue(mention)}` : null
      const mentionIndex = text.indexOf(mentionText, cursor)
      const fallbackMentionIndex =
        fallbackMentionText === null
          ? -1
          : text.indexOf(fallbackMentionText, cursor)
      const nextMentionIndex =
        mentionIndex === -1 ? fallbackMentionIndex : mentionIndex

      if (
        nextMentionIndex !== -1 &&
        (!nextMatch || nextMentionIndex < nextMatch.index)
      ) {
        nextMatch = {
          index: nextMentionIndex,
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
    cursor = nextMatch.index + getMentionTextValue(nextMatch.mention).length + 1
  }

  return parts
}
