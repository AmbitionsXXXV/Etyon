// @vitest-environment happy-dom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import {
  clearScreenAwarenessCaptures,
  getPendingScreenAwarenessCaptures,
  stageScreenAwarenessCapture
} from "@/renderer/lib/chat/screen-awareness-capture-store"
import { useScreenAwareness } from "@/renderer/lib/chat/use-screen-awareness"
import type { ScreenAwarenessCapturePayload } from "@/shared/screen-awareness"

const state = vi.hoisted(() => ({
  assign: vi.fn(),
  createSession: vi.fn(),
  dismiss: vi.fn<(id: string) => Promise<void>>(),
  invalidate: vi.fn<(...args: unknown[]) => Promise<void>>(),
  listCaptures: vi.fn(),
  listSessions: vi.fn(),
  navigate: vi.fn<(...args: unknown[]) => Promise<void>>(),
  pathname: "/chat/chat-b",
  toast: vi.fn(),
  translate: (key: string) => key
}))

vi.mock("@etyon/i18n/react", () => ({
  useI18n: () => ({ t: state.translate })
}))
vi.mock("sonner", () => ({ toast: { error: state.toast } }))
vi.mock("@/renderer/lib/rpc", () => ({
  orpc: {
    chatSessions: {
      list: { queryOptions: () => ({ queryKey: ["chat-sessions"] }) }
    }
  },
  rpcClient: {
    chatSessions: { create: state.createSession, list: state.listSessions }
  }
}))
vi.mock("@/renderer/query-client", () => ({
  queryClient: { invalidateQueries: state.invalidate }
}))
vi.mock("@/renderer/router", () => ({
  router: {
    navigate: state.navigate,
    state: {
      location: {
        get pathname() {
          return state.pathname
        }
      }
    }
  }
}))

const capture = (
  id: string,
  sessionId?: string
): ScreenAwarenessCapturePayload => ({
  accessibleText: "Private text",
  capturedAt: new Date().toISOString(),
  id,
  mediaType: "image/png",
  sessionId,
  sourceAppName: "TextEdit"
})
const chat = {
  id: "chat-b",
  lastOpenedAt: new Date().toISOString(),
  projectPath: "/tmp/project-b"
}
const cleanups: (() => void)[] = []
const captureRecords = new Map<string, ScreenAwarenessCapturePayload>()
let captureListener: ((value: ScreenAwarenessCapturePayload) => void) | null =
  null
const actGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actGlobal.IS_REACT_ACT_ENVIRONMENT = true

const Observer = ({ enabled }: { enabled: boolean }) => {
  useScreenAwareness(enabled)
  return null
}

const renderHook = (enabled = true) => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(createElement(Observer, { enabled })))
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return {
    setEnabled: (value: boolean) =>
      act(() => root.render(createElement(Observer, { enabled: value })))
  }
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  clearScreenAwarenessCaptures()
  captureListener = null
  captureRecords.clear()
  state.pathname = "/chat/chat-b"
  state.assign.mockImplementation((id: string, sessionId: string) =>
    Promise.resolve({
      ...(captureRecords.get(id) ?? capture(id)),
      revision: 1,
      sessionId
    })
  )
  state.dismiss.mockResolvedValue()
  state.invalidate.mockResolvedValue()
  state.navigate.mockResolvedValue()
  state.listCaptures.mockResolvedValue([])
  state.listSessions.mockResolvedValue([chat])
  state.createSession.mockResolvedValue({ ...chat, id: "new-chat" })
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: {
      assignScreenAwarenessCapture: state.assign,
      dismissScreenAwarenessCapture: state.dismiss,
      ipcRenderer: { on: () => vi.fn() },
      listScreenAwarenessCaptures: state.listCaptures,
      onScreenAwarenessCapture: (
        listener: (value: ScreenAwarenessCapturePayload) => void
      ) => {
        captureListener = (value) => {
          captureRecords.set(value.id, value)
          listener(value)
        }
        return vi.fn()
      },
      onScreenAwarenessError: () => vi.fn()
    }
  })
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
  clearScreenAwarenessCaptures()
  vi.useRealTimers()
})

describe("screen-awareness delivery lifecycle", () => {
  it("dismisses an archived chat's recovered capture instead of moving private content to the current chat", async () => {
    const old = capture("old-capture", "archived-chat-a")
    stageScreenAwarenessCapture(old)
    state.listCaptures.mockResolvedValue([old])
    renderHook()
    await flush()
    expect(state.dismiss).toHaveBeenCalledWith("old-capture")
    expect(state.assign).not.toHaveBeenCalled()
    expect(state.createSession).not.toHaveBeenCalled()
    expect(state.navigate).not.toHaveBeenCalled()
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
  })

  it("clears private captures and blocks a delivery whose session lookup finishes after disabling", async () => {
    const sessions = Promise.withResolvers<(typeof chat)[]>()
    state.listSessions.mockReturnValue(sessions.promise)
    stageScreenAwarenessCapture(capture("existing", "chat-b"))
    const hook = renderHook()
    captureListener?.(capture("in-flight"))
    await flush()
    hook.setEnabled(false)
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
    sessions.resolve([chat])
    await flush()
    expect(state.assign).not.toHaveBeenCalled()
    expect(state.createSession).not.toHaveBeenCalled()
    expect(state.navigate).not.toHaveBeenCalled()
  })

  it("does not assign or stage after an in-flight chat creation completes while disabled", async () => {
    const created = Promise.withResolvers<typeof chat>()
    state.pathname = "/"
    state.listSessions.mockResolvedValue([])
    state.createSession.mockReturnValue(created.promise)
    const hook = renderHook()
    captureListener?.(capture("fresh"))
    await flush()
    expect(state.createSession).toHaveBeenCalled()
    hook.setEnabled(false)
    created.resolve(chat)
    await flush()
    expect(state.assign).not.toHaveBeenCalled()
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
    expect(state.navigate).not.toHaveBeenCalled()
  })

  it("does not stage or navigate when disabled while assigning the capture", async () => {
    const assigned = Promise.withResolvers<null>()
    state.assign.mockReturnValue(assigned.promise)
    const hook = renderHook()
    captureListener?.(capture("fresh"))
    await flush()
    expect(state.assign).toHaveBeenCalledWith("fresh", "chat-b")
    hook.setEnabled(false)
    assigned.resolve(null)
    await flush()
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
    expect(state.navigate).not.toHaveBeenCalled()
  })

  it("ignores a pending recovery list after the feature is disabled", async () => {
    const list = Promise.withResolvers<ScreenAwarenessCapturePayload[]>()
    state.listCaptures.mockReturnValue(list.promise)
    const hook = renderHook()
    hook.setEnabled(false)
    list.resolve([capture("late-recovery", "chat-b")])
    await flush()
    expect(state.listSessions).not.toHaveBeenCalled()
    expect(state.assign).not.toHaveBeenCalled()
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
  })

  it("does not navigate after disabling during query invalidation", async () => {
    const invalidated = Promise.withResolvers<null>()
    state.invalidate.mockImplementation(async () => {
      await invalidated.promise
    })
    const hook = renderHook()
    captureListener?.(capture("fresh"))
    await flush()
    expect(getPendingScreenAwarenessCaptures("chat-b")).toHaveLength(1)
    hook.setEnabled(false)
    invalidated.resolve(null)
    await flush()
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
    expect(state.navigate).not.toHaveBeenCalled()
  })

  it("refuses expired or future captures before resolving a session", async () => {
    renderHook()
    captureListener?.({
      ...capture("expired"),
      capturedAt: new Date(Date.now() - 700_000).toISOString()
    })
    captureListener?.({
      ...capture("future"),
      capturedAt: new Date(Date.now() + 1000).toISOString()
    })
    await flush()
    expect(state.listSessions).not.toHaveBeenCalled()
    expect(state.assign).not.toHaveBeenCalled()
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
  })

  it("rechecks capture expiry after an asynchronous session lookup", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-03T00:00:00Z"))
    const sessions = Promise.withResolvers<(typeof chat)[]>()
    state.listSessions.mockReturnValue(sessions.promise)
    renderHook()
    captureListener?.(capture("expires-while-waiting"))
    await flush()
    vi.setSystemTime(new Date("2026-10-03T00:10:00Z"))
    sessions.resolve([chat])
    await flush()
    expect(state.assign).not.toHaveBeenCalled()
    expect(state.navigate).not.toHaveBeenCalled()
    expect(getPendingScreenAwarenessCaptures()).toEqual([])
  })

  it("delivers a fresh unassigned capture to the current chat", async () => {
    renderHook()
    captureListener?.(capture("fresh"))
    await flush()
    expect(state.assign).toHaveBeenCalledWith("fresh", "chat-b")
    expect(getPendingScreenAwarenessCaptures("chat-b")).toMatchObject([
      { id: "fresh", sessionId: "chat-b" }
    ])
    expect(state.navigate).toHaveBeenCalledWith({
      params: { sessionId: "chat-b" },
      to: "/chat/$sessionId"
    })
  })

  it("stages the assigned canonical payload rather than an earlier recovery snapshot", async () => {
    const snapshot = {
      ...capture("old", "chat-b"),
      dataUrl: "data:image/png;base64,AAAA",
      revision: 1
    }
    state.listCaptures.mockResolvedValue([snapshot])
    state.assign.mockResolvedValue({
      ...snapshot,
      dataUrl: undefined,
      revision: 3
    })
    renderHook()
    await flush()
    expect(getPendingScreenAwarenessCaptures("chat-b")).toMatchObject([
      { dataUrl: undefined, revision: 3 }
    ])
  })
})
