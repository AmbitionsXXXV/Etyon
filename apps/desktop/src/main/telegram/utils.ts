export const parseTelegramIdList = (value: string): Set<string> =>
  new Set(
    value
      .split(/[\s,;]+/u)
      .map((item) => item.trim().replace(/^(telegram:|tg:)/iu, ""))
      .filter(Boolean)
  )

const escapeRegex = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")

export const stripTelegramBotMention = (
  text: string,
  botUsername?: string
): string => {
  if (!botUsername) {
    return text.trim()
  }

  return text
    .replaceAll(new RegExp(`@${escapeRegex(botUsername)}\\b`, "giu"), "")
    .trim()
}
