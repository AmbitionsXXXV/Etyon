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

/**
 * One element captured by the in-page picker. Every field is a raw, JSON-safe
 * value collected in the isolated world; sizes are already clamped there
 * (classes ≤ 5, innerText ≤ 300 chars, outerHtml ≤ 4000 chars).
 */
export const PickedWebElementSchema = z.object({
  classes: z.array(z.string()),
  id: z.string().nullable(),
  innerText: z.string(),
  outerHtml: z.string(),
  rect: BrowserBoundsSchema,
  selector: z.string(),
  styles: z.record(z.string(), z.string()),
  tagName: z.string(),
  title: z.string(),
  url: z.string()
})

// `null` covers every cancel route: Escape, a navigation, a torn-down view, the
// picker timeout, or a second pick superseding this one.
export const BrowserPickElementOutputSchema = z.object({
  element: PickedWebElementSchema.nullable()
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
export type PickedWebElement = z.infer<typeof PickedWebElementSchema>
export type BrowserPickElementOutput = z.infer<
  typeof BrowserPickElementOutputSchema
>
