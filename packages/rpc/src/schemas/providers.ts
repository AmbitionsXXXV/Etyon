import * as z from "zod"

export const BuiltInProviderIdSchema = z.enum([
  "anthropic",
  "gateway",
  "moonshot",
  "openai",
  "zai-coding-plan"
])

export const MoonshotRegionSchema = z.enum(["china", "international"])

export const StoredProviderModelCapabilitiesSchema = z.object({
  contextWindow: z.number().optional(),
  functionCalling: z.boolean().optional(),
  imageOutput: z.boolean().optional(),
  jsonMode: z.boolean().optional(),
  maxOutputTokens: z.number().optional(),
  reasoning: z.boolean().optional(),
  streaming: z.boolean().optional(),
  vision: z.boolean().optional()
})

export const StoredProviderModelSchema = z.object({
  capabilities: StoredProviderModelCapabilitiesSchema.optional(),
  id: z.string(),
  isManual: z.boolean().optional(),
  name: z.string()
})

export const ProviderFetchModelsInputSchema = z.object({
  provider: z.object({
    apiKey: z.string(),
    baseURL: z.string(),
    providerId: BuiltInProviderIdSchema,
    region: MoonshotRegionSchema.optional()
  })
})

export const ProviderFetchModelsOutputSchema = z.object({
  models: z.array(StoredProviderModelSchema)
})

export type BuiltInProviderId = z.infer<typeof BuiltInProviderIdSchema>
export type MoonshotRegion = z.infer<typeof MoonshotRegionSchema>
export type ProviderFetchModelsInput = z.infer<
  typeof ProviderFetchModelsInputSchema
>
export type ProviderFetchModelsOutput = z.infer<
  typeof ProviderFetchModelsOutputSchema
>
export type StoredProviderModel = z.infer<typeof StoredProviderModelSchema>
export type StoredProviderModelCapabilities = z.infer<
  typeof StoredProviderModelCapabilitiesSchema
>
