import { LocalePreferenceSchema } from "@etyon/i18n"
import * as z from "zod"

export const ThemeSchema = z.enum(["dark", "light", "system"])

export const AppIconSchema = z.enum(["default", "alt"])

export const AppSettingsSchema = z.object({
  appIcon: AppIconSchema.default("default"),
  autoStart: z.boolean().default(false),
  fontFamily: z.string().default("System Default"),
  fontSize: z.number().min(12).max(24).default(16),
  locale: LocalePreferenceSchema.default("system"),
  theme: ThemeSchema.default("system")
})

export const UpdateSettingsSchema = z.object({
  appIcon: AppIconSchema.optional(),
  autoStart: z.boolean().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().min(12).max(24).optional(),
  locale: LocalePreferenceSchema.optional(),
  theme: ThemeSchema.optional()
})

export type AppIcon = z.infer<typeof AppIconSchema>
export type Theme = z.infer<typeof ThemeSchema>
export type AppSettings = z.infer<typeof AppSettingsSchema>
