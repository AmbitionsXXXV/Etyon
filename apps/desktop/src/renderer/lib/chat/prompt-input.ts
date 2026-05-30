import type {
  ChatMention,
  ParsedSkill,
  ProjectSnapshotItem,
  PromptTemplate
} from "@etyon/rpc"
import { CubeIcon, File01Icon, Folder01Icon } from "@hugeicons/core-free-icons"

export interface ActiveMentionMatch {
  query: string
  startIndex: number
  trigger: PromptMentionTrigger
}

export type PromptMentionTrigger = "project" | "skill"
type PromptSkillMentionSearchMode = "full" | "title"

export interface PromptEditorActiveMentionRange {
  from: number
  query: string
  to: number
  trigger: PromptMentionTrigger
}

export interface PromptEditorActiveCommandPaletteRange {
  from: number
  query: string
  to: number
}

export interface PromptEditorActivePromptTemplateCommandRange {
  from: number
  query: string
  to: number
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

export interface PromptMentionItemGroup {
  id: string
  items: PromptMentionItem[]
  label: string
}

export interface PromptMentionQueryState {
  query: string
  trigger: PromptMentionTrigger
}

export interface PromptCommandPaletteItem {
  command: string
  description: string
  id: "plan" | "prompt" | "skill"
  insertText: string
  label: string
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

export interface PromptPlanShortcutLikeEvent {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey?: boolean
  shiftKey?: boolean
}

export interface PromptSubmitKeyLikeEvent {
  key: string
  nativeEvent?: {
    isComposing?: boolean
    keyCode?: number
    which?: number
  }
  shiftKey?: boolean
}

export interface PromptEditorJsonNode {
  attrs?: Record<string, unknown>
  content?: PromptEditorJsonNode[]
  text?: string
  type?: string
}

const MENTION_PREFIX_PATTERN = /(^|[\s.,:;!?()[\]{}])([@$])([^\s@$]*)$/u
const COMMAND_PALETTE_PATTERN = /(?:^|\n)(\/([^\s/]*)?)$/iu
const PLAN_COMMAND_PATTERN = /^\/plan(?:\s+|$)/iu
const PLAN_COMMAND_PREFIX = "/plan "
const PROMPT_TEMPLATE_COMMAND_PATTERN =
  /(?:^|\n)(\/prompt(?:\s+([^\s/]+)?)?)$/iu
const PROMPT_TEMPLATE_COMMAND_PREFIX = "/prompt "
const PROMPT_TEMPLATE_POSITIONAL_ARG_PATTERN = /(^|[^$])\$(\d+)/gu
const PROMPT_TEMPLATE_SAFE_ARG_PATTERN = /^[\w./:-]+$/u
const SKILL_QUERY_SEPARATOR = "\n"
const IME_PROCESS_KEY_CODE = 229
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

const formatSkillName = (name: string): string =>
  name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")

const getPromptPathBaseName = (value: string): string =>
  value.split(/[\\/]/u).findLast((part) => part.length > 0) ?? value

export const getPromptMentionItemName = (item: ProjectSnapshotItem): string =>
  item.relativePath.split("/").at(-1) ?? item.relativePath

export const getPromptSkillDescription = (
  item: PromptSkillMentionItem
): string => item.description

export const getPromptSkillDisplayName = (
  item: PromptSkillMentionItem
): string => formatSkillName(item.name)

export const getPromptSkillSourceLabel = ({
  globalLabel,
  item
}: {
  globalLabel: string
  item: PromptSkillMentionItem
}): string => {
  if (!item.projectPath) {
    return globalLabel
  }

  return getPromptPathBaseName(item.projectPath)
}

export const getPromptMentionItemIcon = (item: PromptMentionItem) => {
  if (item.kind === "folder") {
    return Folder01Icon
  }

  if (item.kind === "skill") {
    return CubeIcon
  }

  return File01Icon
}

export const buildPromptMentionItemGroups = ({
  activeTrigger,
  mentionFileGroupLabel,
  mentionFolderGroupLabel,
  mentionItems,
  mentionSkillGroupLabel,
  mentionSkillItems
}: {
  activeTrigger: PromptMentionTrigger | undefined
  mentionFileGroupLabel: string
  mentionFolderGroupLabel: string
  mentionItems: ProjectSnapshotItem[]
  mentionSkillGroupLabel: string
  mentionSkillItems: PromptSkillMentionItem[]
}): PromptMentionItemGroup[] => {
  if (activeTrigger === "skill") {
    return [
      {
        id: "skills",
        items: mentionSkillItems,
        label: mentionSkillGroupLabel
      }
    ].filter((group) => group.items.length > 0)
  }

  if (activeTrigger !== "project") {
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
}

export const getPromptMentionSelectionItems = (
  groups: PromptMentionItemGroup[]
): PromptMentionItem[] => groups.flatMap((group) => group.items)

export const getActivePromptMentionItemKey = ({
  activeItemIndex,
  items
}: {
  activeItemIndex: number
  items: PromptMentionItem[]
}): string | null =>
  items[activeItemIndex]
    ? getPromptMentionItemKey(items[activeItemIndex])
    : null

export const createPromptMentionItemsByKey = (
  items: PromptMentionItem[]
): Map<string, PromptMentionItem> =>
  new Map(items.map((item) => [getPromptMentionItemKey(item), item]))

const normalizeSkillQuery = (value: string): string =>
  value.trim().toLowerCase()

const normalizePromptTemplateQuery = (value: string): string =>
  value.trim().toLowerCase()

const getSkillTitleSearchText = (skill: ParsedSkill): string =>
  [skill.name, skill.name.replaceAll(/[-_\s]+/gu, " ")]
    .filter(Boolean)
    .join(SKILL_QUERY_SEPARATOR)
    .toLowerCase()

const getSkillFullSearchText = (skill: ParsedSkill): string =>
  [
    getSkillTitleSearchText(skill),
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
  searchMode,
  skills
}: {
  limit: number
  projectPath: string
  query: string
  searchMode: PromptSkillMentionSearchMode
  skills: ParsedSkill[]
}): PromptSkillMentionItem[] => {
  const normalizedQuery = normalizeSkillQuery(query)
  const getSearchText =
    searchMode === "title" ? getSkillTitleSearchText : getSkillFullSearchText

  return skills
    .filter(
      (skill) => skill.scope === "global" || skill.projectPath === projectPath
    )
    .filter(
      (skill) =>
        normalizedQuery === "" || getSearchText(skill).includes(normalizedQuery)
    )
    .slice(0, limit)
    .map(createPromptSkillMentionItem)
}

export const filterPromptTemplateItems = ({
  limit,
  query,
  templates
}: {
  limit: number
  query: string
  templates: PromptTemplate[]
}): PromptTemplate[] => {
  const normalizedQuery = normalizePromptTemplateQuery(query)

  return templates
    .filter((template) => {
      if (normalizedQuery === "") {
        return true
      }

      return [template.name, template.description, template.path]
        .filter(Boolean)
        .join(SKILL_QUERY_SEPARATOR)
        .toLowerCase()
        .includes(normalizedQuery)
    })
    .slice(0, limit)
}

export const filterPromptCommandPaletteItems = ({
  items,
  limit,
  query
}: {
  items: PromptCommandPaletteItem[]
  limit: number
  query: string
}): PromptCommandPaletteItem[] => {
  const normalizedQuery = normalizePromptTemplateQuery(query)

  return items
    .filter((item) => {
      if (normalizedQuery === "") {
        return true
      }

      return [item.command, item.description, item.label]
        .join(SKILL_QUERY_SEPARATOR)
        .toLowerCase()
        .includes(normalizedQuery)
    })
    .slice(0, limit)
}

const quotePromptTemplateCommandArg = (value: string): string => {
  if (PROMPT_TEMPLATE_SAFE_ARG_PATTERN.test(value)) {
    return value
  }

  return `"${value.replaceAll(/(["\\])/gu, "\\$1")}"`
}

export const createPromptTemplateCommandText = (
  template: Pick<PromptTemplate, "name">
): string =>
  `${PROMPT_TEMPLATE_COMMAND_PREFIX}${quotePromptTemplateCommandArg(template.name)} `

export const getPromptTemplateArgumentHints = (
  template: Pick<PromptTemplate, "body">
): string[] => {
  const indexes = new Set<number>()

  for (const match of template.body.matchAll(
    PROMPT_TEMPLATE_POSITIONAL_ARG_PATTERN
  )) {
    const index = Number(match[2])

    if (Number.isSafeInteger(index) && index > 0) {
      indexes.add(index)
    }
  }

  return [...indexes]
    .toSorted((left, right) => left - right)
    .map((index) => `$${index}`)
}

export const scrollActiveMentionItemIntoView = (
  itemElement: Pick<HTMLElement, "scrollIntoView"> | null | undefined
): void => {
  itemElement?.scrollIntoView({
    block: "nearest",
    inline: "nearest"
  })
}

export const isPromptSubmitKeyDown = (
  event: PromptSubmitKeyLikeEvent
): boolean => event.key === "Enter" && event.shiftKey !== true

export const isPromptNativeCompositionKeyDown = (
  event: PromptSubmitKeyLikeEvent
): boolean =>
  event.nativeEvent?.isComposing === true ||
  event.nativeEvent?.keyCode === IME_PROCESS_KEY_CODE ||
  event.nativeEvent?.which === IME_PROCESS_KEY_CODE

export const isPromptImeConfirmKeyDown = ({
  event,
  isCompositionActive,
  isCompositionEndGuardActive
}: {
  event: PromptSubmitKeyLikeEvent
  isCompositionActive: boolean
  isCompositionEndGuardActive: boolean
}): boolean =>
  isPromptSubmitKeyDown(event) &&
  (isCompositionActive ||
    isCompositionEndGuardActive ||
    isPromptNativeCompositionKeyDown(event))

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

const createPlanCommandTextNode = (): PromptEditorJsonNode => ({
  text: PLAN_COMMAND_PREFIX,
  type: "text"
})

const clonePromptEditorJsonNode = (
  node: PromptEditorJsonNode
): PromptEditorJsonNode => ({
  ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
  ...(node.content
    ? { content: node.content.map(clonePromptEditorJsonNode) }
    : {}),
  ...(node.text === undefined ? {} : { text: node.text }),
  ...(node.type === undefined ? {} : { type: node.type })
})

const prefixTextNodeWithPlanCommand = (
  node: PromptEditorJsonNode
): PromptEditorJsonNode => ({
  ...node,
  text: `${PLAN_COMMAND_PREFIX}${node.text ?? ""}`
})

const prefixPlanCommandInContent = (
  content: PromptEditorJsonNode[]
): PromptEditorJsonNode[] => {
  const [firstNode, ...remainingNodes] = content

  if (!firstNode) {
    return [createPlanCommandTextNode()]
  }

  if (firstNode.type === "text") {
    return [prefixTextNodeWithPlanCommand(firstNode), ...remainingNodes]
  }

  if (
    firstNode.content &&
    firstNode.type !== PROJECT_MENTION_NODE_TYPE &&
    firstNode.content.length > 0
  ) {
    return [
      {
        ...firstNode,
        content: prefixPlanCommandInContent(firstNode.content)
      },
      ...remainingNodes
    ]
  }

  return [createPlanCommandTextNode(), firstNode, ...remainingNodes]
}

export const applyPlanCommandPrefixToPromptEditorJson = (
  documentNode: PromptEditorJsonNode
): PromptEditorJsonNode => {
  const currentText = extractPromptEditorPayload(documentNode).text

  if (PLAN_COMMAND_PATTERN.test(currentText)) {
    return clonePromptEditorJsonNode(documentNode)
  }

  const nextDocumentNode = clonePromptEditorJsonNode(documentNode)

  if (!nextDocumentNode.content) {
    return {
      ...nextDocumentNode,
      content: [
        {
          content: [createPlanCommandTextNode()],
          type: "paragraph"
        }
      ],
      type: nextDocumentNode.type ?? "doc"
    }
  }

  return {
    ...nextDocumentNode,
    content: prefixPlanCommandInContent(nextDocumentNode.content)
  }
}

export const isPlanModeKeyboardShortcut = (
  event: PromptPlanShortcutLikeEvent
): boolean =>
  event.altKey &&
  event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey &&
  event.key.toLowerCase() === "p"

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

export const getPromptEditorActivePromptTemplateCommandRange = ({
  selectionFrom,
  textBeforeCaret
}: {
  selectionFrom: number
  textBeforeCaret: string
}): PromptEditorActivePromptTemplateCommandRange | null => {
  const match = textBeforeCaret.match(PROMPT_TEMPLATE_COMMAND_PATTERN)

  if (!match) {
    return null
  }

  const commandText = match[1] ?? ""
  const from = selectionFrom - commandText.length

  if (from < 0) {
    return null
  }

  return {
    from,
    query: match[2] ?? "",
    to: selectionFrom
  }
}

export const getPromptEditorActiveCommandPaletteRange = ({
  selectionFrom,
  textBeforeCaret
}: {
  selectionFrom: number
  textBeforeCaret: string
}): PromptEditorActiveCommandPaletteRange | null => {
  const match = textBeforeCaret.match(COMMAND_PALETTE_PATTERN)

  if (!match) {
    return null
  }

  const commandText = match[1] ?? ""
  const from = selectionFrom - commandText.length

  if (from < 0) {
    return null
  }

  return {
    from,
    query: match[2] ?? "",
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
