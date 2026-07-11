import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { buildChildWriteTools } from "@/main/agents/minimal/delegation"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { claimWrite } from "@/main/agents/write-claims"

const { registerApprovalMock, getSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(() => ({
    agents: { approvals: { approvalTtlMs: 1000, commandAllowlist: [] } }
  })),
  registerApprovalMock: vi.fn()
}))

vi.mock("@/main/agents/approval-broker", () => ({
  registerApproval: registerApprovalMock
}))

vi.mock("@/main/agents/agent-event-store", () => ({
  recordChildApprovalRequest: vi.fn(() => Promise.resolve("child-run:tc")),
  recordChildApprovalResponse: vi.fn(() => Promise.resolve()),
  recordDelegatedRunOutcome: vi.fn(),
  startAgentRun: vi.fn()
}))

vi.mock("@/main/db/write-lock", () => ({
  runExclusiveDbWrite: <T>(task: () => Promise<T>): Promise<T> => task()
}))

vi.mock("@/main/settings", () => ({ getSettings: getSettingsMock }))
vi.mock("@/main/db", () => ({ getDb: vi.fn() }))
vi.mock("@/main/server/lib/providers", () => ({ resolveModel: vi.fn() }))
vi.mock("@/main/logger", () => ({ logger: { error: vi.fn() } }))

const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-child-write-"))

const approve = (): void => {
  registerApprovalMock.mockResolvedValue({
    approved: true,
    reason: "responded"
  })
}
const deny = (): void => {
  registerApprovalMock.mockResolvedValue({
    approved: false,
    reason: "responded"
  })
}

const buildTools = (
  toolCalls: {
    input: unknown
    output: unknown
    toolCallId: string
    toolName: string
  }[],
  writer: { write: ReturnType<typeof vi.fn> }
) =>
  buildChildWriteTools({
    childRunId: "child-run",
    db: {} as never,
    holder: "child-run:coder",
    permissionMode: "default",
    toolCalls: toolCalls as never,
    topRunId: "top-run",
    workspace: getWorkspaceCore(projectPath),
    writer: writer as never
  })

const run = <T>(
  tool: unknown,
  input: unknown,
  toolCallId: string
): Promise<T> => {
  const { execute } = tool as {
    execute: (input: never, options: never) => Promise<T>
  }

  return execute(input as never, { toolCallId } as never)
}

beforeEach(() => {
  registerApprovalMock.mockReset()
  getSettingsMock.mockReturnValue({
    agents: { approvals: { approvalTtlMs: 1000, commandAllowlist: [] } }
  })
})

afterAll(() => {
  fs.rmSync(projectPath, { force: true, recursive: true })
})

describe("writable child tools — approval path", () => {
  it("executes an edit after approval and records it", async () => {
    approve()
    fs.writeFileSync(path.join(projectPath, "approved.ts"), "hello world")
    const toolCalls: Parameters<typeof buildTools>[0] = []
    const writer = { write: vi.fn() }
    const tools = buildTools(toolCalls, writer)

    const output = await run<{ appliedEdits: number }>(
      tools.edit,
      {
        edits: [{ newText: "goodbye", oldText: "hello" }],
        path: "approved.ts"
      },
      "tc-edit"
    )

    expect(output.appliedEdits).toBe(1)
    expect(
      fs.readFileSync(path.join(projectPath, "approved.ts"), "utf-8")
    ).toBe("goodbye world")
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.toolName).toBe("edit")
    // The prompt is surfaced then reconciled to resolved on the parent stream.
    expect(writer.write).toHaveBeenCalledTimes(2)
    expect(writer.write.mock.calls[0]?.[0]).toMatchObject({
      type: "data-subagent-approval"
    })
    expect(writer.write.mock.calls[1]?.[0]?.data).toMatchObject({
      resolved: "approved"
    })
  })

  it("returns a structured denial and does not write when denied", async () => {
    deny()
    fs.writeFileSync(path.join(projectPath, "denied.ts"), "keep me")
    const toolCalls: Parameters<typeof buildTools>[0] = []
    const writer = { write: vi.fn() }
    const tools = buildTools(toolCalls, writer)

    const output = await run<{ status?: string }>(
      tools.write,
      { content: "overwritten", path: "denied.ts" },
      "tc-write"
    )

    expect(output.status).toBe("denied")
    expect(fs.readFileSync(path.join(projectPath, "denied.ts"), "utf-8")).toBe(
      "keep me"
    )
    // A denied call is settled by the responder/broker, not recorded as a run
    // tool call here.
    expect(toolCalls).toHaveLength(0)
  })

  it("runs an approved bash command and records its output", async () => {
    approve()
    const toolCalls: Parameters<typeof buildTools>[0] = []
    const tools = buildTools(toolCalls, { write: vi.fn() })

    const output = await run<{ stdoutPreview: string; status: string }>(
      tools.bash,
      { command: "printf child-ok" },
      "tc-bash"
    )

    expect(output.status).toBe("completed")
    expect(output.stdoutPreview).toBe("child-ok")
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.toolName).toBe("bash")
  })

  it("rejects a write to a path another holder already claimed", async () => {
    approve()
    fs.writeFileSync(path.join(projectPath, "claimed.ts"), "original")
    claimWrite({
      holder: "child-other",
      path: "claimed.ts",
      topRunId: "top-run"
    })
    const toolCalls: Parameters<typeof buildTools>[0] = []
    const tools = buildTools(toolCalls, { write: vi.fn() })

    const output = await run<{ status?: string }>(
      tools.edit,
      { edits: [{ newText: "x", oldText: "original" }], path: "claimed.ts" },
      "tc-conflict"
    )

    expect(output.status).toBe("conflict")
    expect(fs.readFileSync(path.join(projectPath, "claimed.ts"), "utf-8")).toBe(
      "original"
    )
    // A conflict is a completed tool call (it returned a result), so it is
    // recorded — unlike a denial.
    expect(toolCalls).toHaveLength(1)
  })
})
