import type {
  AutomationSchedule,
  AutomationTask,
  AutomationTaskDraft
} from "@etyon/rpc/schemas/automation"

export const createAutomationDraft = (sessionId = ""): AutomationTaskDraft => ({
  enabled: false,
  modelId: null,
  name: "",
  notifyDesktop: true,
  notifyTelegram: false,
  permissionMode: "default",
  profileId: null,
  prompt: "",
  schedule: { kind: "manual" },
  sessionId,
  timeoutMinutes: 30
})

export const toAutomationDraft = (
  task: AutomationTask
): AutomationTaskDraft => ({
  enabled: task.enabled,
  id: task.id,
  modelId: task.modelId,
  name: task.name,
  notifyDesktop: task.notifyDesktop,
  notifyTelegram: task.notifyTelegram,
  permissionMode: task.permissionMode,
  profileId: task.profileId,
  prompt: task.prompt,
  schedule: task.schedule,
  sessionId: task.sessionId,
  timeoutMinutes: task.timeoutMinutes
})

export const createAutomationSchedule = (
  kind: AutomationSchedule["kind"]
): AutomationSchedule => {
  if (kind === "interval") {
    return { kind, minutes: 60 }
  }
  if (kind === "cron") {
    return {
      expression: "0 9 * * 1-5",
      kind,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  }
  return { kind: "manual" }
}
