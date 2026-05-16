import type { TelegramTestConnectionOutput } from "@etyon/rpc"

import { getTelegramBot, toTelegramErrorMessage } from "@/main/telegram/client"

export const testTelegramConnection = async (
  botToken: string
): Promise<TelegramTestConnectionOutput> => {
  try {
    return {
      bot: await getTelegramBot(botToken),
      ok: true
    }
  } catch (error) {
    return {
      error: toTelegramErrorMessage(error),
      ok: false
    }
  }
}
