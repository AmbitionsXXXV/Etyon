import type { CSSProperties } from "react"
import { codeToTokensWithThemes } from "shiki/bundle/web"
import type { BundledLanguage } from "shiki/bundle/web"

export interface ProjectFileHighlightedToken {
  content: string
  darkColor?: string
  fontStyle?: number
  lightColor?: string
}

const FILE_EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".cjs": "javascript",
  ".css": "css",
  ".cts": "typescript",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "jsx",
  ".markdown": "markdown",
  ".md": "markdown",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".py": "python",
  ".rs": "rust",
  ".sh": "shell",
  ".sql": "sql",
  ".svg": "svg",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".txt": "plaintext",
  ".vue": "vue",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml"
}
const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  javascriptreact: "jsx",
  plaintext: "plaintext",
  shell: "shell",
  typescriptreact: "tsx"
}
const SHIKI_DARK_THEME = "github-dark-default"
const SHIKI_FONT_STYLE_BOLD = 2
const SHIKI_FONT_STYLE_ITALIC = 1
const SHIKI_FONT_STYLE_UNDERLINE = 4
const SHIKI_LIGHT_THEME = "github-light-default"

export const PROJECT_FILE_EMPTY_LINE_CONTENT = "\u00A0"
export const SHIKI_HIGHLIGHT_CHAR_LIMIT = 200_000

const getFileExtension = (relativePath: string): string => {
  const fileName = relativePath.split("/").at(-1) ?? relativePath
  const extensionStartIndex = fileName.lastIndexOf(".")

  return extensionStartIndex > 0
    ? fileName.slice(extensionStartIndex).toLowerCase()
    : ""
}

const normalizeLanguage = (language: string): string => {
  const normalizedLanguage = language.trim().toLowerCase()

  return LANGUAGE_ALIAS_MAP[normalizedLanguage] ?? normalizedLanguage
}

export const resolveProjectFileViewerLanguage = ({
  language,
  relativePath
}: {
  language: null | string | undefined
  relativePath: string
}): string => {
  if (language) {
    return normalizeLanguage(language)
  }

  const extension = getFileExtension(relativePath)

  return FILE_EXTENSION_LANGUAGE_MAP[extension] ?? "plaintext"
}

export const splitProjectFileCodeLines = (content: string): string[] => {
  const lines = content.split("\n")

  return lines.length === 0 ? [""] : lines
}

const hasShikiFontStyle = (fontStyle: number, style: number): boolean =>
  Math.trunc(fontStyle / style) % 2 === 1

export const getProjectFileTokenStyle = (
  token: ProjectFileHighlightedToken
): CSSProperties => {
  const fontStyle = token.fontStyle ?? 0
  const isBold = hasShikiFontStyle(fontStyle, SHIKI_FONT_STYLE_BOLD)
  const isItalic = hasShikiFontStyle(fontStyle, SHIKI_FONT_STYLE_ITALIC)
  const isUnderlined = hasShikiFontStyle(fontStyle, SHIKI_FONT_STYLE_UNDERLINE)

  return {
    "--shiki-dark": token.darkColor ?? "currentColor",
    "--shiki-light": token.lightColor ?? "currentColor",
    fontStyle: isItalic ? "italic" : undefined,
    fontWeight: isBold ? 600 : undefined,
    textDecorationLine: isUnderlined ? "underline" : undefined
  } as CSSProperties
}

export const buildProjectFileHighlightedLines = async ({
  content,
  language
}: {
  content: string
  language: string
}): Promise<ProjectFileHighlightedToken[][]> => {
  const shikiLines = await codeToTokensWithThemes(content, {
    lang: language as BundledLanguage,
    themes: {
      dark: SHIKI_DARK_THEME,
      light: SHIKI_LIGHT_THEME
    }
  })

  return shikiLines.map((line) =>
    line.map((token) => ({
      content: token.content,
      darkColor: token.variants.dark?.color,
      fontStyle:
        token.variants.dark?.fontStyle ?? token.variants.light?.fontStyle,
      lightColor: token.variants.light?.color
    }))
  )
}
