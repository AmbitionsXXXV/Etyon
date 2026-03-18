import * as z from "zod"

export const PingInputSchema = z.object({
  message: z.string()
})

export const PingOutputSchema = z.object({
  echo: z.string(),
  pid: z.number(),
  timestamp: z.string()
})
