import fs from "node:fs"
import path from "node:path"

const FRONTMATTER_DELIMITER = "---"
const FRONTMATTER_LINE_PATTERN = /\r?\n/u
const POSITIONAL_PARAMETER_PATTERN = /\$(\$|ARGUMENTS|\d+)/gu
const XML_ESCAPE_PATTERN = /[&<>"']/gu
const XML_ESCAPES: Record<string, string> = {
  '"': "&quot;",
  "&": "&amp;",
  "'": "&apos;",
  "<": "&lt;",
  ">": "&gt;"
}

export interface PromptTemplate {
  body: string
  description: string | null
  name: string
  path: string
}

interface ParsedPromptTemplateFrontmatter {
  description?: string
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

const parsePromptTemplateFrontmatter = (
  frontmatter: string
): ParsedPromptTemplateFrontmatter => {
  const result: ParsedPromptTemplateFrontmatter = {}

  for (const line of frontmatter.split(FRONTMATTER_LINE_PATTERN)) {
    const parsedValue = parseFrontmatterValue(line)

    if (!parsedValue) {
      continue
    }

    const [key, value] = parsedValue

    if (key === "description") {
      result.description = value
    }

    if (key === "name") {
      result.name = value
    }
  }

  return result
}

const splitPromptTemplateMarkdown = (
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

const isPromptTemplateFile = (entry: fs.Dirent): boolean =>
  (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")

const listPromptTemplateFilesInRoot = (root: string): string[] => {
  if (!fs.existsSync(root)) {
    return []
  }

  return fs
    .readdirSync(root, {
      withFileTypes: true
    })
    .filter(isPromptTemplateFile)
    .map((entry) => path.join(root, entry.name))
}

const getPromptTemplateFallbackName = (templatePath: string): string =>
  path.basename(templatePath, path.extname(templatePath))

const parsePromptTemplateFile = (templatePath: string): PromptTemplate => {
  const content = fs.readFileSync(templatePath, "utf-8")
  const parsedMarkdown = splitPromptTemplateMarkdown(content)
  const frontmatter = parsedMarkdown
    ? parsePromptTemplateFrontmatter(parsedMarkdown.frontmatter)
    : {}

  return {
    body: parsedMarkdown ? parsedMarkdown.body : content.trim(),
    description: frontmatter.description?.trim() || null,
    name:
      frontmatter.name?.trim() || getPromptTemplateFallbackName(templatePath),
    path: templatePath
  }
}

const replacePositionalParameters = (
  content: string,
  args: readonly string[]
): string =>
  content.replaceAll(POSITIONAL_PARAMETER_PATTERN, (_match, value: string) => {
    if (value === "$") {
      return "$"
    }

    if (value === "ARGUMENTS") {
      return args.join(" ")
    }

    const argIndex = Number(value) - 1

    return args[argIndex] ?? ""
  })

const getXmlEscape = (value: string): string => XML_ESCAPES[value] ?? value

const escapeXml = (value: string): string =>
  value.replaceAll(XML_ESCAPE_PATTERN, getXmlEscape)

export const parseCommandArgs = (text: string): string[] => {
  const args: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaping = false

  for (const char of text) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === "\\") {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }

      current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/u.test(char)) {
      if (current.length > 0) {
        args.push(current)
        current = ""
      }

      continue
    }

    current += char
  }

  if (quote) {
    throw new Error("Unterminated quoted argument.")
  }

  if (escaping) {
    current += "\\"
  }

  if (current.length > 0) {
    args.push(current)
  }

  return args
}

export const loadPromptTemplates = (
  roots: readonly string[]
): PromptTemplate[] =>
  roots
    .flatMap(listPromptTemplateFilesInRoot)
    .map(parsePromptTemplateFile)
    .toSorted((left, right) => left.name.localeCompare(right.name))

export const formatPromptTemplateInvocation = (
  template: PromptTemplate,
  args: readonly string[]
): string => {
  const content = replacePositionalParameters(template.body, args)
  const description = template.description
    ? `<description>${escapeXml(template.description)}</description>`
    : ""

  return [
    "<prompt_template>",
    `<name>${escapeXml(template.name)}</name>`,
    description,
    `<path>${escapeXml(template.path)}</path>`,
    "<content>",
    escapeXml(content),
    "</content>",
    "</prompt_template>"
  ]
    .filter(Boolean)
    .join("\n")
}
