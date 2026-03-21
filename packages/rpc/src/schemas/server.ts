import * as z from "zod/mini"

export const ServerUrlOutputSchema = z.object({
  url: z.string()
})

export type ServerUrlOutput = z.infer<typeof ServerUrlOutputSchema>
