import * as z from "zod/mini"

export const ServerUrlOutputSchema = z.object({
  token: z.string(),
  url: z.string()
})

export type ServerUrlOutput = z.infer<typeof ServerUrlOutputSchema>
