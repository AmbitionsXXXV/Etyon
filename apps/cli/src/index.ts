#!/usr/bin/env node

import { createTranslator, parseCliLocale } from "@etyon/i18n"

const APP_VERSION = "1.0.0"

const systemLocale =
  process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG

const parsedLocale = parseCliLocale(process.argv.slice(2), systemLocale)
const { t } = createTranslator(parsedLocale.locale)

if (parsedLocale.status === "error") {
  const message =
    parsedLocale.type === "missing-locale-value"
      ? t("cli.error.missingLocaleValue")
      : t("cli.error.invalidLocale", { locale: parsedLocale.invalidLocale })

  console.error(message)
  process.exitCode = 1
} else {
  const [command] = parsedLocale.args

  switch (command) {
    case "version":
    case "-v":
    case "--version": {
      console.log(t("cli.version", { version: APP_VERSION }))
      break
    }
    case "help":
    case "-h":
    case "--help": {
      console.log(t("cli.help.usage"))
      console.log("")
      console.log(t("cli.help.commands"))
      console.log(t("cli.help.version"))
      console.log(t("cli.help.help"))
      break
    }
    default: {
      if (command) {
        console.error(t("cli.error.unknownCommand", { command }))
        process.exitCode = 1
      } else {
        console.log(t("cli.status.empty"))
      }
    }
  }
}
