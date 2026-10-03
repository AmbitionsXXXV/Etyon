import { z } from "zod"

export const WebToolsSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  encryptedApiKey: z.string().max(32768).optional(),
  searchApiKey: z
    .string()
    .trim()
    .max(8192)
    .regex(/^[^\r\n\0]*$/u)
    .default(""),
  searchProvider: z.enum(["brave", "tavily"]).default("brave")
})

export type WebToolsSettings = z.infer<typeof WebToolsSettingsSchema>
export const WebFetchInputSchema = z.object({ url: z.url().max(8192) })
export const WebFetchOutputSchema = z.object({
  text: z.string(),
  title: z.string(),
  truncated: z.boolean(),
  url: z.string()
})
export const WebSearchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(600)
    .refine(
      (query) => query.split(/\s+/u).length <= 75,
      "Search queries must contain at most 75 words"
    )
})
export const WebSearchOutputSchema = z.object({
  provider: z.enum(["brave", "tavily"]),
  results: z.array(
    z.object({
      snippet: z.string(),
      title: z.string(),
      url: z.string()
    })
  )
})
