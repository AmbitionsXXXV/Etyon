import * as z from "zod"

export const UpdateBuildIdentifierSchema = z.enum(["development", "release"])

export const UpdateCheckErrorCodeSchema = z.enum([
  "http",
  "invalid-response",
  "network"
])

export const UpdateCheckReasonSchema = z.enum(["auto", "manual"])

export const UpdateStateSchema = z.enum([
  "available",
  "checking",
  "error",
  "idle",
  "up-to-date"
])

export const AvailableUpdateSchema = z.object({
  dmgSizeBytes: z.number().int().nonnegative().nullable(),
  dmgUrl: z.string().nullable(),
  htmlUrl: z.string(),
  notes: z.string().nullable(),
  publishedAt: z.string().nullable(),
  tagName: z.string(),
  version: z.string()
})

export const UpdateStatusSchema = z.object({
  available: AvailableUpdateSchema.nullable(),
  buildIdentifier: UpdateBuildIdentifierSchema,
  checkReason: UpdateCheckReasonSchema.nullable(),
  currentVersion: z.string(),
  errorCode: UpdateCheckErrorCodeSchema.nullable(),
  lastCheckedAt: z.number().nullable(),
  state: UpdateStateSchema
})

// The renderer never supplies a URL: the main process opens the one cached in
// the current status, so the procedures take no input and only report whether
// an allowed link was found.
export const OpenUpdateLinkOutputSchema = z.object({
  opened: z.boolean()
})

export type AvailableUpdate = z.infer<typeof AvailableUpdateSchema>
export type OpenUpdateLinkOutput = z.infer<typeof OpenUpdateLinkOutputSchema>
export type UpdateBuildIdentifier = z.infer<typeof UpdateBuildIdentifierSchema>
export type UpdateCheckErrorCode = z.infer<typeof UpdateCheckErrorCodeSchema>
export type UpdateCheckReason = z.infer<typeof UpdateCheckReasonSchema>
export type UpdateState = z.infer<typeof UpdateStateSchema>
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>
