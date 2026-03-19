import { createInstance } from "i18next"
import type { KeyPrefix } from "i18next"
import { useMemo } from "react"
import type { ReactNode } from "react"
import {
  I18nextProvider,
  initReactI18next,
  useTranslation
} from "react-i18next"

import {
  createI18nInitOptions,
  DEFAULT_LOCALE,
  DEFAULT_NAMESPACE,
  LocaleSchema
} from "./index.js"
import type { Locale, TranslationKey, TranslationValues } from "./index.js"

type UseI18nKey<Prefix extends string | undefined> = Prefix extends string
  ? string
  : TranslationKey

export interface UseI18nOptions<Prefix extends string | undefined = undefined> {
  keyPrefix?: Prefix
  locale?: Locale
}

const getResolvedLocale = (candidate?: null | string): Locale => {
  const locale = LocaleSchema.safeParse(candidate)

  return locale.success ? locale.data : DEFAULT_LOCALE
}

const createReactI18nInstance = (locale: Locale) => {
  const instance = createInstance()

  instance.use(initReactI18next).init({
    ...createI18nInitOptions(locale),
    react: {
      useSuspense: false
    }
  })

  return instance
}

export const I18nProvider = ({
  children,
  locale
}: {
  children: ReactNode
  locale: Locale
}) => {
  const value = useMemo(() => createReactI18nInstance(locale), [locale])

  return (
    <I18nextProvider defaultNS={DEFAULT_NAMESPACE} i18n={value}>
      {children}
    </I18nextProvider>
  )
}

export const useI18n = <Prefix extends string | undefined = undefined>(
  options?: UseI18nOptions<Prefix>
) => {
  const { i18n, ready } = useTranslation(DEFAULT_NAMESPACE, {
    useSuspense: false
  })
  const getFixedTranslator = i18n.getFixedT as unknown as (
    locale: Locale,
    namespace: typeof DEFAULT_NAMESPACE,
    keyPrefix?: KeyPrefix<typeof DEFAULT_NAMESPACE>
  ) => (key: string, values?: TranslationValues) => string
  const resolvedLocale = getResolvedLocale(
    options?.locale ?? i18n.resolvedLanguage ?? i18n.language
  )
  const translator = useMemo(
    () =>
      getFixedTranslator(
        resolvedLocale,
        DEFAULT_NAMESPACE,
        options?.keyPrefix as KeyPrefix<typeof DEFAULT_NAMESPACE>
      ) as (key: string, values?: TranslationValues) => string,
    [getFixedTranslator, resolvedLocale, options?.keyPrefix]
  )

  return {
    changeLanguage: (nextLocale: Locale) => i18n.changeLanguage(nextLocale),
    i18n,
    locale: resolvedLocale,
    ready,
    t: ((key: UseI18nKey<Prefix>, values?: TranslationValues) =>
      translator(key, values)) as (
      key: UseI18nKey<Prefix>,
      values?: TranslationValues
    ) => string
  }
}
