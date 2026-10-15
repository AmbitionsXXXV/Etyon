import * as z from "zod"

// Auto-compact advice for the user's own coding agents, replayed from their
// session files (magpie's "Tuned for you"), and the setting it can write.
export const TunedAgentSchema = z.enum(["claude-code", "codex"])

export const AgentCompactSettingSchema = z.object({
  /** True when Etyon wrote the value now in place, so Undo can restore. */
  isOurs: z.boolean(),
  /** The variable that overrides the setting, so it cannot be written. */
  lockedBy: z.string().nullable(),
  source: z.enum(["env", "model", "settings"]).nullable(),
  value: z.number().nullable()
})

export const AgentCompactAdviceSchema = z.object({
  after: z.number(),
  best: z.number(),
  calls: z.number(),
  compactsBest: z.number(),
  compactsNow: z.number(),
  current: z.number(),
  growth: z.number(),
  /** Share of weighted tokens the advised window saves; 0 when unchanged. */
  saving: z.number(),
  streams: z.number(),
  window: z.number()
})

export const AgentTuningRowSchema = z.object({
  advice: AgentCompactAdviceSchema.nullable(),
  agent: TunedAgentSchema,
  calls: z.number(),
  /** Where the setting lives, e.g. "~/.claude/settings.json". */
  file: z.string(),
  model: z.string(),
  setting: AgentCompactSettingSchema
})

export const AgentTuningInputSchema = z.object({
  days: z.number().int().min(1).max(30).default(7)
})

export const AgentTuningOutputSchema = z.object({
  generatedAt: z.string(),
  rows: z.array(AgentTuningRowSchema)
})

export const ApplyAgentTuningInputSchema = z.object({
  agent: TunedAgentSchema,
  model: z.string().min(1),
  value: z.number().int().positive()
})

export const UndoAgentTuningInputSchema = z.object({
  agent: TunedAgentSchema,
  model: z.string().min(1)
})

export type AgentTuningRow = z.infer<typeof AgentTuningRowSchema>
export type AgentCompactAdvice = z.infer<typeof AgentCompactAdviceSchema>
export type AgentCompactSetting = z.infer<typeof AgentCompactSettingSchema>
export type TunedAgent = z.infer<typeof TunedAgentSchema>
