import * as z from "zod"

export const ThemeSchema = z.enum(["dark", "light", "system"])

export const AppSettingsSchema = z.object({
  fontFamily: z.string().default("System Default"),
  fontSize: z.number().min(12).max(24).default(16),
  theme: ThemeSchema.default("system")
})

export const UpdateSettingsSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().min(12).max(24).optional(),
  theme: ThemeSchema.optional()
})

export type Theme = z.infer<typeof ThemeSchema>
export type AppSettings = z.infer<typeof AppSettingsSchema>
