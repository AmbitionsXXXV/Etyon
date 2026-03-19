import { CustomThemePresetSchema, CustomThemeTypeSchema } from "@etyon/rpc"
import type { CustomTheme } from "@etyon/rpc"
import { z } from "zod"

import { HEX_COLOR_REGEX } from "../constants/defaults"

export const normalizeHexDraft = (value: string) => {
  const sanitizedValue = value.toLowerCase().replaceAll(/[^#0-9a-f]/g, "")
  const withoutHashes = sanitizedValue.replaceAll("#", "")

  if (withoutHashes.length === 0) {
    return "#"
  }

  return `#${withoutHashes.slice(0, 6)}`
}

export const normalizeThemeName = (value: string) => value.trim().toLowerCase()

export const buildCustomThemeFormSchema = (themes: CustomTheme[]) => {
  const existingNames = new Set(
    themes.map((theme) => normalizeThemeName(theme.name))
  )

  return z.object({
    accent: z.string().regex(HEX_COLOR_REGEX, "Use a valid hex color."),
    background: z.string().regex(HEX_COLOR_REGEX, "Use a valid hex color."),
    name: z
      .string()
      .refine((value) => value.trim().length > 0, "Display name is required.")
      .refine(
        (value) => !existingNames.has(normalizeThemeName(value)),
        "A theme with this name already exists."
      ),
    preset: CustomThemePresetSchema,
    secondary: z.string().regex(HEX_COLOR_REGEX, "Use a valid hex color."),
    text: z.string().regex(HEX_COLOR_REGEX, "Use a valid hex color."),
    type: CustomThemeTypeSchema
  })
}

export const toFieldErrors = (errors: unknown[]) => {
  const nextErrors: { message: string }[] = []

  for (const error of errors) {
    if (typeof error === "string") {
      nextErrors.push({ message: error })
      continue
    }

    if (error && typeof error === "object" && "message" in error) {
      const { message } = error

      if (typeof message === "string") {
        nextErrors.push({ message })
      }
    }
  }

  return nextErrors
}
