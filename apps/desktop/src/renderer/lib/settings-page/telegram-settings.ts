import type { TelegramSettings } from "@etyon/rpc"

export type TelegramSettingsDraft = Partial<TelegramSettings>

export const normalizeTelegramSettingsDraft = (
  telegram: TelegramSettingsDraft
): TelegramSettings => ({
  allowedChatIds: telegram.allowedChatIds ?? "",
  allowedUserIds: telegram.allowedUserIds ?? "",
  botToken: telegram.botToken ?? "",
  botUsername: telegram.botUsername ?? "",
  defaultModel: telegram.defaultModel ?? "",
  enabled: telegram.enabled ?? false,
  requireMentionInGroups: telegram.requireMentionInGroups ?? true
})

export const formatTelegramBotMention = (
  username: string | null | undefined
): string => {
  const normalizedUsername = (username ?? "").trim().replace(/^@/u, "")

  if (!normalizedUsername) {
    return ""
  }

  return `@${normalizedUsername}`
}
