import { ORPCError } from "@orpc/server"

import { runWithChatSessionMutation } from "@/main/server/routes/chat-session-execution"

export const withRpcSessionMutation = async <T>(
  sessionId: string,
  execute: () => Promise<T>
): Promise<T> => {
  const result = await runWithChatSessionMutation(sessionId, execute)
  if (!result.acquired) {
    throw new ORPCError("CONFLICT", {
      message:
        "Wait for the current chat run to settle before changing its workspace."
    })
  }
  return result.value
}
