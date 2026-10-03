import type { TranslationKey } from "@etyon/i18n"

const ERROR_KEYS: Record<string, TranslationKey> = {
  "accessibility-permission-required":
    "chat.screenAwareness.errors.accessibility-permission-required",
  "capture-limit": "chat.screenAwareness.errors.capture-limit",
  "capture-unavailable": "chat.screenAwareness.errors.capture-unavailable",
  "protected-surface": "chat.screenAwareness.errors.protected-surface",
  "routing-failed": "chat.screenAwareness.errors.routing-failed",
  "screen-permission-required":
    "chat.screenAwareness.errors.screen-permission-required",
  "screenshot-unavailable":
    "chat.screenAwareness.errors.screenshot-unavailable",
  "storage-failed": "chat.screenAwareness.errors.storage-failed",
  "text-truncated": "chat.screenAwareness.errors.text-truncated",
  "text-unavailable": "chat.screenAwareness.errors.text-unavailable",
  "window-unavailable": "chat.screenAwareness.errors.window-unavailable"
}

export const getScreenAwarenessErrorKey = (code: string): TranslationKey =>
  ERROR_KEYS[code] ?? "chat.screenAwareness.errors.capture-unavailable"
