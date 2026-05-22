const ANT_THINKING_CLOSE_TAG = "</antThinking>"
const ANT_THINKING_OPEN_TAG = "<antThinking>"
const EXECUTED_IN_PREFIX = "Executed in "
const EXIT_CODE_PATTERN = /^-?\d+$/u
const SHELL_PATTERN = /^(?:bash|fish|sh|zsh)$/u

export interface AssistantCommandTextSegment {
  command: string
  cwd: string
  exitCode: number
  output: string
  repeatCount: number
  shell: string
  type: "executed-command"
}

export interface AssistantThinkingTextSegment {
  text: string
  type: "thinking"
}

export interface AssistantPlainTextSegment {
  text: string
  type: "text"
}

export type AssistantTextSegment =
  | AssistantCommandTextSegment
  | AssistantPlainTextSegment
  | AssistantThinkingTextSegment

interface ParsedCommandBlock {
  nextIndex: number
  segment: AssistantCommandTextSegment
}

const createTextSegment = (text: string): AssistantPlainTextSegment | null =>
  text.trim()
    ? {
        text: text.trim(),
        type: "text"
      }
    : null

export const createCommandSignature = ({
  command,
  cwd,
  exitCode,
  shell
}: Pick<
  AssistantCommandTextSegment,
  "command" | "cwd" | "exitCode" | "shell"
>): string => [cwd, shell, command, String(exitCode)].join("\u0000")

const parseExecutedCommandBlock = (
  lines: string[],
  startIndex: number
): ParsedCommandBlock | null => {
  const executedLine = lines[startIndex]

  if (!executedLine?.startsWith(EXECUTED_IN_PREFIX)) {
    return null
  }

  const shell = lines[startIndex + 1]?.trim()
  const command = lines[startIndex + 2]?.trim()

  if (!(shell && command && SHELL_PATTERN.test(shell))) {
    return null
  }

  for (let index = startIndex + 3; index < lines.length; index += 1) {
    const maybeExitCode = lines[index]?.trim()

    if (!(maybeExitCode && EXIT_CODE_PATTERN.test(maybeExitCode))) {
      continue
    }

    return {
      nextIndex: index + 1,
      segment: {
        command,
        cwd: executedLine.slice(EXECUTED_IN_PREFIX.length).trim(),
        exitCode: Number(maybeExitCode),
        output: lines
          .slice(startIndex + 3, index)
          .join("\n")
          .trimEnd(),
        repeatCount: 1,
        shell,
        type: "executed-command"
      }
    }
  }

  return null
}

const splitExecutedCommandSegments = (text: string): AssistantTextSegment[] => {
  const lines = text.split(/\r?\n/u)
  const segments: AssistantTextSegment[] = []
  let pendingLines: string[] = []

  for (let index = 0; index < lines.length; ) {
    const parsedCommand = parseExecutedCommandBlock(lines, index)

    if (!parsedCommand) {
      pendingLines.push(lines[index] ?? "")
      index += 1
      continue
    }

    const pendingText = createTextSegment(pendingLines.join("\n"))

    if (pendingText) {
      segments.push(pendingText)
    }

    segments.push(parsedCommand.segment)
    pendingLines = []
    index = parsedCommand.nextIndex
  }

  const pendingText = createTextSegment(pendingLines.join("\n"))

  if (pendingText) {
    segments.push(pendingText)
  }

  return segments
}

const splitThinkingSegments = (text: string): AssistantTextSegment[] => {
  const segments: AssistantTextSegment[] = []
  let cursor = 0

  while (cursor < text.length) {
    const openIndex = text.indexOf(ANT_THINKING_OPEN_TAG, cursor)

    if (openIndex === -1) {
      segments.push(...splitExecutedCommandSegments(text.slice(cursor)))
      break
    }

    segments.push(
      ...splitExecutedCommandSegments(text.slice(cursor, openIndex))
    )

    const contentStart = openIndex + ANT_THINKING_OPEN_TAG.length
    const closeIndex = text.indexOf(ANT_THINKING_CLOSE_TAG, contentStart)

    if (closeIndex === -1) {
      segments.push(...splitExecutedCommandSegments(text.slice(openIndex)))
      break
    }

    const thinkingText = text.slice(contentStart, closeIndex).trim()

    if (thinkingText) {
      segments.push({
        text: thinkingText,
        type: "thinking"
      })
    }

    cursor = closeIndex + ANT_THINKING_CLOSE_TAG.length
  }

  return segments
}

export const compactAssistantTextSegments = (
  segments: AssistantTextSegment[]
): AssistantTextSegment[] => {
  const compactedSegments: AssistantTextSegment[] = []
  const commandSegmentIndexes = new Map<string, number>()
  const textCounts = new Map<string, number>()

  for (const segment of segments) {
    if (segment.type !== "executed-command") {
      compactedSegments.push(segment)

      if (segment.type === "text") {
        const normalizedText = segment.text.trim()

        textCounts.set(
          normalizedText,
          (textCounts.get(normalizedText) ?? 0) + 1
        )
      }

      continue
    }

    const signature = createCommandSignature(segment)
    const existingIndex = commandSegmentIndexes.get(signature)

    if (existingIndex === undefined) {
      commandSegmentIndexes.set(signature, compactedSegments.length)
      compactedSegments.push(segment)
      continue
    }

    const existingSegment = compactedSegments[existingIndex]

    if (existingSegment?.type === "executed-command") {
      existingSegment.repeatCount += 1
    }

    const previousSegment = compactedSegments.at(-1)

    if (
      previousSegment?.type === "text" &&
      (textCounts.get(previousSegment.text.trim()) ?? 0) > 1
    ) {
      compactedSegments.pop()
    }
  }

  return compactedSegments
}

export const splitAssistantTextSegments = (
  text: string
): AssistantTextSegment[] =>
  compactAssistantTextSegments(splitThinkingSegments(text))

export const hasNonTextAssistantSegments = (
  segments: AssistantTextSegment[]
): boolean => segments.some((segment) => segment.type !== "text")
