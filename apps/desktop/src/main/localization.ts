import { createTranslator, resolveLocale } from "@etyon/i18n"
import type { Locale, TranslationKey, TranslationValues } from "@etyon/i18n"
import { app } from "electron"

import { getSettings } from "./settings"

export const getResolvedLocale = (): Locale =>
  resolveLocale(getSettings().locale, app.getLocale())

export const translate = (key: TranslationKey, values?: TranslationValues) =>
  createTranslator(getResolvedLocale()).t(key, values)
