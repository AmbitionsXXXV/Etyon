import type { StartBestOfNInputSchema } from "@etyon/rpc/schemas/worktrees"
import type { UIMessage, UIMessageStreamWriter } from "ai"
import type { z } from "zod"

import { runPersistedInvocation } from "@/main/agents/invocation-ledger"
import type { AgentLoopOutcome } from "@/main/agents/minimal/agent-loop"
import { createRuntimeBestOfNService } from "@/main/agents/worktree-runtime"
import { getDb } from "@/main/db"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

export const executeBestOfNStream = async ({
  abortSignal,
  modelId,
  parentProfile,
  parentRunId,
  permissionMode,
  projectPath,
  request,
  userMessageId,
  writer
}: {
  abortSignal: AbortSignal
  modelId: string | null
  parentProfile: ResolvedAgentProfile
  parentRunId: string | null
  permissionMode: AgentPermissionMode
  projectPath: string
  request: z.infer<typeof StartBestOfNInputSchema>
  userMessageId: string
  writer: UIMessageStreamWriter<UIMessage>
}): Promise<AgentLoopOutcome> => {
  if (!parentRunId) {
    throw new Error(
      "Best-of-N requires a persisted parent run. Retry after the run store is available."
    )
  }
  const toolCallId = `best-of-n:${userMessageId}`
  writer.write({
    messageId: `best-of-n-result:${userMessageId}`,
    type: "start"
  })
  writer.write({ type: "start-step" })
  writer.write({
    input: { models: request.models, prompt: request.prompt },
    toolCallId,
    toolName: "best_of_n",
    type: "tool-input-available"
  })
  const service = createRuntimeBestOfNService({
    modelId,
    parentProfile,
    parentRunId,
    parentToolCallId: toolCallId,
    permissionMode,
    projectPath,
    sessionId: request.sessionId,
    writer
  })
  const run = await runPersistedInvocation({
    db: getDb(),
    effectScope: projectPath,
    execute: async () =>
      await service.start({
        ...request,
        projectPath,
        runId: parentRunId,
        signal: abortSignal
      }),
    input: request,
    runId: parentRunId,
    sessionId: request.sessionId,
    toolCallId,
    toolName: "best_of_n"
  })
  writer.write({ output: run, toolCallId, type: "tool-output-available" })
  writer.write({ type: "finish-step" })
  writer.write({ finishReason: "stop", type: "finish" })
  return {
    errorMessage:
      run.state === "failed" ? "No candidate completed successfully" : null,
    exitReason:
      abortSignal.aborted || run.state === "cancelled"
        ? "aborted"
        : run.state === "failed"
          ? "model-error"
          : "completed",
    finishReason: "stop",
    nudged: false,
    stepCount: 1
  }
}
