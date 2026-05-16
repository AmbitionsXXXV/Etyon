import fs from "node:fs"
import path from "node:path"

import type { ParsedSkill, SkillsSettings } from "@etyon/rpc"
import { app } from "electron"

import { getAppConfigDir } from "@/main/db/libsql-paths"

const FRONTMATTER_DELIMITER = "---"
const MAX_SKILL_BODY_CHARS = 6000
const MAX_SKILL_PROMPT_CHARS = 16_000
const SKILL_FILE_NAME = "SKILL.md"
const TOKEN_PATTERN = /[\p{L}\p{N}_-]+/gu

interface ParsedSkillFile {
  body: string
  description: string
  name: string
  path: string
  shortDescription: string | null
}

interface SkillCandidate {
  score: number
  skill: ParsedSkill
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

const parseSkillFrontmatter = (
  frontmatter: string
): {
  description?: string
  name?: string
  shortDescription?: string
} => {
  const result: {
    description?: string
    name?: string
    shortDescription?: string
  } = {}
  const lines = frontmatter.split("\n")

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trimEnd() ?? ""
    const parsedValue = parseFrontmatterValue(line)

    if (!parsedValue) {
      continue
    }

    const [key, value] = parsedValue

    if (key === "name") {
      result.name = value
    }

    if (key === "description") {
      result.description = value
    }

    if (key === "short-description") {
      result.shortDescription = value
    }

    if (key === "metadata") {
      for (
        let nestedIndex = index + 1;
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

          result.shortDescription = nestedDescription
        }
      }
    }
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
}[] => {
  const homeDir = app.getPath("home")
  const globalRoots = [
    path.join(homeDir, ".codex", "skills"),
    path.join(homeDir, ".agents", "skills"),
    path.join(getAppConfigDir(homeDir), "skills")
  ]
  const projectRoots = projectPaths.flatMap((projectPath) => [
    {
      projectPath,
      root: path.join(projectPath, ".agents", "skills"),
      scope: "project" as const
    },
    {
      projectPath,
      root: path.join(projectPath, ".codex", "skills"),
      scope: "project" as const
    }
  ])

  return [
    ...projectRoots,
    ...globalRoots.map((root) => ({
      projectPath: null,
      root,
      scope: "global" as const
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
    description,
    name,
    path: skillPath,
    shortDescription: frontmatter.shortDescription?.trim() || null
  }
}

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
          scope: root.scope
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

export const buildSkillsSystemPrompt = ({
  projectPath,
  query,
  settings
}: {
  projectPath: string
  query: string
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
  const candidates: SkillCandidate[] = skills
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
    .slice(0, settings.maxContextSkills)

  if (candidates.length === 0) {
    return ""
  }

  const content = [
    "Triggered Etyon skills:",
    ...candidates.map(({ skill }, index) =>
      [
        `[${index + 1}] ${skill.name} (${skill.scope})`,
        `Description: ${skill.description}`,
        skill.projectPath ? `Project: ${skill.projectPath}` : "",
        `Path: ${skill.path}`,
        "Instructions:",
        skill.body
      ]
        .filter(Boolean)
        .join("\n")
    ),
    "Follow these skill instructions when they are relevant to the current request. Prefer direct user instructions if there is a conflict."
  ].join("\n\n")

  return truncateText(content, MAX_SKILL_PROMPT_CHARS)
}
