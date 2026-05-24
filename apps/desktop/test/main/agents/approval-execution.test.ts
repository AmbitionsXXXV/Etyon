import fs from "node:fs"
import fsPromises from "node:fs/promises"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  createAgentRun,
  listAgentToolCalls,
  recordAgentToolCall,
  updateAgentRun
} from "@/main/agents/agent-event-store"

import { createAgentRuntimeHarness } from "./agent-runtime-harness"
import { createFauxTextResponse } from "./faux-provider"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-agent-approval-execution-test-${Date.now()}-${Math.random()
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

const buildApprovedToolMessages = (): ModelMessage[] => [
  {
    content: [
      {
        input: {
          content: "approved",
          path: "approved.txt"
        },
        toolCallId: "tool-call-1",
        toolName: "writeFile",
        type: "tool-call"
      },
      {
        approvalId: "approval-1",
        toolCallId: "tool-call-1",
        type: "tool-approval-request"
      }
    ],
    role: "assistant"
  },
  {
    content: [
      {
        approvalId: "approval-1",
        approved: true,
        type: "tool-approval-response"
      }
    ],
    role: "tool"
  }
]

describe("agent approval execution", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("executes an approved local tool before continuing the model stream", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          defaultProfileId: "coder",
          enabled: true
        }
      })
    })
    const run = await createAgentRun({
      chatSessionId: harness.session.id,
      db: harness.db,
      modelId: harness.modelId,
      profileId: "coder"
    })

    await recordAgentToolCall({
      approvalState: "pending",
      db: harness.db,
      id: "tool-call-1",
      input: {
        content: "approved",
        path: "approved.txt"
      },
      runId: run.id,
      state: "approval_requested",
      toolName: "writeFile"
    })
    await run.appendEvent({
      payload: {
        approvalId: "approval-1",
        toolCallId: "tool-call-1"
      },
      type: "tool_call_approval_requested"
    })
    await updateAgentRun({
      db: harness.db,
      id: run.id,
      status: "suspended"
    })

    harness.faux.setResponses([
      createFauxTextResponse("done", {
        modelId: harness.modelId
      })
    ])

    const result = await harness.stream({
      messages: buildApprovedToolMessages()
    })

    await result.consumeStream()

    const written = await fsPromises.readFile(
      path.join(harness.projectPath, "approved.txt"),
      "utf-8"
    )
    const [modelCall] = harness.faux.model.doStreamCalls
    const toolCalls = await listAgentToolCalls({
      db: harness.db,
      runId: run.id
    })

    expect(written).toBe("approved")
    expect(modelCall?.prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: [
            expect.objectContaining({
              toolCallId: "tool-call-1",
              toolName: "writeFile",
              type: "tool-result"
            })
          ],
          role: "tool"
        })
      ])
    )
    expect(toolCalls).toMatchObject([
      {
        approvalState: "approved",
        id: "tool-call-1",
        state: "finished",
        toolName: "writeFile"
      }
    ])
  })
})
