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

/**
 * One local Chromium profile the embedded browser can import sign-ins from.
 * `browser` is a display label ("Chrome"), `id` is opaque to the renderer, and
 * `cookieCount` is `null` when the profile's cookie database could not be
 * counted — a profile stays listed even then, because the import may still work.
 */
export const BrowserCookieSourceSchema = z.object({
  browser: z.string(),
  cookieCount: z.number().int().nullable(),
  id: z.string(),
  profileDir: z.string(),
  profileName: z.string()
})

export const BrowserCookieSourcesOutputSchema = z.object({
  sources: z.array(BrowserCookieSourceSchema)
})

// `domainFilter` is a plain substring match on the source cookie's host; empty
// imports the whole profile.
export const BrowserImportCookiesInputSchema = z.object({
  domainFilter: z.string().optional(),
  sessionId: BrowserSessionIdSchema,
  sourceId: z.string().min(1)
})

// Counts only: decrypted cookie values never leave the main process.
export const BrowserImportCookiesOutputSchema = z.object({
  failed: z.number().int(),
  imported: z.number().int(),
  total: z.number().int()
})

/**
 * Import failures the dialog turns into its own copy. Carried as the `data`
 * payload of the RPC error, since the import output is counts only.
 */
export const BrowserCookieImportErrorReasonSchema = z.enum([
  "keychain-denied",
  "keychain-missing",
  "source-missing",
  "unsupported-platform"
])

export type BrowserState = z.infer<typeof BrowserStateSchema>
export type BrowserCookieImportErrorReason = z.infer<
  typeof BrowserCookieImportErrorReasonSchema
>
export type BrowserCookieSource = z.infer<typeof BrowserCookieSourceSchema>
export type BrowserCookieSourcesOutput = z.infer<
  typeof BrowserCookieSourcesOutputSchema
>
export type BrowserEnsureInput = z.infer<typeof BrowserEnsureInputSchema>
export type BrowserImportCookiesInput = z.infer<
  typeof BrowserImportCookiesInputSchema
>
export type BrowserImportCookiesOutput = z.infer<
  typeof BrowserImportCookiesOutputSchema
>
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
