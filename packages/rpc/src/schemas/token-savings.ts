import * as z from "zod"

export const RtkTokenSavingsSummarySchema = z.object({
  averageSavingsPercent: z.number(),
  averageTimeMs: z.number().int().nonnegative(),
  totalCommands: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalSavedTokens: z.number().int().nonnegative(),
  totalTimeMs: z.number().int().nonnegative()
})

export const RtkTokenSavingsDailyEntrySchema = z.object({
  averageTimeMs: z.number().int().nonnegative(),
  commands: z.number().int().nonnegative(),
  date: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  savedTokens: z.number().int().nonnegative(),
  savingsPercent: z.number(),
  totalTimeMs: z.number().int().nonnegative()
})

export const RtkTokenSavingsCommandEntrySchema = z.object({
  averageReductionPercent: z.number(),
  averageTimeMs: z.number().int().nonnegative(),
  command: z.string(),
  count: z.number().int().nonnegative(),
  impact: z.string(),
  savedTokens: z.number().int().nonnegative()
})

export const RtkTokenSavingsRecentCommandSchema = z.object({
  command: z.string(),
  reductionPercent: z.number(),
  savedTokens: z.number().int().nonnegative(),
  timestampLabel: z.string()
})

export const RtkTokenSavingsRuntimeSchema = z.object({
  ripgrepSource: z.enum(["bundled", "missing", "system"]),
  rtkAvailable: z.boolean(),
  rtkVersion: z.string().optional()
})

export const RtkTokenSavingsOutputSchema = z.object({
  available: z.boolean(),
  commands: z.array(RtkTokenSavingsCommandEntrySchema),
  daily: z.array(RtkTokenSavingsDailyEntrySchema),
  error: z.string().nullable(),
  generatedAt: z.string(),
  recentCommands: z.array(RtkTokenSavingsRecentCommandSchema),
  runtime: RtkTokenSavingsRuntimeSchema,
  scope: z.enum(["global", "project"]),
  summary: RtkTokenSavingsSummarySchema
})

export type RtkTokenSavingsCommandEntry = z.infer<
  typeof RtkTokenSavingsCommandEntrySchema
>
export type RtkTokenSavingsDailyEntry = z.infer<
  typeof RtkTokenSavingsDailyEntrySchema
>
export type RtkTokenSavingsOutput = z.infer<typeof RtkTokenSavingsOutputSchema>
export type RtkTokenSavingsRecentCommand = z.infer<
  typeof RtkTokenSavingsRecentCommandSchema
>
export type RtkTokenSavingsRuntime = z.infer<
  typeof RtkTokenSavingsRuntimeSchema
>
export type RtkTokenSavingsSummary = z.infer<
  typeof RtkTokenSavingsSummarySchema
>
