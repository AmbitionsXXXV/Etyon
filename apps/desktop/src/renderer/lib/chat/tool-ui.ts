export const ANT_THINKING_CLOSE_TAG = "</antThinking>"
export const ANT_THINKING_OPEN_TAG = "<antThinking>"
const EXECUTED_IN_PREFIX = "Executed in "
const EXIT_CODE_PATTERN = /^-?\d+$/u
const FUNCTION_CALLS_CLOSE_TAG = "</function_calls>"
const FUNCTION_CALLS_OPEN_TAG = "<function_calls>"
const INVOKE_CLOSE_TAG = "</invoke>"
const DUPLICATE_INVOKE_CLOSE_PATTERN = /^\s*<\/invoke>/u
const INVOKE_PATTERN =
  /<invoke\s+name=(["'])([^"']+)\1\s*>([\s\S]*?)<\/invoke>/gu
const PARAMETER_PATTERN =
  /<parameter\s+name=(["'])([^"']+)\1\s*>([\s\S]*?)<\/parameter>/gu
const SHELL_PATTERN = /^(?:bash|fish|sh|zsh)$/u
const XML_ENTITY_PATTERN = /&(amp|lt|gt|quot|apos|#39);/gu

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

export interface AssistantFunctionCallParameter {
  name: string
  value: string
}

export interface AssistantFunctionCallTextSegment {
  name: string
  parameters: AssistantFunctionCallParameter[]
  type: "function-call"
}

export interface AssistantPlainTextSegment {
  text: string
  type: "text"
}

export type AssistantTextSegment =
  | AssistantCommandTextSegment
  | AssistantFunctionCallTextSegment
  | AssistantPlainTextSegment
  | AssistantThinkingTextSegment

export const shouldRenderAssistantToolPart = ({
  showToolTraces,
  state
}: {
  showToolTraces: boolean
  state: string
}): boolean => showToolTraces || state === "approval-requested"

interface ParsedCommandBlock {
  nextIndex: number
  segment: AssistantCommandTextSegment
}

interface ParsedFunctionCallBlock {
  nextIndex: number
  segments: AssistantFunctionCallTextSegment[]
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

const decodeXmlText = (text: string): string =>
  text.replace(XML_ENTITY_PATTERN, (_entity, name: string) => {
    switch (name) {
      case "amp": {
        return "&"
      }
      case "apos":
      case "#39": {
        return "'"
      }
      case "gt": {
        return ">"
      }
      case "lt": {
        return "<"
      }
      case "quot": {
        return '"'
      }
      default: {
        return _entity
      }
    }
  })

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

const parseFunctionCallParameters = (
  body: string
): AssistantFunctionCallParameter[] => {
  const parameters: AssistantFunctionCallParameter[] = []

  for (const match of body.matchAll(PARAMETER_PATTERN)) {
    const parameterName = match[2]?.trim()
    const parameterValue = match[3]?.trim()

    if (!(parameterName && parameterValue !== undefined)) {
      continue
    }

    parameters.push({
      name: decodeXmlText(parameterName),
      value: decodeXmlText(parameterValue)
    })
  }

  return parameters
}

const consumeDuplicateInvokeCloseTags = (
  text: string,
  startIndex: number
): number => {
  let nextIndex = startIndex
  let duplicateCloseMatch = text
    .slice(nextIndex)
    .match(DUPLICATE_INVOKE_CLOSE_PATTERN)

  while (duplicateCloseMatch?.[0]) {
    nextIndex += duplicateCloseMatch[0].length
    duplicateCloseMatch = text
      .slice(nextIndex)
      .match(DUPLICATE_INVOKE_CLOSE_PATTERN)
  }

  return nextIndex
}

const parseFunctionCallBlock = (
  text: string,
  startIndex: number
): ParsedFunctionCallBlock | null => {
  if (!text.startsWith(FUNCTION_CALLS_OPEN_TAG, startIndex)) {
    return null
  }

  const contentStart = startIndex + FUNCTION_CALLS_OPEN_TAG.length
  const closeIndex = text.indexOf(FUNCTION_CALLS_CLOSE_TAG, contentStart)
  const fallbackCloseIndex = text.indexOf(INVOKE_CLOSE_TAG, contentStart)

  if (closeIndex === -1 && fallbackCloseIndex === -1) {
    return null
  }

  const blockEnd =
    closeIndex === -1
      ? consumeDuplicateInvokeCloseTags(
          text,
          fallbackCloseIndex + INVOKE_CLOSE_TAG.length
        )
      : closeIndex + FUNCTION_CALLS_CLOSE_TAG.length
  const contentEnd = closeIndex === -1 ? blockEnd : closeIndex
  const blockContent = text.slice(contentStart, contentEnd)
  const segments: AssistantFunctionCallTextSegment[] = []

  for (const match of blockContent.matchAll(INVOKE_PATTERN)) {
    const invokeName = match[2]?.trim()
    const invokeBody = match[3] ?? ""

    if (!invokeName) {
      continue
    }

    segments.push({
      name: decodeXmlText(invokeName),
      parameters: parseFunctionCallParameters(invokeBody),
      type: "function-call"
    })
  }

  if (segments.length === 0) {
    return null
  }

  return {
    nextIndex: blockEnd,
    segments
  }
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

const splitToolTranscriptSegments = (text: string): AssistantTextSegment[] => {
  const segments: AssistantTextSegment[] = []
  let cursor = 0

  while (cursor < text.length) {
    const openIndex = text.indexOf(FUNCTION_CALLS_OPEN_TAG, cursor)

    if (openIndex === -1) {
      segments.push(...splitExecutedCommandSegments(text.slice(cursor)))
      break
    }

    segments.push(
      ...splitExecutedCommandSegments(text.slice(cursor, openIndex))
    )

    const parsedFunctionCall = parseFunctionCallBlock(text, openIndex)

    if (!parsedFunctionCall) {
      segments.push(...splitExecutedCommandSegments(text.slice(openIndex)))
      break
    }

    segments.push(...parsedFunctionCall.segments)
    cursor = parsedFunctionCall.nextIndex
  }

  return segments
}

const splitThinkingSegments = (text: string): AssistantTextSegment[] => {
  const segments: AssistantTextSegment[] = []
  let cursor = 0

  while (cursor < text.length) {
    const openIndex = text.indexOf(ANT_THINKING_OPEN_TAG, cursor)

    if (openIndex === -1) {
      segments.push(...splitToolTranscriptSegments(text.slice(cursor)))
      break
    }

    segments.push(...splitToolTranscriptSegments(text.slice(cursor, openIndex)))

    const contentStart = openIndex + ANT_THINKING_OPEN_TAG.length
    const closeIndex = text.indexOf(ANT_THINKING_CLOSE_TAG, contentStart)

    if (closeIndex === -1) {
      segments.push(...splitToolTranscriptSegments(text.slice(openIndex)))
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

export const splitAssistantRenderableTextSegments = ({
  showToolTraces,
  text
}: {
  showToolTraces: boolean
  text: string
}): AssistantTextSegment[] => {
  if (!text.trim()) {
    return []
  }

  const segments = splitAssistantTextSegments(text)

  if (showToolTraces) {
    return segments
  }

  if (!hasNonTextAssistantSegments(segments)) {
    return [
      {
        text,
        type: "text"
      }
    ]
  }

  return segments.filter((segment) => segment.type === "text")
}
