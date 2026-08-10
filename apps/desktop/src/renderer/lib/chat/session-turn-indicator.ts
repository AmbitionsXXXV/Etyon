const SESSION_TURN_BASE_MARKER_SCALE = 3 / 13
const SESSION_TURN_MARKER_SCALES = [1, 10 / 13, 7 / 13, 5 / 13] as const
const SESSION_TURN_MIN_CONTENT_HEIGHT_RATIO = 1.5
const SESSION_TURN_PREVIEW_MAX_CHARACTERS = 180

export interface ChatSessionTurnSourceMessage {
  id: string
  role: string
  text: string
}

export interface ChatSessionTurn {
  id: string
  modelResponsePreview: string
  userInputPreview: string
  userMessageId: string
}

interface MutableChatSessionTurn {
  assistantTexts: string[]
  id: string
  userInputPreview: string
  userMessageId: string
}

const normalizePreview = (text: string): string =>
  text.replaceAll(/\s+/gu, " ").trim()

const truncatePreview = (text: string): string => {
  if (text.length <= SESSION_TURN_PREVIEW_MAX_CHARACTERS) {
    return text
  }

  return `${text.slice(0, SESSION_TURN_PREVIEW_MAX_CHARACTERS - 1).trimEnd()}…`
}

export const buildChatSessionTurns = (
  messages: readonly ChatSessionTurnSourceMessage[]
): ChatSessionTurn[] => {
  const mutableTurns: MutableChatSessionTurn[] = []
  let currentTurn: MutableChatSessionTurn | null = null

  for (const message of messages) {
    if (message.role === "user") {
      currentTurn = {
        assistantTexts: [],
        id: message.id,
        userInputPreview: truncatePreview(normalizePreview(message.text)),
        userMessageId: message.id
      }
      mutableTurns.push(currentTurn)
      continue
    }

    if (message.role !== "assistant" || currentTurn === null) {
      continue
    }

    const normalizedText = normalizePreview(message.text)

    if (normalizedText) {
      currentTurn.assistantTexts.push(normalizedText)
    }
  }

  return mutableTurns.map((turn) => ({
    id: turn.id,
    modelResponsePreview: truncatePreview(turn.assistantTexts.join(" ")),
    userInputPreview: turn.userInputPreview,
    userMessageId: turn.userMessageId
  }))
}

export const getCurrentSessionTurnIndex = (
  turnTops: readonly number[],
  readingLine: number
): number | null => {
  if (turnTops.length === 0) {
    return null
  }

  let currentIndex = 0

  for (const [index, turnTop] of turnTops.entries()) {
    if (turnTop > readingLine) {
      break
    }

    currentIndex = index
  }

  return currentIndex
}

export const getSessionTurnMarkerScale = (
  markerIndex: number,
  emphasizedMarkerIndex: number | null
): number => {
  if (emphasizedMarkerIndex === null) {
    return SESSION_TURN_BASE_MARKER_SCALE
  }

  const distance = Math.abs(markerIndex - emphasizedMarkerIndex)

  return SESSION_TURN_MARKER_SCALES[distance] ?? SESSION_TURN_BASE_MARKER_SCALE
}

export const shouldShowSessionTurnIndicator = (
  scrollHeight: number,
  clientHeight: number
): boolean =>
  clientHeight > 0 &&
  scrollHeight >= clientHeight * SESSION_TURN_MIN_CONTENT_HEIGHT_RATIO
