import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import type * as Ai from "ai"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { runDelegatedAgent } from "@/main/agents/minimal/delegation"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockedHomeDir, resolveModelMock, streamTextMock } = vi.hoisted(() => ({
  mockedHomeDir: `/tmp/etyon-subagent-forward-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`,
  resolveModelMock: vi.fn(() => ({})),
  streamTextMock: vi.fn()
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
  optimizer: { watchWindowShortcuts: vi.fn() },
  platform: { isLinux: true, isMacOS: false, isWindows: false }
}))

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getAppPath: () =>
      process.cwd().endsWith("/apps/desktop")
        ? process.cwd()
        : `${process.cwd()}/apps/desktop`,
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: { on: vi.fn() }
}))

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof Ai>()

  return { ...actual, streamText: streamTextMock }
})

vi.mock("@/main/server/lib/providers", () => ({
  resolveModel: resolveModelMock
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempProjectPath = fs.mkdtempSync(
  path.join(os.tmpdir(), "etyon-subagent-forward-")
)

const streamFrom = (chunks: unknown[]): ReadableStream =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    }
  })

const childProfile: ResolvedAgentProfile = {
  allowDelegation: false,
  allowedDelegateProfileIds: [],
  allowedTools: ["read", "ls", "grep"],
  available: true,
  executionMode: "generalist",
  id: "explore",
  instructions: "",
  name: "Explore",
  preferredModel: "",
  readonly: true
}

interface DataStreamPart {
  data: { childRunId: string; chunk?: { delta?: string; type?: string } }
  id?: string
  transient?: boolean
  type: string
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDelegatedAgent live forwarding", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
    fs.rmSync(tempProjectPath, { force: true, recursive: true })
  })

  it("brackets forwarded child chunks with subagent-start and subagent-end", async () => {
    streamTextMock.mockReturnValue({
      get text() {
        return Promise.resolve("Hello")
      },
      toUIMessageStream: () =>
        streamFrom([
          { id: "t1", type: "text-start" },
          { delta: "Hel", id: "t1", type: "text-delta" },
          { delta: "lo", id: "t1", type: "text-delta" },
          { id: "t1", type: "text-end" },
          {
            input: { path: "a.ts" },
            toolCallId: "c1",
            toolName: "read",
            type: "tool-input-available"
          },
          { output: "1\tx", toolCallId: "c1", type: "tool-output-available" }
        ])
    })

    const write = vi.fn()
    const result = await runDelegatedAgent({
      childProfile,
      childRunId: "child-1",
      modelId: null,
      parentToolCallId: "parent-tc",
      projectPath: tempProjectPath,
      task: "investigate the thing",
      writer: { merge: vi.fn(), onError: undefined, write } as never
    })

    expect(result.text).toBe("Hello")

    const writes = write.mock.calls.map((call) => call[0] as DataStreamPart)

    // Start marker first, carrying the child identity + clamped task.
    expect(writes[0]).toMatchObject({
      data: {
        childRunId: "child-1",
        parentToolCallId: "parent-tc",
        profileId: "explore",
        task: "investigate the thing"
      },
      id: "child-1",
      transient: true,
      type: "data-subagent-start"
    })

    // End marker last, with a succeeded outcome and a numeric duration.
    const last = writes.at(-1)

    expect(last).toMatchObject({
      data: { childRunId: "child-1", state: "succeeded" },
      id: "child-1:end",
      transient: true,
      type: "data-subagent-end"
    })
    expect(
      typeof (last as { data: { durationMs?: unknown } }).data.durationMs
    ).toBe("number")

    // Everything between is a transient, id-less chunk for this child.
    const chunkParts = writes.slice(1, -1)

    expect(chunkParts.length).toBeGreaterThan(0)
    for (const part of chunkParts) {
      expect(part.type).toBe("data-subagent-chunk")
      expect(part.transient).toBe(true)
      expect("id" in part).toBe(false)
      expect(part.data.childRunId).toBe("child-1")
    }

    // Text deltas concatenate to the full child answer (coalesced or not).
    const forwardedText = chunkParts
      .map((part) => part.data.chunk)
      .filter((chunk) => chunk?.type === "text-delta")
      .map((chunk) => chunk?.delta ?? "")
      .join("")

    expect(forwardedText).toBe("Hello")

    const forwardedTypes = chunkParts.map((part) => part.data.chunk?.type)

    expect(forwardedTypes).toContain("tool-input-available")
    expect(forwardedTypes).toContain("tool-output-available")
  })

  it("emits a failed subagent-end when the child stream rejects", async () => {
    streamTextMock.mockReturnValue({
      get text() {
        return Promise.reject(new Error("model boom"))
      },
      toUIMessageStream: () => streamFrom([])
    })

    const write = vi.fn()

    await expect(
      runDelegatedAgent({
        childProfile,
        childRunId: "child-2",
        modelId: null,
        projectPath: tempProjectPath,
        task: "will fail",
        writer: { merge: vi.fn(), onError: undefined, write } as never
      })
    ).rejects.toThrow(/model boom/u)

    const writes = write.mock.calls.map((call) => call[0] as DataStreamPart)
    const last = writes.at(-1)

    expect(last).toMatchObject({
      data: {
        childRunId: "child-2",
        errorMessage: "model boom",
        state: "failed"
      },
      id: "child-2:end",
      type: "data-subagent-end"
    })
  })
})
