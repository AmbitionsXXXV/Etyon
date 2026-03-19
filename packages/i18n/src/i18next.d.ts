import "i18next"
import enUsTranslation from "./locales/en-US/translation.json" with { type: "json" }

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: {
      translation: typeof enUsTranslation
    }
    returnNull: false
  }
}
