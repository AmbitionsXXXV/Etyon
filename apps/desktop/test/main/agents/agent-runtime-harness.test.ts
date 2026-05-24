import fs from "node:fs"

import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { createAgentRuntimeHarness } from "./agent-runtime-harness"
import { createFauxTextResponse } from "./faux-provider"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-agent-runtime-harness-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: {
    dev: true
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  },
  platform: {
    isLinux: true,
    isMacOS: false,
    isWindows: false
  }
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => []
  },
  app: {
    getAppPath: () => mockedAppPath,
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: {
    on: vi.fn()
  }
}))

describe("agent runtime harness", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("creates a project session and streams through the faux provider", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })

    harness.faux.setResponses([
      createFauxTextResponse("hello", {
        modelId: "mock-model"
      })
    ])
    const liveEventTypes: string[] = []
    const unsubscribe = harness.subscribeEvents((event) => {
      liveEventTypes.push(event.type)
    })

    const result = await harness.stream({
      messages: [
        {
          content: "Say hello.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    try {
      await result.consumeStream()
    } finally {
      unsubscribe()
    }

    expect(harness.session.projectPath).toBe(harness.projectPath)
    expect(harness.faux.model.doStreamCalls).toHaveLength(1)
    expect(harness.faux.model.doStreamCalls[0]?.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user"
        })
      ])
    )

    const events = await harness.listEvents()

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["agent_run_started", "agent_run_finished"])
    )
    expect(liveEventTypes).toEqual(
      expect.arrayContaining(["agent_run_started", "agent_run_finished"])
    )
  })

  it("only delivers live events for the harness session", async () => {
    const firstHarness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      projectPath: `${mockedHomeDir}/first-project`,
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })
    const secondHarness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      projectPath: `${mockedHomeDir}/second-project`,
      rootPath: mockedHomeDir,
      settings: firstHarness.settings
    })
    const firstLiveEventTypes: string[] = []
    const unsubscribe = firstHarness.subscribeEvents((event) => {
      firstLiveEventTypes.push(event.type)
    })

    try {
      secondHarness.faux.setResponses([
        createFauxTextResponse("second", {
          modelId: "mock-model"
        })
      ])

      const secondResult = await secondHarness.stream({
        messages: [
          {
            content: "Run in another session.",
            role: "user"
          }
        ] satisfies ModelMessage[]
      })

      await secondResult.consumeStream()

      expect(firstLiveEventTypes).toEqual([])

      firstHarness.faux.setResponses([
        createFauxTextResponse("first", {
          modelId: "mock-model"
        })
      ])

      const firstResult = await firstHarness.stream({
        messages: [
          {
            content: "Run in this session.",
            role: "user"
          }
        ] satisfies ModelMessage[]
      })

      await firstResult.consumeStream()

      expect(firstLiveEventTypes).toEqual(
        expect.arrayContaining(["agent_run_started", "agent_run_finished"])
      )
    } finally {
      unsubscribe()
    }
  })
})
