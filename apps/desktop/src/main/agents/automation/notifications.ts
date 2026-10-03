import { createTranslator, resolveLocale } from "@etyon/i18n"
import type { AppSettings } from "@etyon/rpc"
import type {
  AutomationRun,
  AutomationTask
} from "@etyon/rpc/schemas/automation"
import { app, Notification } from "electron"

import { createProxyAwareFetch } from "@/main/proxy/proxy-fetch"
import { getSettings } from "@/main/settings"
import { parseTelegramIdList } from "@/main/telegram/utils"

interface AutomationNotifierOptions {
  fetchTelegram?: typeof fetch
  openSession: (sessionId: string) => void
  settings?: () => AppSettings
  showDesktop?: (title: string, body: string, onClick: () => void) => void
}

const showDesktopNotification = (
  title: string,
  body: string,
  onClick: () => void
): void => {
  if (!Notification.isSupported()) {
    throw new Error("Desktop notifications are unavailable.")
  }
  const notification = new Notification({ body, title })
  notification.on("click", onClick)
  notification.show()
}

export const createAutomationNotifier =
  ({
    fetchTelegram,
    openSession,
    settings = getSettings,
    showDesktop = showDesktopNotification
  }: AutomationNotifierOptions) =>
  async (task: AutomationTask, run: AutomationRun): Promise<void> => {
    const config = settings()
    const { t } = createTranslator(
      resolveLocale(config.locale, app.getLocale())
    )
    const title = `${task.name} · ${t(`settings.automation.status.${run.status}`)}`
    const body =
      run.status === "suspended"
        ? t("settings.automation.approvalNotice")
        : t("settings.automation.resultNotice")
    const errors: string[] = []
    if (task.notifyDesktop) {
      try {
        showDesktop(title, body, () => openSession(task.sessionId))
      } catch {
        errors.push("Desktop notification failed.")
      }
    }
    if (task.notifyTelegram) {
      const recipients = [
        ...parseTelegramIdList(config.telegram.allowedChatIds)
      ].filter((id) => /^-?\d+$/u.test(id))
      if (
        !config.telegram.enabled ||
        !config.telegram.botToken.trim() ||
        recipients.length === 0
      ) {
        errors.push(
          "Enable Telegram and configure allowed chat IDs before sending notifications."
        )
      } else {
        const telegramFetch =
          fetchTelegram ?? createProxyAwareFetch(config.proxy)
        for (const chatId of recipients) {
          try {
            const response = await telegramFetch(
              `https://api.telegram.org/bot${config.telegram.botToken.trim()}/sendMessage`,
              {
                body: JSON.stringify({
                  chat_id: chatId,
                  text: `${title}\n${body}\n${t("settings.automation.session")}: ${task.sessionId}`
                }),
                headers: { "content-type": "application/json" },
                method: "POST",
                signal: AbortSignal.timeout(10_000)
              }
            )
            const payload: unknown = await response.json()
            if (
              !response.ok ||
              typeof payload !== "object" ||
              payload === null ||
              !("ok" in payload) ||
              payload.ok !== true
            ) {
              errors.push("Telegram notification failed.")
            }
          } catch {
            // Never persist request URLs: Telegram embeds the bot token in them.
            errors.push("Telegram notification failed.")
          }
        }
      }
    }
    if (errors.length > 0) {
      throw new Error([...new Set(errors)].join(" "))
    }
  }
