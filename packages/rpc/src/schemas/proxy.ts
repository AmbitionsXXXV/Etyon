import * as z from "zod"

import { ProxySettingsSchema } from "./settings"

export const TestProxyInputSchema = z.object({
  proxy: ProxySettingsSchema,
  timeoutMs: z.number().default(10_000),
  url: z.string().default("https://api.openai.com")
})

export const TestProxyOutputSchema = z.object({
  countryCode: z.string().optional(),
  countryFlag: z.string().optional(),
  error: z.string().optional(),
  ip: z.string().optional(),
  latencyMs: z.number(),
  ok: z.boolean(),
  status: z.number().optional()
})

export type TestProxyInput = z.infer<typeof TestProxyInputSchema>
export type TestProxyOutput = z.infer<typeof TestProxyOutputSchema>
