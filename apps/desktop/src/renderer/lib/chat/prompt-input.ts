export interface ActiveMentionMatch {
  query: string
  startIndex: number
}

const MENTION_PREFIX_PATTERN = /(^|[\s.,:;!?()[\]{}])@([^\s@]*)$/u

export const getActiveMentionMatch = (
  text: string,
  caretIndex: number
): ActiveMentionMatch | null => {
  const textBeforeCaret = text.slice(0, caretIndex)
  const match = textBeforeCaret.match(MENTION_PREFIX_PATTERN)

  if (!match || match.index === undefined) {
    return null
  }

  return {
    query: match[2] ?? "",
    startIndex: match.index + match[1].length
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
