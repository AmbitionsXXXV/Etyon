import { LocalePreferenceSchema } from "@etyon/i18n"
import * as z from "zod"

import { MemorySettingsSchema } from "./memory"
import {
  BuiltInProviderIdSchema,
  MoonshotRegionSchema,
  StoredProviderModelSchema
} from "./providers"
import { SkillsSettingsSchema } from "./skills"

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
  "brutalism-dark",
  "chadracula-evondev",
  "default",
  "glass-dark",
  "mouve-dark",
  "poimandres",
  "tokyo-night"
])

export const ThemeSchema = z.enum(["dark", "light", "system"])

export const AppIconSchema = z.enum(["default", "alt"])

export const LightColorSchemaSchema = z.enum([
  "brutalism-light",
  "default",
  "glass-light",
  "mouve-light",
  "one-light",
  "paper"
])

export const SidebarModeSchema = z.enum(["projects", "simple"])

export const SidebarSettingsSchema = z.object({
  mode: SidebarModeSchema.default("simple")
})

export const AiProviderNameSchema = BuiltInProviderIdSchema

const EMPTY_PROVIDER_MODELS: z.infer<typeof StoredProviderModelSchema>[] = []

export const AiProviderConfigSchema = z.object({
  apiKey: z.string().default(""),
  availableModels: z
    .array(StoredProviderModelSchema)
    .default(EMPTY_PROVIDER_MODELS),
  baseURL: z.string().default(""),
  enabled: z.boolean().default(true),
  models: z.array(StoredProviderModelSchema).default(EMPTY_PROVIDER_MODELS),
  region: MoonshotRegionSchema.optional()
})

const ANTHROPIC_PROVIDER_CONFIG_DEFAULT = {
  apiKey: "",
  availableModels: EMPTY_PROVIDER_MODELS,
  baseURL: "",
  enabled: true,
  models: EMPTY_PROVIDER_MODELS
}

const GATEWAY_PROVIDER_CONFIG_DEFAULT = {
  apiKey: "",
  availableModels: EMPTY_PROVIDER_MODELS,
  baseURL: "",
  enabled: true,
  models: EMPTY_PROVIDER_MODELS
}

const MOONSHOT_PROVIDER_CONFIG_DEFAULT = {
  apiKey: "",
  availableModels: EMPTY_PROVIDER_MODELS,
  baseURL: "https://api.moonshot.cn/v1",
  enabled: false,
  models: EMPTY_PROVIDER_MODELS,
  region: "china" as const
}

const OPENAI_PROVIDER_CONFIG_DEFAULT = {
  apiKey: "",
  availableModels: EMPTY_PROVIDER_MODELS,
  baseURL: "",
  enabled: true,
  models: EMPTY_PROVIDER_MODELS
}

const ZAI_CODING_PLAN_PROVIDER_CONFIG_DEFAULT = {
  apiKey: "",
  availableModels: EMPTY_PROVIDER_MODELS,
  baseURL: "https://api.z.ai/api/coding/paas/v4",
  enabled: false,
  models: EMPTY_PROVIDER_MODELS
}

export const AiSettingsSchema = z.object({
  defaultModel: z.string().default(""),
  defaultProvider: AiProviderNameSchema.default("openai"),
  providers: z
    .object({
      anthropic: AiProviderConfigSchema.default(
        ANTHROPIC_PROVIDER_CONFIG_DEFAULT
      ),
      gateway: AiProviderConfigSchema.default(GATEWAY_PROVIDER_CONFIG_DEFAULT),
      moonshot: AiProviderConfigSchema.default(
        MOONSHOT_PROVIDER_CONFIG_DEFAULT
      ),
      openai: AiProviderConfigSchema.default(OPENAI_PROVIDER_CONFIG_DEFAULT),
      "zai-coding-plan": AiProviderConfigSchema.default(
        ZAI_CODING_PLAN_PROVIDER_CONFIG_DEFAULT
      )
    })
    .default({
      anthropic: ANTHROPIC_PROVIDER_CONFIG_DEFAULT,
      gateway: GATEWAY_PROVIDER_CONFIG_DEFAULT,
      moonshot: MOONSHOT_PROVIDER_CONFIG_DEFAULT,
      openai: OPENAI_PROVIDER_CONFIG_DEFAULT,
      "zai-coding-plan": ZAI_CODING_PLAN_PROVIDER_CONFIG_DEFAULT
    })
})

export const ProxyTypeSchema = z.enum(["http", "https", "socks5"])

const PROXY_SETTINGS_DEFAULT = {
  enabled: false,
  host: "",
  password: "",
  port: 8080,
  type: "http" as const,
  username: ""
} as const

const SIDEBAR_SETTINGS_DEFAULT = {
  mode: "simple" as const
} as const

export const ProxySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  host: z.string().default(""),
  password: z.string().default(""),
  port: z.number().default(8080),
  type: ProxyTypeSchema.default("http"),
  username: z.string().default("")
})

const TELEGRAM_SETTINGS_DEFAULT = {
  allowedChatIds: "",
  allowedUserIds: "",
  botToken: "",
  botUsername: "",
  defaultModel: "",
  enabled: false,
  requireMentionInGroups: true
} as const

const MEMORY_SETTINGS_DEFAULT = {
  enabled: true,
  includeChatbot: true,
  maxContextEntries: 8,
  shareAcrossProjects: true
} as const

const SKILLS_SETTINGS_DEFAULT = {
  enabled: true,
  includeGlobal: true,
  includeProject: true,
  maxContextSkills: 4
} as const

export const TelegramSettingsSchema = z.object({
  allowedChatIds: z.string().default(""),
  allowedUserIds: z.string().default(""),
  botToken: z.string().default(""),
  botUsername: z.string().default(""),
  defaultModel: z.string().default(""),
  enabled: z.boolean().default(false),
  requireMentionInGroups: z.boolean().default(true)
})

export const AppSettingsSchema = z.object({
  ai: AiSettingsSchema.default({
    defaultModel: "",
    defaultProvider: "openai",
    providers: {
      anthropic: ANTHROPIC_PROVIDER_CONFIG_DEFAULT,
      gateway: GATEWAY_PROVIDER_CONFIG_DEFAULT,
      moonshot: MOONSHOT_PROVIDER_CONFIG_DEFAULT,
      openai: OPENAI_PROVIDER_CONFIG_DEFAULT,
      "zai-coding-plan": ZAI_CODING_PLAN_PROVIDER_CONFIG_DEFAULT
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
  memory: MemorySettingsSchema.default(MEMORY_SETTINGS_DEFAULT),
  minimizeToTray: z.boolean().default(false),
  proxy: ProxySettingsSchema.default(PROXY_SETTINGS_DEFAULT),
  sidebar: SidebarSettingsSchema.default(SIDEBAR_SETTINGS_DEFAULT),
  skills: SkillsSettingsSchema.default(SKILLS_SETTINGS_DEFAULT),
  startMinimizedToTray: z.boolean().default(false),
  telegram: TelegramSettingsSchema.default(TELEGRAM_SETTINGS_DEFAULT),
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
  memory: MemorySettingsSchema.optional(),
  minimizeToTray: z.boolean().optional(),
  proxy: ProxySettingsSchema.optional(),
  sidebar: SidebarSettingsSchema.optional(),
  skills: SkillsSettingsSchema.optional(),
  startMinimizedToTray: z.boolean().optional(),
  telegram: TelegramSettingsSchema.optional(),
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
export type MemorySettings = z.infer<typeof MemorySettingsSchema>
export type ProxySettings = z.infer<typeof ProxySettingsSchema>
export type ProxyType = z.infer<typeof ProxyTypeSchema>
export type SidebarMode = z.infer<typeof SidebarModeSchema>
export type SidebarSettings = z.infer<typeof SidebarSettingsSchema>
export type SkillsSettings = z.infer<typeof SkillsSettingsSchema>
export type TelegramSettings = z.infer<typeof TelegramSettingsSchema>
export type Theme = z.infer<typeof ThemeSchema>
