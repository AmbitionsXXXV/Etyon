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

export const AiProviderNameSchema = z.enum(["anthropic", "gateway", "openai"])

export const AiProviderConfigSchema = z.object({
  apiKey: z.string().default("")
})

const AI_PROVIDER_CONFIG_DEFAULT = { apiKey: "" } as const

export const AiSettingsSchema = z.object({
  defaultModel: z.string().default(""),
  defaultProvider: AiProviderNameSchema.default("openai"),
  providers: z
    .object({
      anthropic: AiProviderConfigSchema.default(AI_PROVIDER_CONFIG_DEFAULT),
      gateway: AiProviderConfigSchema.default(AI_PROVIDER_CONFIG_DEFAULT),
      openai: AiProviderConfigSchema.default(AI_PROVIDER_CONFIG_DEFAULT)
    })
    .default({
      anthropic: AI_PROVIDER_CONFIG_DEFAULT,
      gateway: AI_PROVIDER_CONFIG_DEFAULT,
      openai: AI_PROVIDER_CONFIG_DEFAULT
    })
})

export const AppSettingsSchema = z.object({
  ai: AiSettingsSchema.default({
    defaultModel: "",
    defaultProvider: "openai",
    providers: {
      anthropic: AI_PROVIDER_CONFIG_DEFAULT,
      gateway: AI_PROVIDER_CONFIG_DEFAULT,
      openai: AI_PROVIDER_CONFIG_DEFAULT
    }
  }),
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
  ai: AiSettingsSchema.optional(),
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

export type AiProviderConfig = z.infer<typeof AiProviderConfigSchema>
export type AiProviderName = z.infer<typeof AiProviderNameSchema>
export type AiSettings = z.infer<typeof AiSettingsSchema>
export type AppIcon = z.infer<typeof AppIconSchema>
export type AppSettings = z.infer<typeof AppSettingsSchema>
export type CustomTheme = z.infer<typeof CustomThemeSchema>
export type CustomThemePreset = z.infer<typeof CustomThemePresetSchema>
export type CustomThemeType = z.infer<typeof CustomThemeTypeSchema>
export type DarkColorSchema = z.infer<typeof DarkColorSchemaSchema>
export type LightColorSchema = z.infer<typeof LightColorSchemaSchema>
export type Theme = z.infer<typeof ThemeSchema>
