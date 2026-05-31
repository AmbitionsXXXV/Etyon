import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { describe, expect, it, vi } from "vite-plus/test"

import { createAgentRun, updateAgentRun } from "@/main/agents/agent-event-store"
import { appendAgentSessionQueuedFollowUpEvent } from "@/main/agents/agent-session-events"

import { createAgentRuntimeHarness } from "../agent-runtime-harness"
import { createFauxTextResponse } from "../faux-provider"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-regression-0001-test-${Date.now()}-${Math.random()
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

describe("ETYON-0001 queued follow-up replay", () => {
  it("drains queued follow-up from the latest completed top-level run into the next request", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })
    const previousRun = await createAgentRun({
      chatSessionId: harness.session.id,
      db: harness.db,
      modelId: harness.modelId,
      profileId: "general-purpose"
    })

    await appendAgentSessionQueuedFollowUpEvent({
      message: "Queued follow-up must reach the next request.",
      run: previousRun
    })
    await updateAgentRun({
      db: harness.db,
      id: previousRun.id,
      status: "succeeded"
    })
    harness.faux.setResponses([
      createFauxTextResponse("Consumed queued follow-up.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Start a fresh request.",
          role: "user"
        }
      ] satisfies ModelMessage[]
    })

    await result.consumeStream()

    const promptJson = JSON.stringify(
      harness.faux.model.doStreamCalls.at(-1)?.prompt
    )

    expect(promptJson).toContain(
      "Queued follow-up must reach the next request."
    )
    expect(await harness.session.listModelMessages()).toEqual(
      expect.arrayContaining([
        {
          content: "Queued follow-up must reach the next request.",
          role: "user",
          type: "model"
        }
      ])
    )
  })
})
