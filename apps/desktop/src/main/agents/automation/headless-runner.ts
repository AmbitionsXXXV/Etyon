import type {
  AutomationRun,
  AutomationTask
} from "@etyon/rpc/schemas/automation"

import type { AutomationExecutionResult } from "@/main/agents/automation/manager"

export interface HeadlessAutomationDependencies {
  awaitSessionSettled: (sessionId: string) => Promise<void>
  fetchRequest?: (request: Request) => Promise<Response>
  getConnectionToken: () => string
  getServerUrl: () => string
  onRunStarted: (automationRunId: string, agentRunId: string) => Promise<void>
  readResult: (
    run: AutomationRun,
    agentRunId: string | null
  ) => Promise<AutomationExecutionResult>
}

export const createHeadlessAutomationRunner =
  ({
    awaitSessionSettled,
    fetchRequest = async (request) => await fetch(request),
    getConnectionToken,
    getServerUrl,
    onRunStarted,
    readResult
  }: HeadlessAutomationDependencies) =>
  async (
    task: AutomationTask,
    run: AutomationRun,
    signal: AbortSignal
  ): Promise<AutomationExecutionResult> => {
    const url = new URL("/api/chat", getServerUrl())
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
      throw new Error("The local chat server is unavailable.")
    }
    const request = new Request(url, {
      body: JSON.stringify({
        agentMode: "agent",
        automationPrompt: task.prompt,
        automationRunId: run.id,
        ...(task.modelId ? { model: task.modelId } : {}),
        permissionMode: task.permissionMode,
        ...(task.profileId ? { profileId: task.profileId } : {}),
        sessionId: task.sessionId
      }),
      headers: {
        authorization: `Bearer ${getConnectionToken()}`,
        "content-type": "application/json"
      },
      method: "POST",
      signal
    })
    let agentRunId: string | null = null
    try {
      const response = await fetchRequest(request)
      if (response.status === 409) {
        return {
          agentRunId: null,
          error: "The chat is already running.",
          status: "skipped"
        }
      }
      if (!response.ok) {
        throw new Error(
          `The local chat request failed (HTTP ${response.status}).`
        )
      }
      agentRunId = response.headers.get("x-etyon-agent-run-id")
      if (agentRunId) {
        await onRunStarted(run.id, agentRunId)
      }
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error("The local chat server returned an empty stream.")
      }
      try {
        // The canonical chat route owns persistence. Consuming the complete SSE
        // stream keeps execution alive when no renderer is attached and waits
        // for its onEnd persistence before classifying the result from the DB.
        while (true) {
          const result = await reader.read()
          if (result.done) {
            break
          }
        }
      } finally {
        reader.releaseLock()
      }
    } catch (error) {
      if (!signal.aborted) {
        await awaitSessionSettled(task.sessionId)
        const settled = await readResult(run, agentRunId)
        if (!settled.agentRunId) {
          throw error
        }
        return settled
      }
    }
    if (signal.aborted) {
      await awaitSessionSettled(task.sessionId)
    }
    const result = await readResult(run, agentRunId)
    if (result.agentRunId && result.agentRunId !== agentRunId) {
      await onRunStarted(run.id, result.agentRunId)
    }
    return result
  }
