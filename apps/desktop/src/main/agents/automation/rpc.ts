import { ChatSessionMessagesInputSchema } from "@etyon/rpc"
import {
  AutomationListOutputSchema,
  AutomationListRunsInputSchema,
  AutomationMutationOutputSchema,
  AutomationRunInputSchema,
  AutomationRunSchema,
  AutomationRunsOutputSchema,
  AutomationSetEnabledInputSchema,
  AutomationTaskDraftSchema,
  AutomationTaskInputSchema,
  AutomationTaskSchema
} from "@etyon/rpc/schemas/automation"

import {
  getAutomationManager,
  openAutomationSession
} from "@/main/agents/automation/service"
import { getChatSessionById } from "@/main/chat-sessions"
import { rpc } from "@/main/rpc/context"

export const automationRouter = {
  cancel: rpc
    .input(AutomationRunInputSchema)
    .output(AutomationRunSchema)
    .handler(
      async ({ input }) => await getAutomationManager().cancel(input.runId)
    ),
  list: rpc
    .output(AutomationListOutputSchema)
    .handler(async () => await getAutomationManager().list()),
  listRuns: rpc
    .input(AutomationListRunsInputSchema)
    .output(AutomationRunsOutputSchema)
    .handler(async ({ input }) => ({
      runs: await getAutomationManager().listRuns(input.taskId, input.limit)
    })),
  openSession: rpc
    .input(ChatSessionMessagesInputSchema)
    .output(AutomationMutationOutputSchema)
    .handler(async ({ context, input }) => {
      const session = await getChatSessionById(context.db, input.sessionId)
      if (!session || session.archivedAt) {
        throw new Error("Chat session not found.")
      }
      openAutomationSession(input.sessionId)
      return { ok: true }
    }),
  remove: rpc
    .input(AutomationTaskInputSchema)
    .output(AutomationMutationOutputSchema)
    .handler(async ({ input }) => {
      await getAutomationManager().remove(input.taskId)
      return { ok: true }
    }),
  runNow: rpc
    .input(AutomationTaskInputSchema)
    .output(AutomationRunSchema)
    .handler(
      async ({ input }) => await getAutomationManager().runNow(input.taskId)
    ),
  save: rpc
    .input(AutomationTaskDraftSchema)
    .output(AutomationTaskSchema)
    .handler(async ({ input }) => await getAutomationManager().save(input)),
  setEnabled: rpc
    .input(AutomationSetEnabledInputSchema)
    .output(AutomationTaskSchema)
    .handler(
      async ({ input }) =>
        await getAutomationManager().setEnabled(input.taskId, input.enabled)
    )
}
