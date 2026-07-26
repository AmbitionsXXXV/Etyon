import type { TranslationKey } from "@etyon/i18n"
import { BrowserCookieImportErrorReasonSchema } from "@etyon/rpc"
import type { BrowserCookieImportErrorReason } from "@etyon/rpc"

/**
 * Turns a failed cookie-import call into dialog copy. The import output is
 * counts only, so the actionable reason travels as the `data` payload of the
 * RPC error; anything else (a transport failure, an unreadable profile) lands
 * on the generic message.
 */

const ERROR_MESSAGE_KEY: Record<
  BrowserCookieImportErrorReason,
  TranslationKey
> = {
  "keychain-denied": "chat.projectPanel.cookieImportErrorKeychainDenied",
  "keychain-missing": "chat.projectPanel.cookieImportErrorKeychainMissing",
  "source-missing": "chat.projectPanel.cookieImportErrorSourceMissing",
  "unsupported-platform":
    "chat.projectPanel.cookieImportErrorUnsupportedPlatform"
}

/** Reads the typed reason off an RPC error, or `null` when it carries none. */
export const resolveCookieImportErrorReason = (
  error: unknown
): BrowserCookieImportErrorReason | null => {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return null
  }

  const { data } = error as { data: unknown }

  if (typeof data !== "object" || data === null || !("reason" in data)) {
    return null
  }

  const parsed = BrowserCookieImportErrorReasonSchema.safeParse(
    (data as { reason: unknown }).reason
  )

  return parsed.success ? parsed.data : null
}

export const resolveCookieImportErrorMessageKey = (
  error: unknown
): TranslationKey => {
  const reason = resolveCookieImportErrorReason(error)

  return reason === null
    ? "chat.projectPanel.cookieImportErrorGeneric"
    : ERROR_MESSAGE_KEY[reason]
}
