import { LocalePreferenceSchema } from "@etyon/i18n"
import * as z from "zod"

export const CustomThemeTypeSchema = z.enum(["dark", "light"])

export const CustomThemePresetSchema = z.enum([
  "custom",
  "forest",
  "monokai",
  "nord",
  "ocean",
  "sunset"
])

export const CustomThemeColorsSchema = z.object({
  accent: z.string(),
  background: z.string(),
  secondary: z.string(),
  text: z.string()
})

export const CustomThemeSchema = z.object({
  colors: CustomThemeColorsSchema,
  createdAt: z.string(),
  id: z.string(),
  name: z.string(),
  preset: CustomThemePresetSchema,
  type: CustomThemeTypeSchema,
  updatedAt: z.string()
})

export const DarkColorSchemaSchema = z.enum([
  "aquarium",
  "chadracula-evondev",
  "default",
  "poimandres",
  "tokyo-night"
])

export const ThemeSchema = z.enum(["dark", "light", "system"])

export const AppIconSchema = z.enum(["default", "alt"])

export const LightColorSchemaSchema = z.enum(["default", "one-light", "paper"])

export const AppSettingsSchema = z.object({
  appIcon: AppIconSchema.default("default"),
  autoStart: z.boolean().default(false),
  closeToTray: z.boolean().default(false),
  customThemes: z.array(CustomThemeSchema).default([]),
  darkColorSchema: DarkColorSchemaSchema.default("default"),
  fontFamily: z.string().default("System Default"),
  fontSize: z.number().min(12).max(24).default(16),
  lightColorSchema: LightColorSchemaSchema.default("default"),
  locale: LocalePreferenceSchema.default("system"),
  minimizeToTray: z.boolean().default(false),
  startMinimizedToTray: z.boolean().default(false),
  theme: ThemeSchema.default("system")
})

export const UpdateSettingsSchema = z.object({
  appIcon: AppIconSchema.optional(),
  autoStart: z.boolean().optional(),
  closeToTray: z.boolean().optional(),
  customThemes: z.array(CustomThemeSchema).optional(),
  darkColorSchema: DarkColorSchemaSchema.optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().min(12).max(24).optional(),
  lightColorSchema: LightColorSchemaSchema.optional(),
  locale: LocalePreferenceSchema.optional(),
  minimizeToTray: z.boolean().optional(),
  startMinimizedToTray: z.boolean().optional(),
  theme: ThemeSchema.optional()
})

export type AppIcon = z.infer<typeof AppIconSchema>
export type Theme = z.infer<typeof ThemeSchema>
export type AppSettings = z.infer<typeof AppSettingsSchema>
export type CustomTheme = z.infer<typeof CustomThemeSchema>
export type CustomThemePreset = z.infer<typeof CustomThemePresetSchema>
export type CustomThemeType = z.infer<typeof CustomThemeTypeSchema>
export type DarkColorSchema = z.infer<typeof DarkColorSchemaSchema>
export type LightColorSchema = z.infer<typeof LightColorSchemaSchema>
