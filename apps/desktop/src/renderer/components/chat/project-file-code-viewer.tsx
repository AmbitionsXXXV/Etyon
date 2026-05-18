import { useEffect, useMemo, useState } from "react"

import {
  PROJECT_FILE_EMPTY_LINE_CONTENT,
  SHIKI_HIGHLIGHT_CHAR_LIMIT,
  buildProjectFileHighlightedLines,
  getProjectFileTokenStyle,
  resolveProjectFileViewerLanguage,
  splitProjectFileCodeLines
} from "@/renderer/lib/chat/project-file-code-viewer"
import type { ProjectFileHighlightedToken } from "@/renderer/lib/chat/project-file-code-viewer"

interface ProjectFileCodeViewerProps {
  content: string
  language: null | string | undefined
  relativePath: string
}

const ProjectFileCodeLine = ({
  line,
  lineIndex
}: {
  line: ProjectFileHighlightedToken[] | string
  lineIndex: number
}) => {
  if (!Array.isArray(line)) {
    return line.length > 0 ? line : PROJECT_FILE_EMPTY_LINE_CONTENT
  }

  if (line.length === 0) {
    return PROJECT_FILE_EMPTY_LINE_CONTENT
  }

  return line.map((token, tokenIndex) => (
    <span
      className="text-[var(--shiki-light)] dark:text-[var(--shiki-dark)]"
      key={`${lineIndex}-${tokenIndex}-${token.content}`}
      style={getProjectFileTokenStyle(token)}
    >
      {token.content}
    </span>
  ))
}

export const ProjectFileCodeViewer = ({
  content,
  language,
  relativePath
}: ProjectFileCodeViewerProps) => {
  const [highlightedLines, setHighlightedLines] = useState<
    ProjectFileHighlightedToken[][] | null
  >(null)
  const resolvedLanguage = useMemo(
    () =>
      resolveProjectFileViewerLanguage({
        language,
        relativePath
      }),
    [language, relativePath]
  )
  const plainLines = useMemo(
    () => splitProjectFileCodeLines(content),
    [content]
  )

  useEffect(() => {
    let isDisposed = false

    setHighlightedLines(null)

    if (content.length > SHIKI_HIGHLIGHT_CHAR_LIMIT) {
      return () => {
        isDisposed = true
      }
    }

    const highlightContent = async (): Promise<void> => {
      try {
        const shikiLines = await buildProjectFileHighlightedLines({
          content,
          language: resolvedLanguage
        })

        if (isDisposed) {
          return
        }
        setHighlightedLines(shikiLines)
      } catch {
        if (!isDisposed) {
          setHighlightedLines(null)
        }
      }
    }

    void highlightContent()

    return () => {
      isDisposed = true
    }
  }, [content, resolvedLanguage])

  const lines: (ProjectFileHighlightedToken[] | string)[] =
    highlightedLines ?? plainLines

  return (
    <section
      aria-label={relativePath}
      className="h-full min-h-0 [scrollbar-gutter:stable] overflow-auto bg-card font-mono text-[12px] leading-6 text-foreground"
    >
      <div className="min-w-max py-2 whitespace-pre">
        {lines.map((line, lineIndex) => (
          <div
            className="grid min-h-6 grid-cols-[3.5rem_minmax(max-content,1fr)]"
            key={`${lineIndex}-${plainLines[lineIndex] ?? ""}`}
          >
            <span className="sticky left-0 z-10 border-r border-border/70 bg-card/95 pr-4 text-right text-muted-foreground/70 tabular-nums select-none">
              {lineIndex + 1}
            </span>
            <code className="min-w-0 px-4">
              <ProjectFileCodeLine line={line} lineIndex={lineIndex} />
            </code>
          </div>
        ))}
      </div>
    </section>
  )
}
