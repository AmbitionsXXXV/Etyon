import { createInstance } from "i18next"
import type { InitOptions, i18n as I18nInstance } from "i18next"
import { z } from "zod"

import enUsTranslation from "./locales/en-US/translation.json" with { type: "json" }
import jaJpTranslation from "./locales/ja-JP/translation.json" with { type: "json" }
import type { NestedTranslationKey, TranslationTree } from "./locales/types.js"
import zhCnTranslation from "./locales/zh-CN/translation.json" with { type: "json" }

export const SUPPORTED_LOCALES = ["en-US", "ja-JP", "zh-CN"] as const

export const DEFAULT_LOCALE = "en-US"
export const DEFAULT_NAMESPACE = "translation"

export const LocaleSchema = z.enum(SUPPORTED_LOCALES)

export const LocalePreferenceSchema = z.enum([
  "system",
  ...SUPPORTED_LOCALES
] as const)

export type Locale = z.infer<typeof LocaleSchema>
export type LocalePreference = z.infer<typeof LocalePreferenceSchema>
export type TranslationKey = NestedTranslationKey<typeof enUsTranslation>
export type TranslationValues = Record<string, number | string>

export interface Translator {
  locale: Locale
  t: (key: TranslationKey, values?: TranslationValues) => string
}

export type CliLocaleParseResult =
  | {
      args: string[]
      locale: Locale
      status: "ok"
    }
  | {
      args: string[]
      invalidLocale: string
      locale: Locale
      status: "error"
      type: "invalid-locale" | "missing-locale-value"
    }

export const TRANSLATION_RESOURCES = {
  "en-US": {
    [DEFAULT_NAMESPACE]: enUsTranslation
  },
  "ja-JP": {
    [DEFAULT_NAMESPACE]: jaJpTranslation
  },
  "zh-CN": {
    [DEFAULT_NAMESPACE]: zhCnTranslation
  }
} as const satisfies Record<
  Locale,
  Record<typeof DEFAULT_NAMESPACE, TranslationTree>
>

const EXACT_LOCALE_MAP = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale.toLowerCase(), locale])
) as Record<string, Locale>

const normalizeLocaleCandidate = (
  candidate?: null | string
): Locale | undefined => {
  if (!candidate) {
    return undefined
  }

  const sanitizedCandidate = candidate
    .trim()
    .split(".")[0]
    .split("@")[0]
    .replaceAll("_", "-")

  if (!sanitizedCandidate) {
    return undefined
  }

  const exactMatch = EXACT_LOCALE_MAP[sanitizedCandidate.toLowerCase()]
  if (exactMatch) {
    return exactMatch
  }

  const [languageCode] = sanitizedCandidate.toLowerCase().split("-")

  if (languageCode === "en") {
    return "en-US"
  }

  if (languageCode === "ja") {
    return "ja-JP"
  }

  if (languageCode === "zh") {
    return "zh-CN"
  }

  return undefined
}

export const resolveLocale = (
  preference?: LocalePreference | null,
  systemLocale?: null | string
): Locale => {
  if (preference && preference !== "system") {
    return preference
  }

  return normalizeLocaleCandidate(systemLocale) ?? DEFAULT_LOCALE
}

export const createI18nInitOptions = (locale: Locale): InitOptions => ({
  defaultNS: DEFAULT_NAMESPACE,
  fallbackLng: DEFAULT_LOCALE,
  initAsync: false,
  interpolation: {
    escapeValue: false
  },
  lng: locale,
  ns: [DEFAULT_NAMESPACE],
  resources: TRANSLATION_RESOURCES,
  returnNull: false,
  supportedLngs: [...SUPPORTED_LOCALES]
})

export const createI18nInstance = (locale: Locale): I18nInstance => {
  const instance = createInstance()

  instance.init(createI18nInitOptions(locale))

  return instance
}

export const createTranslator = (locale: Locale): Translator => {
  const fixedTranslator = createI18nInstance(locale).getFixedT(
    locale,
    DEFAULT_NAMESPACE
  )

  return {
    locale,
    t: (key, values) => fixedTranslator(key, values)
  }
}

export const parseCliLocale = (
  args: string[],
  systemLocale?: null | string
): CliLocaleParseResult => {
  const nextArgs: string[] = []
  const fallbackLocale = resolveLocale(undefined, systemLocale)
  let resolvedLocale = fallbackLocale

  for (let index = 0; index < args.length; index += 1) {
    const currentArg = args[index]

    if (currentArg === "--lang" || currentArg === "-l") {
      const nextArg = args[index + 1]

      if (!nextArg || nextArg.startsWith("-")) {
        return {
          args: nextArgs,
          invalidLocale: "",
          locale: fallbackLocale,
          status: "error",
          type: "missing-locale-value"
        }
      }

      const locale = LocaleSchema.safeParse(nextArg)
      if (!locale.success) {
        return {
          args: nextArgs,
          invalidLocale: nextArg,
          locale: fallbackLocale,
          status: "error",
          type: "invalid-locale"
        }
      }

      resolvedLocale = locale.data
      index += 1
      continue
    }

    if (currentArg.startsWith("--lang=")) {
      const explicitLocale = currentArg.slice("--lang=".length)
      const locale = LocaleSchema.safeParse(explicitLocale)

      if (!locale.success) {
        return {
          args: nextArgs,
          invalidLocale: explicitLocale,
          locale: fallbackLocale,
          status: "error",
          type: "invalid-locale"
        }
      }

      resolvedLocale = locale.data
      continue
    }

    nextArgs.push(currentArg)
  }

  return {
    args: nextArgs,
    locale: resolvedLocale,
    status: "ok"
  }
}
