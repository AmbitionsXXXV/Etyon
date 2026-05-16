export const parseTelegramIdList = (value: string): Set<string> =>
  new Set(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim().replace(/^(telegram:|tg:)/i, ""))
      .filter(Boolean)
  )

const escapeRegex = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const stripTelegramBotMention = (
  text: string,
  botUsername?: string
): string => {
  if (!botUsername) {
    return text.trim()
  }

  return text
    .replaceAll(new RegExp(`@${escapeRegex(botUsername)}\\b`, "gi"), "")
    .trim()
}
