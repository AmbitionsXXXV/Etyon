import * as z from "zod"

const TERMINAL_MAX_DIMENSION = 1000
const TERMINAL_MIN_DIMENSION = 1

const TerminalColsSchema = z
  .number()
  .int()
  .min(TERMINAL_MIN_DIMENSION)
  .max(TERMINAL_MAX_DIMENSION)
const TerminalRowsSchema = z
  .number()
  .int()
  .min(TERMINAL_MIN_DIMENSION)
  .max(TERMINAL_MAX_DIMENSION)
const TerminalSessionIdSchema = z.string().min(1)

export const TerminalDisposeInputSchema = z.object({
  sessionId: TerminalSessionIdSchema
})

export const TerminalEnsureInputSchema = z.object({
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
  sessionId: TerminalSessionIdSchema
})

export const TerminalEnsureOutputSchema = z.object({
  snapshot: z.string()
})

export const TerminalMutationOutputSchema = z.object({
  ok: z.literal(true)
})

export const TerminalResizeInputSchema = z.object({
  cols: TerminalColsSchema,
  rows: TerminalRowsSchema,
  sessionId: TerminalSessionIdSchema
})

export type TerminalDisposeInput = z.infer<typeof TerminalDisposeInputSchema>
export type TerminalEnsureInput = z.infer<typeof TerminalEnsureInputSchema>
export type TerminalEnsureOutput = z.infer<typeof TerminalEnsureOutputSchema>
export type TerminalMutationOutput = z.infer<
  typeof TerminalMutationOutputSchema
>
export type TerminalResizeInput = z.infer<typeof TerminalResizeInputSchema>
