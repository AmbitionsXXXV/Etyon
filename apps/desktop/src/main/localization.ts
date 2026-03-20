import { createI18nInstance, resolveLocale } from "@etyon/i18n"
import type { Locale, TranslationKey, TranslationValues } from "@etyon/i18n"
import { app } from "electron"

import { getSettings } from "./settings"

let mainI18n: ReturnType<typeof createI18nInstance> | null = null
let mainI18nLocale: Locale | null = null

export const getResolvedLocale = (): Locale =>
  resolveLocale(getSettings().locale, app.getLocale())

export const getMainI18n = () => {
  const locale = getResolvedLocale()

  if (!mainI18n || mainI18nLocale !== locale) {
    mainI18n = createI18nInstance(locale)
    mainI18nLocale = locale
  }

  return mainI18n
}

export const t = (key: TranslationKey, values?: TranslationValues) =>
  getMainI18n().t(key, values)

export const translate = t
