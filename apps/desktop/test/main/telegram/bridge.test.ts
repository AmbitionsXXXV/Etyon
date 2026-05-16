import { describe, expect, it } from "vite-plus/test"

import {
  parseTelegramIdList,
  stripTelegramBotMention
} from "@/main/telegram/utils"

describe("telegram bridge helpers", () => {
  it("parses comma, whitespace, and prefixed id allowlists", () => {
    expect([
      ...parseTelegramIdList("telegram:123, tg:456\n-100789 123")
    ]).toEqual(["123", "456", "-100789"])
  })

  it("removes bot mentions without changing the rest of the prompt", () => {
    expect(
      stripTelegramBotMention("@etyon_bot status please", "etyon_bot")
    ).toBe("status please")
  })
})
