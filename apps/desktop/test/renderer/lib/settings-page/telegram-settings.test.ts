import { describe, expect, it } from "vite-plus/test"

import {
  formatTelegramBotMention,
  normalizeTelegramSettingsDraft
} from "@/renderer/lib/settings-page/telegram-settings"

describe("telegram settings helpers", () => {
  it("normalizes legacy telegram drafts without botUsername", () => {
    expect(
      normalizeTelegramSettingsDraft({
        botToken: "123:abc",
        enabled: true
      })
    ).toEqual({
      allowedChatIds: "",
      allowedUserIds: "",
      botToken: "123:abc",
      botUsername: "",
      enabled: true,
      requireMentionInGroups: true
    })
  })

  it("formats empty and prefixed bot usernames safely", () => {
    expect(formatTelegramBotMention(null)).toBe("")
    expect(formatTelegramBotMention("")).toBe("")
    expect(formatTelegramBotMention("@etyon_bot")).toBe("@etyon_bot")
    expect(formatTelegramBotMention("etyon_bot")).toBe("@etyon_bot")
  })
})
