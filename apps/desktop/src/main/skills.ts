import fs from "node:fs"
import path from "node:path"

import type {
  ChatSkillMention,
  ParsedSkill,
  SkillSource,
  SkillsSettings
} from "@etyon/rpc"
import { app } from "electron"

import { loadPromptTemplates } from "@/main/agents/prompt-templates"
import type { PromptTemplate } from "@/main/agents/prompt-templates"
import { getAppConfigDir } from "@/main/db/libsql-paths"

const FRONTMATTER_DELIMITER = "---"
const MAX_SKILL_BODY_CHARS = 6000
const MAX_SKILL_PROMPT_CHARS = 16_000
const SKILL_FILE_NAME = "SKILL.md"
const SKILL_PROMPT_TEMPLATE_DIR_NAME = "prompts"
const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu
const XML_ESCAPE_PATTERN = /[&<>"']/gu
const XML_ESCAPES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&apos;",
  "<": "&lt;",
  ">": "&gt;"
}

interface ParsedSkillFile {
  body: string
  capabilities: string[]
  commands: ParsedSkill["commands"]
  description: string
  extensions: string[]
  modelVisible: boolean
  name: string
  path: string
  shortDescription: string | null
  visible: boolean
}

interface SkillCandidate {
  score: number
  skill: ParsedSkill
}

interface SkillFrontmatter {
  capabilities?: string[]
  commands?: ParsedSkill["commands"]
  description?: string
  extensions?: string[]
  modelDisabled?: boolean
  modelVisible?: boolean
  name?: string
  shortDescription?: string
  visible?: boolean
}

interface SkillCommandDraft {
  description?: string
  flags: string[]
  name?: string
}

const trimQuotes = (value: string): string =>
  value
    .trim()
    .replaceAll(/^["']|["']$/gu, "")
    .trim()

const parseFrontmatterValue = (line: string): [string, string] | null => {
  const separatorIndex = line.indexOf(":")

  if (separatorIndex === -1) {
    return null
  }

  return [
    line.slice(0, separatorIndex).trim(),
    trimQuotes(line.slice(separatorIndex + 1))
  ]
}

const parseFrontmatterBoolean = (value: string): boolean =>
  ["1", "true", "yes"].includes(value.trim().toLowerCase())

const parseListValue = (value: string): string[] =>
  value.split(",").map(trimQuotes).filter(Boolean)

const getIndentWidth = (line: string): number =>
  line.length - line.trimStart().length

const parseListItem = (line: string): string | null => {
  const trimmedLine = line.trim()

  if (!trimmedLine.startsWith("-")) {
    return null
  }

  return trimQuotes(trimmedLine.slice(1)) || null
}

const addUniqueValues = (
  currentValues: string[],
  nextValues: string[]
): string[] => {
  const result = [...currentValues]

  for (const value of nextValues) {
    if (!result.includes(value)) {
      result.push(value)
    }
  }

  return result
}

const addUniqueCommands = (
  currentCommands: ParsedSkill["commands"],
  nextCommands: ParsedSkill["commands"]
): ParsedSkill["commands"] => {
  const result = [...currentCommands]

  for (const command of nextCommands) {
    if (
      !result.some((existingCommand) => existingCommand.name === command.name)
    ) {
      result.push(command)
    }
  }

  return result
}

const parseInlineCommandValues = (value: string): ParsedSkill["commands"] =>
  parseListValue(value).map((name) => ({
    description: null,
    flags: [],
    name
  }))

const toSkillCommand = (
  draft: SkillCommandDraft
): ParsedSkill["commands"][number] | null => {
  const name = draft.name?.trim()

  if (!name) {
    return null
  }

  return {
    description: draft.description?.trim() || null,
    flags: draft.flags,
    name
  }
}

const collectIndentedListItems = (
  lines: string[],
  startIndex: number,
  parentIndent: number
): { lastIndex: number; values: string[] } => {
  const values: string[] = []
  let lastIndex = startIndex

  for (
    let nestedIndex = startIndex + 1;
    nestedIndex < lines.length;
    nestedIndex += 1
  ) {
    const nestedLine = lines[nestedIndex] ?? ""

    if (
      !nestedLine.startsWith(" ") ||
      getIndentWidth(nestedLine) <= parentIndent
    ) {
      break
    }

    const nestedValue = parseListItem(nestedLine)

    if (nestedValue) {
      values.push(nestedValue)
      lastIndex = nestedIndex
    }
  }

  return {
    lastIndex,
    values
  }
}

const createCommandDraftFromListItem = (value: string): SkillCommandDraft => {
  const parsedValue = parseFrontmatterValue(value)

  if (parsedValue?.[0] === "name") {
    return {
      flags: [],
      name: parsedValue[1]
    }
  }

  return {
    flags: [],
    name: value
  }
}

const applyCommandDraftProperty = ({
  draft,
  index,
  key,
  lines,
  value
}: {
  draft: SkillCommandDraft
  index: number
  key: string
  lines: string[]
  value: string
}): number => {
  switch (key) {
    case "description": {
      draft.description = value
      return index
    }
    case "flag":
    case "flags": {
      const nestedItems = collectIndentedListItems(
        lines,
        index,
        getIndentWidth(lines[index] ?? "")
      )

      draft.flags = addUniqueValues(draft.flags, [
        ...parseListValue(value),
        ...nestedItems.values
      ])

      return nestedItems.lastIndex
    }
    case "name": {
      draft.name = value
      return index
    }
    default: {
      return index
    }
  }
}

const parseCommandBlock = (
  lines: string[],
  startIndex: number
): ParsedSkill["commands"] => {
  const drafts: SkillCommandDraft[] = []
  let currentDraft: SkillCommandDraft | undefined

  for (
    let nestedIndex = startIndex + 1;
    nestedIndex < lines.length;
    nestedIndex += 1
  ) {
    const nestedLine = lines[nestedIndex] ?? ""

    if (!nestedLine.startsWith(" ")) {
      break
    }

    const listItem = parseListItem(nestedLine)

    if (listItem) {
      currentDraft = createCommandDraftFromListItem(listItem)
      drafts.push(currentDraft)
      continue
    }

    if (!currentDraft) {
      continue
    }

    const parsedValue = parseFrontmatterValue(nestedLine.trim())

    if (!parsedValue) {
      continue
    }

    nestedIndex = applyCommandDraftProperty({
      draft: currentDraft,
      index: nestedIndex,
      key: parsedValue[0],
      lines,
      value: parsedValue[1]
    })
  }

  return drafts.flatMap((draft) => {
    const command = toSkillCommand(draft)

    return command ? [command] : []
  })
}

const collectNestedListItems = (
  lines: string[],
  startIndex: number
): string[] => {
  const values: string[] = []

  for (
    let nestedIndex = startIndex + 1;
    nestedIndex < lines.length;
    nestedIndex += 1
  ) {
    const nestedLine = lines[nestedIndex] ?? ""

    if (!nestedLine.startsWith(" ")) {
      break
    }

    const nestedValue = parseListItem(nestedLine)

    if (nestedValue) {
      values.push(nestedValue)
    }
  }

  return values
}

const findNestedShortDescription = (
  lines: string[],
  startIndex: number
): string | undefined => {
  for (
    let nestedIndex = startIndex + 1;
    nestedIndex < lines.length;
    nestedIndex += 1
  ) {
    const nestedLine = lines[nestedIndex] ?? ""

    if (!nestedLine.startsWith(" ")) {
      break
    }

    const nestedValue = parseFrontmatterValue(nestedLine.trim())

    if (nestedValue?.[0] === "short-description") {
      const [, nestedDescription] = nestedValue

      return nestedDescription
    }
  }
}

type SkillFrontmatterHandler = ({
  index,
  lines,
  result,
  value
}: {
  index: number
  lines: string[]
  result: SkillFrontmatter
  value: string
}) => void

const applySkillCommandFrontmatter: SkillFrontmatterHandler = ({
  index,
  lines,
  result,
  value
}) => {
  result.commands = addUniqueCommands(result.commands ?? [], [
    ...parseInlineCommandValues(value),
    ...parseCommandBlock(lines, index)
  ])
}

const applySkillExtensionFrontmatter: SkillFrontmatterHandler = ({
  index,
  lines,
  result,
  value
}) => {
  result.extensions = addUniqueValues(result.extensions ?? [], [
    ...parseListValue(value),
    ...collectNestedListItems(lines, index)
  ])
}

const SKILL_FRONTMATTER_HANDLERS: Record<string, SkillFrontmatterHandler> = {
  capabilities: ({ index, lines, result, value }) => {
    result.capabilities = addUniqueValues(result.capabilities ?? [], [
      ...parseListValue(value),
      ...collectNestedListItems(lines, index)
    ])
  },
  command: applySkillCommandFrontmatter,
  commands: applySkillCommandFrontmatter,
  description: ({ result, value }) => {
    result.description = value
  },
  extension: applySkillExtensionFrontmatter,
  extensions: applySkillExtensionFrontmatter,
  metadata: ({ index, lines, result }) => {
    result.shortDescription =
      findNestedShortDescription(lines, index) ?? result.shortDescription
  },
  "model-disabled": ({ result, value }) => {
    result.modelDisabled = parseFrontmatterBoolean(value)
  },
  "model-visible": ({ result, value }) => {
    result.modelVisible = parseFrontmatterBoolean(value)
  },
  name: ({ result, value }) => {
    result.name = value
  },
  "short-description": ({ result, value }) => {
    result.shortDescription = value
  },
  visible: ({ result, value }) => {
    result.visible = parseFrontmatterBoolean(value)
  }
}

const parseSkillFrontmatter = (frontmatter: string): SkillFrontmatter => {
  const result: SkillFrontmatter = {}
  const lines = frontmatter.split("\n")

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trimEnd() ?? ""

    if (line.startsWith(" ")) {
      continue
    }

    const parsedValue = parseFrontmatterValue(line)

    if (!parsedValue) {
      continue
    }

    const [key, value] = parsedValue
    const handler = SKILL_FRONTMATTER_HANDLERS[key]

    if (!handler) {
      continue
    }

    handler({
      index,
      lines,
      result,
      value
    })
  }

  return result
}

const splitSkillMarkdown = (
  content: string
): { body: string; frontmatter: string } | null => {
  const normalizedContent = content.replaceAll("\r\n", "\n")

  if (!normalizedContent.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return null
  }

  const closingIndex = normalizedContent.indexOf(
    `\n${FRONTMATTER_DELIMITER}\n`,
    FRONTMATTER_DELIMITER.length + 1
  )

  if (closingIndex === -1) {
    return null
  }

  return {
    body: normalizedContent
      .slice(closingIndex + FRONTMATTER_DELIMITER.length + 2)
      .trim(),
    frontmatter: normalizedContent.slice(
      FRONTMATTER_DELIMITER.length + 1,
      closingIndex
    )
  }
}

const truncateText = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, maxChars - 3).trim()}...`
}

const getXmlEscape = (value: string): string => XML_ESCAPES[value] ?? value

const escapeXml = (value: string): string =>
  value.replaceAll(XML_ESCAPE_PATTERN, getXmlEscape)

const tokenize = (value: string): Set<string> =>
  new Set(
    Array.from(value.toLowerCase().matchAll(TOKEN_PATTERN), ([token]) => token)
  )

const scoreSkill = (skill: ParsedSkill, queryTokens: Set<string>): number => {
  if (queryTokens.size === 0) {
    return 0
  }

  const skillTokens = tokenize(
    [skill.name, skill.description, skill.shortDescription, skill.body]
      .filter(Boolean)
      .join("\n")
  )
  let overlap = 0

  for (const token of queryTokens) {
    if (skillTokens.has(token)) {
      overlap += 1
    }
  }

  return overlap
}

const getSkillRoots = ({
  projectPaths
}: {
  projectPaths: string[]
}): {
  projectPath: string | null
  root: string
  scope: ParsedSkill["scope"]
  source: SkillSource
}[] => {
  const homeDir = app.getPath("home")
  const globalRoots = [
    {
      root: path.join(homeDir, ".codex", "skills"),
      sourceKind: "user" as const
    },
    {
      root: path.join(homeDir, ".agents", "skills"),
      sourceKind: "user" as const
    },
    {
      root: path.join(getAppConfigDir(homeDir), "skills"),
      sourceKind: "app" as const
    }
  ]
  const projectRoots = projectPaths.flatMap((projectPath) => [
    {
      projectPath,
      root: path.join(projectPath, ".agents", "skills"),
      scope: "project" as const,
      source: {
        kind: "project" as const,
        root: path.join(projectPath, ".agents", "skills")
      }
    },
    {
      projectPath,
      root: path.join(projectPath, ".codex", "skills"),
      scope: "project" as const,
      source: {
        kind: "project" as const,
        root: path.join(projectPath, ".codex", "skills")
      }
    }
  ])

  return [
    ...projectRoots,
    ...globalRoots.map(({ root, sourceKind }) => ({
      projectPath: null,
      root,
      scope: "global" as const,
      source: {
        kind: sourceKind,
        root
      }
    }))
  ]
}

const listSkillFilesInRoot = (root: string): string[] => {
  if (!fs.existsSync(root)) {
    return []
  }

  return fs
    .readdirSync(root, {
      withFileTypes: true
    })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => path.join(root, entry.name, SKILL_FILE_NAME))
    .filter((skillPath) => fs.existsSync(skillPath))
}

const isPathInside = (candidatePath: string, parentPath: string): boolean => {
  const relativePath = path.relative(parentPath, candidatePath)

  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  )
}

const resolveSkillExtensionPath = ({
  extensionPath,
  skillPath
}: {
  extensionPath: string
  skillPath: string
}): string | null => {
  if (path.isAbsolute(extensionPath)) {
    return null
  }

  const skillDir = path.dirname(skillPath)
  const resolvedPath = path.resolve(skillDir, extensionPath)

  if (!isPathInside(resolvedPath, skillDir)) {
    return null
  }

  return resolvedPath
}

export const parseSkillFile = (skillPath: string): ParsedSkillFile => {
  const content = fs.readFileSync(skillPath, "utf-8")
  const parsedMarkdown = splitSkillMarkdown(content)

  if (!parsedMarkdown) {
    throw new Error(`Invalid skill file frontmatter: ${skillPath}`)
  }

  const frontmatter = parseSkillFrontmatter(parsedMarkdown.frontmatter)
  const name = frontmatter.name?.trim()
  const description = frontmatter.description?.trim()

  if (!name || !description) {
    throw new Error(`Skill file requires name and description: ${skillPath}`)
  }

  return {
    body: truncateText(parsedMarkdown.body, MAX_SKILL_BODY_CHARS),
    capabilities: frontmatter.capabilities ?? [],
    commands: frontmatter.commands ?? [],
    description,
    extensions: frontmatter.extensions ?? [],
    modelVisible: frontmatter.modelDisabled
      ? false
      : (frontmatter.modelVisible ?? true),
    name,
    path: skillPath,
    shortDescription: frontmatter.shortDescription?.trim() || null,
    visible: frontmatter.visible ?? true
  }
}

const formatSkillCapabilitiesForSystemPrompt = (
  capabilities: string[]
): string =>
  capabilities.length === 0
    ? ""
    : [
        "<capabilities>",
        ...capabilities.map(
          (capability) => `<capability>${escapeXml(capability)}</capability>`
        ),
        "</capabilities>"
      ].join("\n")

const formatSkillCommandFlagsForSystemPrompt = (flags: string[]): string =>
  flags.length === 0
    ? ""
    : [
        "<flags>",
        ...flags.map((flag) => `<flag>${escapeXml(flag)}</flag>`),
        "</flags>"
      ].join("\n")

const formatSkillCommandsForSystemPrompt = (
  commands: ParsedSkill["commands"]
): string =>
  commands.length === 0
    ? ""
    : [
        "<commands>",
        ...commands.map((command) =>
          [
            "<command>",
            `<name>${escapeXml(command.name)}</name>`,
            command.description
              ? `<description>${escapeXml(command.description)}</description>`
              : "",
            formatSkillCommandFlagsForSystemPrompt(command.flags),
            "</command>"
          ]
            .filter(Boolean)
            .join("\n")
        ),
        "</commands>"
      ].join("\n")

const formatSkillCommandSelectedFlagsForSystemPrompt = (
  selectedFlags: readonly string[]
): string =>
  selectedFlags.length === 0
    ? ""
    : [
        "<selected_flags>",
        ...selectedFlags.map((flag) => `<flag>${escapeXml(flag)}</flag>`),
        "</selected_flags>"
      ].join("\n")

export const formatSkillCommandInvocation = ({
  args,
  command,
  selectedFlags,
  skill
}: {
  args: readonly string[]
  command: ParsedSkill["commands"][number]
  selectedFlags: readonly string[]
  skill: ParsedSkill
}): string =>
  [
    "<skill_command_invocation>",
    "<skill>",
    `<name>${escapeXml(skill.name)}</name>`,
    `<description>${escapeXml(skill.description)}</description>`,
    skill.shortDescription
      ? `<short_description>${escapeXml(skill.shortDescription)}</short_description>`
      : "",
    `<path>${escapeXml(skill.path)}</path>`,
    `<scope>${escapeXml(skill.scope)}</scope>`,
    "</skill>",
    "<command>",
    `<name>${escapeXml(command.name)}</name>`,
    command.description
      ? `<description>${escapeXml(command.description)}</description>`
      : "",
    formatSkillCommandFlagsForSystemPrompt(command.flags),
    formatSkillCommandSelectedFlagsForSystemPrompt(selectedFlags),
    "</command>",
    args.length > 0
      ? `<arguments>${escapeXml(args.join(" "))}</arguments>`
      : "",
    skill.modelVisible
      ? ["<instructions>", escapeXml(skill.body), "</instructions>"].join("\n")
      : "<instructions_model_visible>false</instructions_model_visible>",
    "</skill_command_invocation>"
  ]
    .filter(Boolean)
    .join("\n")

export const formatSkillInvocation = (
  skill: ParsedSkill,
  additionalInstructions?: string
): string =>
  [
    "<skill_invocation>",
    "<skill>",
    `<name>${escapeXml(skill.name)}</name>`,
    `<description>${escapeXml(skill.description)}</description>`,
    skill.shortDescription
      ? `<short_description>${escapeXml(skill.shortDescription)}</short_description>`
      : "",
    `<path>${escapeXml(skill.path)}</path>`,
    `<scope>${escapeXml(skill.scope)}</scope>`,
    `<reference_root>${escapeXml(path.dirname(skill.path))}</reference_root>`,
    formatSkillCapabilitiesForSystemPrompt(skill.capabilities),
    formatSkillCommandsForSystemPrompt(skill.commands),
    skill.modelVisible
      ? ["<instructions>", escapeXml(skill.body), "</instructions>"].join("\n")
      : "<instructions_model_visible>false</instructions_model_visible>",
    "</skill>",
    additionalInstructions
      ? [
          "<additional_instructions>",
          escapeXml(additionalInstructions),
          "</additional_instructions>"
        ].join("\n")
      : "",
    "</skill_invocation>"
  ]
    .filter(Boolean)
    .join("\n")

export const listSkills = ({
  projectPaths = []
}: {
  projectPaths?: string[]
} = {}): ParsedSkill[] => {
  const normalizedProjectPaths = [
    ...new Set(projectPaths.map((projectPath) => path.resolve(projectPath)))
  ]
  const skills: ParsedSkill[] = []

  for (const root of getSkillRoots({ projectPaths: normalizedProjectPaths })) {
    for (const skillPath of listSkillFilesInRoot(root.root)) {
      try {
        skills.push({
          ...parseSkillFile(skillPath),
          projectPath: root.projectPath,
          scope: root.scope,
          source: root.source
        })
      } catch {
        // Invalid local skill files should not break chat or settings.
      }
    }
  }

  return skills.toSorted((left, right) => {
    if (left.scope !== right.scope) {
      return left.scope === "project" ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  })
}

export const listSkillPromptTemplates = ({
  projectPaths = []
}: {
  projectPaths?: string[]
} = {}): PromptTemplate[] => {
  const roots = [
    ...new Set(
      listSkills({ projectPaths })
        .filter((skill) => skill.visible)
        .map((skill) =>
          path.join(path.dirname(skill.path), SKILL_PROMPT_TEMPLATE_DIR_NAME)
        )
    )
  ]

  return loadPromptTemplates(roots)
}

export const resolveSelectedSkillCapabilities = ({
  projectPath,
  selectedSkills
}: {
  projectPath: string
  selectedSkills: ChatSkillMention[]
}): string[] => {
  if (selectedSkills.length === 0) {
    return []
  }

  const skillsByPath = new Map(
    listSkills({
      projectPaths: [projectPath]
    }).map((skill) => [skill.path, skill])
  )
  const capabilities = new Set<string>()

  for (const selectedSkill of selectedSkills) {
    const skill = skillsByPath.get(selectedSkill.path)

    for (const capability of skill?.capabilities ?? []) {
      capabilities.add(capability)
    }
  }

  return [...capabilities]
}

export const resolveSelectedSkillExtensionPaths = ({
  projectPath,
  selectedSkills
}: {
  projectPath: string
  selectedSkills: ChatSkillMention[]
}): string[] => {
  if (selectedSkills.length === 0) {
    return []
  }

  const skillsByPath = new Map(
    listSkills({
      projectPaths: [projectPath]
    }).map((skill) => [skill.path, skill])
  )
  const extensionPaths = new Set<string>()

  for (const selectedSkill of selectedSkills) {
    const skill = skillsByPath.get(selectedSkill.path)

    if (!skill) {
      continue
    }

    for (const extensionPath of skill.extensions) {
      const resolvedPath = resolveSkillExtensionPath({
        extensionPath,
        skillPath: skill.path
      })

      if (resolvedPath) {
        extensionPaths.add(resolvedPath)
      }
    }
  }

  return [...extensionPaths]
}

const formatSkillForSystemPrompt = (skill: ParsedSkill): string =>
  [
    "<skill>",
    `<name>${escapeXml(skill.name)}</name>`,
    `<scope>${escapeXml(skill.scope)}</scope>`,
    formatSkillCapabilitiesForSystemPrompt(skill.capabilities),
    formatSkillCommandsForSystemPrompt(skill.commands),
    `<description>${escapeXml(skill.description)}</description>`,
    skill.shortDescription
      ? `<short_description>${escapeXml(skill.shortDescription)}</short_description>`
      : "",
    skill.projectPath
      ? `<project>${escapeXml(skill.projectPath)}</project>`
      : "",
    `<path>${escapeXml(skill.path)}</path>`,
    "<instructions>",
    escapeXml(skill.body),
    "</instructions>",
    "</skill>"
  ]
    .filter(Boolean)
    .join("\n")

const formatModelDisabledSkillReferenceForSystemPrompt = (
  skill: ParsedSkill
): string =>
  [
    "<skill_reference>",
    `<name>${escapeXml(skill.name)}</name>`,
    `<scope>${escapeXml(skill.scope)}</scope>`,
    formatSkillCapabilitiesForSystemPrompt(skill.capabilities),
    formatSkillCommandsForSystemPrompt(skill.commands),
    `<description>${escapeXml(skill.description)}</description>`,
    skill.shortDescription
      ? `<short_description>${escapeXml(skill.shortDescription)}</short_description>`
      : "",
    skill.projectPath
      ? `<project>${escapeXml(skill.projectPath)}</project>`
      : "",
    `<path>${escapeXml(skill.path)}</path>`,
    "<model_visible>false</model_visible>",
    "</skill_reference>"
  ]
    .filter(Boolean)
    .join("\n")

export const formatSkillsForSystemPrompt = (skills: ParsedSkill[]): string => {
  const modelVisibleSkills = skills.filter((skill) => skill.modelVisible)

  if (modelVisibleSkills.length === 0) {
    return ""
  }

  return [
    "<skills>",
    ...modelVisibleSkills.map(formatSkillForSystemPrompt),
    "</skills>"
  ].join("\n")
}

export const formatModelDisabledSkillReferencesForSystemPrompt = (
  skills: ParsedSkill[]
): string => {
  const modelDisabledSkills = skills.filter((skill) => !skill.modelVisible)

  if (modelDisabledSkills.length === 0) {
    return ""
  }

  return [
    "<skill_references>",
    ...modelDisabledSkills.map(
      formatModelDisabledSkillReferenceForSystemPrompt
    ),
    "</skill_references>"
  ].join("\n")
}

export const buildSkillsSystemPrompt = ({
  projectPath,
  query,
  selectedSkills = [],
  settings
}: {
  projectPath: string
  query: string
  selectedSkills?: ChatSkillMention[]
  settings: SkillsSettings
}): string => {
  if (!settings.enabled) {
    return ""
  }

  const queryTokens = tokenize(query)
  const skills = listSkills({
    projectPaths: [projectPath]
  }).filter((skill) => {
    if (skill.scope === "project") {
      return settings.includeProject
    }

    return settings.includeGlobal
  })
  const selectedSkillPaths = new Set(selectedSkills.map((skill) => skill.path))
  const selectedCandidates: SkillCandidate[] = skills
    .filter((skill) => selectedSkillPaths.has(skill.path))
    .map((skill) => ({
      score: Number.POSITIVE_INFINITY,
      skill
    }))
  const automaticCandidates: SkillCandidate[] = skills
    .filter((skill) => !selectedSkillPaths.has(skill.path))
    .map((skill) => ({
      score: scoreSkill(skill, queryTokens),
      skill
    }))
    .filter(({ score }) => queryTokens.size === 0 || score > 0)
    .toSorted((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      if (left.skill.scope !== right.skill.scope) {
        return left.skill.scope === "project" ? -1 : 1
      }

      return left.skill.name.localeCompare(right.skill.name)
    })
  const candidates = [
    ...selectedCandidates,
    ...automaticCandidates.slice(
      0,
      Math.max(0, settings.maxContextSkills - selectedCandidates.length)
    )
  ].slice(0, settings.maxContextSkills)

  if (candidates.length === 0) {
    return ""
  }

  const candidateSkills = candidates.map(({ skill }) => skill)
  const formattedSkills = formatSkillsForSystemPrompt(candidateSkills)
  const formattedSkillReferences =
    formatModelDisabledSkillReferencesForSystemPrompt(candidateSkills)

  if (!formattedSkills && !formattedSkillReferences) {
    return ""
  }

  const content = [
    "Triggered Etyon skills are provided below as XML.",
    formattedSkills,
    formattedSkillReferences,
    "Follow visible skill instructions when they are relevant to the current request. Model-disabled skill references only identify available skills; do not infer hidden instructions from them. Prefer direct user instructions if there is a conflict."
  ]
    .filter(Boolean)
    .join("\n\n")

  return truncateText(content, MAX_SKILL_PROMPT_CHARS)
}
