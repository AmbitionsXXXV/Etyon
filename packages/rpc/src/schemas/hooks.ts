import * as z from "zod"

export const HookEventSchema = z.enum(["PreToolUse", "PostToolUse", "Stop"])

export const HookDefinitionSchema = z
  .object({
    command: z.string().min(1).max(8192),
    event: HookEventSchema,
    matcher: z.string().max(200).default(".*"),
    timeoutMs: z.number().int().min(10).max(120_000).default(10_000)
  })
  .strict()

export const HooksConfigSchema = z
  .object({
    hooks: z.array(HookDefinitionSchema).max(32)
  })
  .strict()

export const HookConfigStatusSchema = z.object({
  error: z.string().optional(),
  hooks: z.array(HookDefinitionSchema),
  path: z.string(),
  scope: z.enum(["global", "project"])
})

export const ListHooksInputSchema = z.object({
  sessionId: z.string().min(1).optional()
})
export const ListHooksOutputSchema = z.object({
  configs: z.array(HookConfigStatusSchema)
})

export type HookEvent = z.infer<typeof HookEventSchema>
export type HookDefinition = z.infer<typeof HookDefinitionSchema>
export type HookConfigStatus = z.infer<typeof HookConfigStatusSchema>
