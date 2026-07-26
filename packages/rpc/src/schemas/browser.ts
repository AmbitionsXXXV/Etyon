import * as z from "zod"

const BrowserSessionIdSchema = z.string().min(1)

const BrowserBoundsSchema = z.object({
  height: z.number().int(),
  width: z.number().int(),
  x: z.number().int(),
  y: z.number().int()
})

export const BrowserStateSchema = z.object({
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  faviconUrl: z.string().optional(),
  isLoading: z.boolean(),
  title: z.string(),
  url: z.string()
})

export const BrowserEnsureInputSchema = z.object({
  sessionId: BrowserSessionIdSchema,
  url: z.string().optional()
})

export const BrowserNavigateInputSchema = z.object({
  input: z.string(),
  sessionId: BrowserSessionIdSchema
})

export const BrowserSessionInputSchema = z.object({
  sessionId: BrowserSessionIdSchema
})

export const BrowserSetBoundsInputSchema = z.object({
  bounds: BrowserBoundsSchema,
  sessionId: BrowserSessionIdSchema
})

export const BrowserSetVisibleInputSchema = z.object({
  sessionId: BrowserSessionIdSchema,
  visible: z.boolean()
})

export const BrowserMutationOutputSchema = z.object({
  ok: z.literal(true)
})

export type BrowserState = z.infer<typeof BrowserStateSchema>
export type BrowserEnsureInput = z.infer<typeof BrowserEnsureInputSchema>
export type BrowserNavigateInput = z.infer<typeof BrowserNavigateInputSchema>
export type BrowserSessionInput = z.infer<typeof BrowserSessionInputSchema>
export type BrowserSetBoundsInput = z.infer<typeof BrowserSetBoundsInputSchema>
export type BrowserSetVisibleInput = z.infer<
  typeof BrowserSetVisibleInputSchema
>
export type BrowserMutationOutput = z.infer<typeof BrowserMutationOutputSchema>
