import {
  AgentTuningInputSchema,
  AgentTuningOutputSchema,
  ApplyAgentTuningInputSchema,
  UndoAgentTuningInputSchema
} from "@etyon/rpc/schemas/agent-tuning"
import { ChatCompactAdviceSchema } from "@etyon/rpc/schemas/settings"
import * as z from "zod"

import {
  applyAgentTuning,
  getAgentTuning,
  undoAgentTuning
} from "@/main/agent-tuning/service"
import { getChatCompactAdvice } from "@/main/chat-compact-advice"
import { rpc } from "@/main/rpc/context"

export const agentTuningRouter = {
  chatAdvice: rpc
    .output(ChatCompactAdviceSchema.nullable())
    .handler(async ({ context }) => await getChatCompactAdvice(context.db)),
  apply: rpc
    .input(ApplyAgentTuningInputSchema)
    .output(z.object({ ok: z.boolean() }))
    .handler(async ({ input }) => {
      await applyAgentTuning(input)
      return { ok: true }
    }),
  get: rpc
    .input(AgentTuningInputSchema)
    .output(AgentTuningOutputSchema)
    .handler(async ({ input }) => ({
      generatedAt: new Date().toISOString(),
      rows: await getAgentTuning(input.days)
    })),
  undo: rpc
    .input(UndoAgentTuningInputSchema)
    .output(z.object({ ok: z.boolean() }))
    .handler(async ({ input }) => {
      await undoAgentTuning(input)
      return { ok: true }
    })
}
