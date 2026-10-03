// @vitest-environment happy-dom

import { I18nProvider } from "@etyon/i18n/react"
import { AppSettingsSchema } from "@etyon/rpc"
import type {
  AutomationRun,
  AutomationTask
} from "@etyon/rpc/schemas/automation"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, createElement } from "react"
import type { ReactElement, ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { AutomationTab } from "@/renderer/components/settings/automation-tab"

const api = vi.hoisted(() => ({
  cancel: vi.fn(),
  openSession: vi.fn(),
  remove: vi.fn(),
  runNow: vi.fn(),
  save: vi.fn(),
  setEnabled: vi.fn()
}))
const queryKeys = {
  automation: ["automation.list"],
  sessions: ["chatSessions.list"],
  settings: ["settings.get"]
}

vi.mock("@/renderer/lib/rpc", () => ({
  orpc: {
    automation: {
      list: {
        key: () => ["automation.list"],
        queryOptions: () => ({
          queryFn: () => Promise.resolve({ runs: [], tasks: [] }),
          queryKey: ["automation.list"],
          staleTime: Infinity
        })
      }
    },
    chatSessions: {
      list: {
        queryOptions: () => ({
          queryFn: () => Promise.resolve([]),
          queryKey: ["chatSessions.list"],
          staleTime: Infinity
        })
      }
    },
    settings: {
      get: {
        queryOptions: () => ({
          queryFn: () => Promise.resolve(AppSettingsSchema.parse({})),
          queryKey: ["settings.get"],
          staleTime: Infinity
        })
      }
    }
  },
  rpcClient: { automation: api }
}))

const time = "2026-10-03T00:00:00.000Z"
const task: AutomationTask = {
  createdAt: time,
  enabled: false,
  id: "task-a",
  modelId: null,
  name: "Review project",
  nextRunAt: null,
  notifyDesktop: true,
  notifyTelegram: false,
  permissionMode: "default",
  profileId: null,
  prompt: "Read project status",
  schedule: { kind: "manual" },
  sessionId: "chat-a",
  timeoutMinutes: 30,
  updatedAt: time
}
const run: AutomationRun = {
  agentRunId: "agent-a",
  error: null,
  finishedAt: null,
  id: "run-a",
  notificationError: null,
  notifiedAt: time,
  sessionId: "chat-a",
  startedAt: time,
  status: "suspended",
  summary: null,
  taskId: "task-a",
  trigger: "manual",
  updatedAt: time
}
const cleanups: (() => void)[] = []
const TestI18nProvider = I18nProvider as unknown as (props: {
  children?: ReactNode
  locale: "en-US"
}) => ReactElement
const actGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actGlobal.IS_REACT_ACT_ENVIRONMENT = true

const renderTab = (tasks: AutomationTask[], runs: AutomationRun[] = []) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  })
  client.setQueryData(queryKeys.automation, { runs, tasks })
  client.setQueryData(queryKeys.sessions, [
    {
      id: "chat-a",
      projectPath: "/tmp/automation-ui-test",
      title: "Project chat"
    }
  ])
  client.setQueryData(queryKeys.settings, AppSettingsSchema.parse({}))
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          TestI18nProvider,
          { locale: "en-US" },
          createElement(AutomationTab, { active: true })
        )
      )
    )
  )
  cleanups.push(() => {
    act(() => root.unmount())
    client.clear()
    container.remove()
  })
  return container
}

const button = (
  container: HTMLElement,
  text: string,
  last = false
): HTMLButtonElement => {
  const buttons = [...container.querySelectorAll("button")].filter(
    (entry) => entry.textContent?.trim() === text
  )
  const found = last ? buttons.at(-1) : buttons[0]
  if (!found) {
    throw new Error(`Button not found: ${text}`)
  }
  return found
}

const click = async (target: HTMLButtonElement): Promise<void> => {
  await act(async () => {
    target.click()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const method of Object.values(api)) {
    method.mockResolvedValue({ ok: true })
  }
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
})

describe("background task management UI", () => {
  it("opens a new-task editor with approval permissions and notification defaults visible", async () => {
    const container = renderTab([])
    await click(button(container, "New task"))
    expect(container.textContent).toContain("Ask for edits and commands")
    expect(container.textContent).toContain("Manual only")
    expect(container.textContent).toContain("Project chat")
    const toggles = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    ]
    expect(toggles.map((toggle) => toggle.checked)).toEqual([
      false,
      true,
      false
    ])
    expect(button(container, "Save").disabled).toBe(true)
  })

  it("keeps paused tasks immutable and routes cancellation to the exact run", async () => {
    const container = renderTab([task], [run])
    expect(button(container, "Run now").disabled).toBe(true)
    expect(button(container, "Edit").disabled).toBe(true)
    expect(button(container, "Delete").disabled).toBe(true)
    await click(button(container, "Cancel run"))
    expect(api.cancel).toHaveBeenCalledWith({ runId: "run-a" })
  })

  it("requires a concrete deletion confirmation before deleting task history", async () => {
    const container = renderTab([task])
    await click(button(container, "Delete"))
    expect(container.textContent).toContain(
      "Delete this task and its run history?"
    )
    expect(api.remove).not.toHaveBeenCalled()
    await click(button(container, "Delete", true))
    expect(api.remove).toHaveBeenCalledWith({ taskId: "task-a" })
  })

  it("opens the associated chat without changing task permissions", async () => {
    const container = renderTab([task], [run])
    await click(button(container, "Open chat"))
    expect(api.openSession).toHaveBeenCalledWith({ sessionId: "chat-a" })
    expect(api.setEnabled).not.toHaveBeenCalled()
  })
})
