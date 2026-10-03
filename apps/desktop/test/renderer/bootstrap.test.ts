// @vitest-environment happy-dom

import { AppSettingsSchema } from "@etyon/rpc"
import type { AppSettings } from "@etyon/rpc"
import { QueryClient, useQueryClient } from "@tanstack/react-query"
import { act, createElement } from "react"
import type { ReactNode } from "react"
import type { createRoot as CreateReactRoot, Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"

const state = vi.hoisted(() => ({
  clients: [] as QueryClient[],
  listCaptures: vi.fn(),
  listeners: new Map<string, ((...args: unknown[]) => void)[]>(),
  roots: [] as Root[],
  settings: null as AppSettings | null,
  subscribeCapture: vi.fn(),
  subscribeError: vi.fn()
}))

vi.mock("@etyon/ui/globals.css", () => ({}))
vi.mock("streamdown/styles.css", () => ({}))
vi.mock("@xterm/xterm/css/xterm.css", () => ({}))
vi.mock("@etyon/logger/renderer", () => ({ initLogger: vi.fn() }))
vi.mock("@/renderer/lib/settings", () => ({
  applyColorSchemaPreview: vi.fn(),
  applySettings: vi.fn(),
  watchSystemTheme: () => vi.fn()
}))
vi.mock("@/renderer/lib/rpc", () => ({
  orpc: {
    settings: { get: { queryOptions: () => ({ queryKey: ["settings"] }) } },
    sidebarState: { get: { queryOptions: () => ({ queryKey: ["sidebar"] }) } }
  },
  rpcClient: {
    logger: { emit: vi.fn() },
    settings: { get: () => Promise.resolve(state.settings) }
  }
}))
vi.mock("@/renderer/router", () => ({
  router: { navigate: vi.fn(), state: { location: { pathname: "/" } } }
}))
vi.mock("@/renderer/query-client", () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  state.clients.push(queryClient)
  return { queryClient }
})
vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<{ createRoot: typeof CreateReactRoot }>()
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args)
      state.roots.push(root)
      return root
    }
  }
})
vi.mock("@/renderer/app", async () => {
  const { useI18n } = await import("@etyon/i18n/react")
  return {
    App: () => {
      const { locale, t } = useI18n()
      useQueryClient()
      return createElement(
        "p",
        { "data-locale": locale, id: "main-app" },
        t("settings.common.save")
      )
    }
  }
})
vi.mock("@/renderer/components/settings-page", async () => {
  const { useI18n } = await import("@etyon/i18n/react")
  return {
    SettingsPage: () => {
      const { locale, t } = useI18n()
      useQueryClient()
      return createElement(
        "p",
        { "data-locale": locale, id: "settings-app" },
        t("window.settings.title")
      )
    }
  }
})
vi.mock("@/renderer/components/first-light/first-light-overlay", () => ({
  FirstLightGate: ({ children }: { children: ReactNode }) => children
}))

const actGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actGlobal.IS_REACT_ACT_ENVIRONMENT = true
const boot = async (): Promise<void> => {
  await act(async () => {
    await import("@/renderer/index")
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.body.innerHTML = '<div id="root"></div>'
  window.history.replaceState({}, "", "/")
  state.listeners.clear()
  state.listCaptures.mockResolvedValue([])
  state.subscribeCapture.mockReturnValue(vi.fn())
  state.subscribeError.mockReturnValue(vi.fn())
  state.settings = AppSettingsSchema.parse({
    locale: "ja-JP",
    screenAwareness: { enabled: false }
  })
  Object.defineProperty(window, "electron", {
    configurable: true,
    value: {
      ipcRenderer: {
        on: (channel: string, listener: (...args: unknown[]) => void) => {
          const listeners = state.listeners.get(channel) ?? []
          listeners.push(listener)
          state.listeners.set(channel, listeners)
          return () =>
            state.listeners.set(
              channel,
              (state.listeners.get(channel) ?? []).filter(
                (entry) => entry !== listener
              )
            )
        }
      },
      listScreenAwarenessCaptures: state.listCaptures,
      onScreenAwarenessCapture: state.subscribeCapture,
      onScreenAwarenessError: state.subscribeError
    }
  })
})
afterEach(() => {
  for (const root of state.roots.splice(0)) {
    act(() => root.unmount())
  }
  for (const client of state.clients.splice(0)) {
    client.clear()
  }
  document.body.replaceChildren()
})

describe("renderer bootstrap providers", () => {
  it("boots with the real I18nProvider and a disabled screen-awareness hook without a missing-instance error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await boot()
      expect(
        document.querySelector<HTMLElement>("#main-app")?.dataset.locale
      ).toBe("ja-JP")
      expect(document.querySelector("#main-app")?.textContent).toBe("保存")
      expect(document.documentElement.lang).toBe("ja-JP")
      expect(state.listCaptures).not.toHaveBeenCalled()
      expect(state.listeners.get("automation-open-session")).toHaveLength(1)
      expect(warn.mock.calls.flat().join(" ")).not.toContain(
        "NO_I18NEXT_INSTANCE"
      )
    } finally {
      warn.mockRestore()
    }
  })

  it("starts runtime capture subscriptions after providers are ready in the main window", async () => {
    state.settings = AppSettingsSchema.parse({
      locale: "en-US",
      screenAwareness: { enabled: true }
    })
    await boot()
    expect(
      document.querySelector<HTMLElement>("#main-app")?.dataset.locale
    ).toBe("en-US")
    expect(state.listCaptures).toHaveBeenCalledTimes(1)
    expect(state.subscribeCapture).toHaveBeenCalledTimes(1)
    expect(state.subscribeError).toHaveBeenCalledTimes(1)
  })

  it("boots the settings window with translation context while both runtime listeners remain inactive", async () => {
    window.history.replaceState({}, "", "/?window=settings")
    state.settings = AppSettingsSchema.parse({
      locale: "zh-CN",
      screenAwareness: { enabled: true }
    })
    await boot()
    expect(
      document.querySelector<HTMLElement>("#settings-app")?.dataset.locale
    ).toBe("zh-CN")
    expect(document.querySelector("#main-app")).toBeNull()
    expect(state.listCaptures).not.toHaveBeenCalled()
    expect(state.subscribeCapture).not.toHaveBeenCalled()
    expect(state.listeners.get("automation-open-session")).toBeUndefined()
  })
})
