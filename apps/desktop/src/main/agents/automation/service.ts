import { createAutomationAgentState } from "@/main/agents/automation/agent-state"
import { createHeadlessAutomationRunner } from "@/main/agents/automation/headless-runner"
import { createAutomationManager } from "@/main/agents/automation/manager"
import type { AutomationManager } from "@/main/agents/automation/manager"
import { createAutomationNotifier } from "@/main/agents/automation/notifications"
import { createAutomationStore } from "@/main/agents/automation/store"
import { getDb } from "@/main/db"
import { getLocalConnectionToken } from "@/main/local-connection"
import { logger } from "@/main/logger"
import { getServerUrl } from "@/main/server/server-url"

let manager: AutomationManager | null = null
let openSessionHandler: ((sessionId: string) => void) | null = null

export const getAutomationManager = (): AutomationManager => {
  if (!manager) {
    const db = getDb()
    const store = createAutomationStore(db)
    const state = createAutomationAgentState(db)
    manager = createAutomationManager({
      ...state,
      execute: createHeadlessAutomationRunner({
        ...state,
        getConnectionToken: getLocalConnectionToken,
        getServerUrl,
        onRunStarted: async (automationRunId, agentRunId) => {
          await store.updateRun(automationRunId, {
            agentRunId,
            updatedAt: new Date().toISOString()
          })
        }
      }),
      notify: createAutomationNotifier({
        openSession: (sessionId) => openSessionHandler?.(sessionId)
      }),
      onError: (error) => logger.error("automation_service_failed", { error }),
      store
    })
  }
  return manager
}

export const startAutomationService = async (options: {
  openSession: (sessionId: string) => void
}): Promise<void> => {
  openSessionHandler = options.openSession
  await getAutomationManager().start()
}

export const stopAutomationService = async (): Promise<void> => {
  if (manager) {
    await manager.stop()
  }
}

export const openAutomationSession = (sessionId: string): void => {
  if (!openSessionHandler) {
    throw new Error("The automation service is unavailable.")
  }
  openSessionHandler(sessionId)
}
