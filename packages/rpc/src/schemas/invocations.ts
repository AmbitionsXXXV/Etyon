import { z } from "zod"

export const ListInvocationsInputSchema = z.object({
  sessionId: z.string().min(1)
})
export const ListInvocationsOutputSchema = z.object({
  invocations: z.array(
    z.object({
      createdAt: z.string(),
      error: z.string().nullable(),
      id: z.string(),
      state: z.enum(["executing", "failed", "succeeded", "unknown"]),
      summaryJson: z.string(),
      toolName: z.string(),
      updatedAt: z.string()
    })
  )
})
export const ResolveInvocationInputSchema = z.object({
  completed: z.boolean(),
  id: z.string().min(1),
  sessionId: z.string().min(1)
})
