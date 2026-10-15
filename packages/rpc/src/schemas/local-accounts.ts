import * as z from "zod"

// Subscriptions signed in through the user's own coding agents (Claude Code,
// Codex). Etyon reads their logins in place — nothing is copied — and never
// hands a token to the renderer.
export const LocalAccountIdSchema = z.enum(["claude-code", "codex"])

export const LocalAccountStatusSchema = z.enum([
  "not-installed",
  "signed-in",
  "signed-out",
  "unavailable"
])

export const LocalAccountSchema = z.object({
  email: z.string().nullable(),
  id: LocalAccountIdSchema,
  organization: z.string().nullable(),
  plan: z.string().nullable(),
  /** Where the login was read from, shown so the user knows what is read. */
  source: z.string(),
  status: LocalAccountStatusSchema,
  /** When the paid subscription runs out, when the vendor says (Codex). */
  subscriptionUntil: z.string().nullable()
})

export const LocalAccountUsageWindowSchema = z.object({
  /** Free text the vendor gave for the reset, e.g. "Oct 16 at 2:10am (Asia/Tokyo)". */
  resetsText: z.string().nullable(),
  /** ISO time of the reset, when the vendor gave a timestamp. */
  resetsAt: z.string().nullable(),
  /** A model family the window is limited to, e.g. "Fable"; null for all models. */
  scope: z.string().nullable(),
  spanSeconds: z.number().int().positive().nullable(),
  usedPercent: z.number().min(0)
})

export const LocalAccountUsageSchema = z.object({
  credits: z.string().nullable(),
  error: z.string().nullable(),
  fetchedAt: z.string(),
  id: LocalAccountIdSchema,
  windows: z.array(LocalAccountUsageWindowSchema)
})

export const ListLocalAccountsOutputSchema = z.object({
  accounts: z.array(LocalAccountSchema),
  discovery: z.boolean()
})

export const LocalAccountUsageInputSchema = z.object({
  id: LocalAccountIdSchema
})

export type LocalAccount = z.infer<typeof LocalAccountSchema>
export type LocalAccountId = z.infer<typeof LocalAccountIdSchema>
export type LocalAccountUsage = z.infer<typeof LocalAccountUsageSchema>
export type LocalAccountUsageWindow = z.infer<
  typeof LocalAccountUsageWindowSchema
>
