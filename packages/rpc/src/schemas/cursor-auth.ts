import * as z from "zod"

import { StoredProviderModelSchema } from "./providers"

export const CursorAuthLoginStatusSchema = z.enum(["authenticated", "pending"])

export const CursorAuthPollLoginInputSchema = z.object({
  requestId: z.string()
})

export const CursorAuthPollLoginOutputSchema = z.object({
  authenticated: z.boolean(),
  expiresAt: z.string().nullable(),
  status: CursorAuthLoginStatusSchema
})

export const CursorAuthStartLoginOutputSchema = z.object({
  loginUrl: z.string().url(),
  requestId: z.string()
})

export const CursorAuthStatusOutputSchema = z.object({
  authenticated: z.boolean(),
  expiresAt: z.string().nullable(),
  hasRefreshToken: z.boolean(),
  storageEncryptionAvailable: z.boolean()
})

export const CursorModelsOutputSchema = z.object({
  models: z.array(StoredProviderModelSchema)
})

export type CursorAuthLoginStatus = z.infer<typeof CursorAuthLoginStatusSchema>
export type CursorAuthPollLoginInput = z.infer<
  typeof CursorAuthPollLoginInputSchema
>
export type CursorAuthPollLoginOutput = z.infer<
  typeof CursorAuthPollLoginOutputSchema
>
export type CursorAuthStartLoginOutput = z.infer<
  typeof CursorAuthStartLoginOutputSchema
>
export type CursorAuthStatusOutput = z.infer<
  typeof CursorAuthStatusOutputSchema
>
export type CursorModelsOutput = z.infer<typeof CursorModelsOutputSchema>
