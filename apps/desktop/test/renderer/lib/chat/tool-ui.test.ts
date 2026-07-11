import type { AgentCommandApprovalRule, ChatMention } from "@etyon/rpc"
import type { DynamicToolUIPart } from "ai"
import { describe, expect, it, vi } from "vite-plus/test"

import {
  mapAssistantToolPartStateToChatToolState,
  respondToAssistantToolApproval,
  upsertCommandApprovalRule
} from "@/renderer/lib/chat/tool-ui"

describe("chat tool ui helpers", () => {
  it("maps approval tool parts to HeroUI Pro requires-action state", () => {
    expect(mapAssistantToolPartStateToChatToolState("approval-requested")).toBe(
      "requires-action"
    )
    expect(mapAssistantToolPartStateToChatToolState("input-streaming")).toBe(
      "input-streaming"
    )
    expect(mapAssistantToolPartStateToChatToolState("output-denied")).toBe(
      "output-error"
    )
  })

  it("routes approval tool parts to AI SDK approval responses", () => {
    const addToolApprovalResponse = vi.fn()
    const latestUserMentions = [
      {
        kind: "file",
        path: "/project/src/value.ts",
        relativePath: "src/value.ts",
        snapshotId: "snapshot-1"
      }
    ] satisfies ChatMention[]
    const buildChatRequestOptions = vi.fn((mentions: ChatMention[]) => ({
      body: {
        mentions,
        sessionId: "session-1"
      }
    }))
    const approvalPart = {
      approval: {
        id: "approval-1"
      },
      input: {
        command: "vp check"
      },
      state: "approval-requested",
      toolCallId: "tool-approval",
      toolName: "bash",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart

    expect(
      respondToAssistantToolApproval({
        addToolApprovalResponse,
        approved: true,
        buildChatRequestOptions,
        latestUserMentions,
        part: approvalPart
      })
    ).toBe(true)
    expect(buildChatRequestOptions).toHaveBeenCalledWith(latestUserMentions)
    expect(addToolApprovalResponse).toHaveBeenCalledWith({
      approved: true,
      id: "approval-1",
      options: {
        body: {
          mentions: latestUserMentions,
          sessionId: "session-1"
        }
      },
      reason: undefined
    })

    addToolApprovalResponse.mockClear()

    expect(
      respondToAssistantToolApproval({
        addToolApprovalResponse,
        approved: false,
        buildChatRequestOptions,
        latestUserMentions,
        part: approvalPart
      })
    ).toBe(true)
    expect(addToolApprovalResponse).toHaveBeenCalledWith({
      approved: false,
      id: "approval-1",
      options: {
        body: {
          mentions: latestUserMentions,
          sessionId: "session-1"
        }
      },
      reason: "Denied in chat UI."
    })
  })

  it("remembers a command only when approving an approval-requested part", () => {
    const addToolApprovalResponse = vi.fn()
    const buildChatRequestOptions = vi.fn((mentions: ChatMention[]) => ({
      body: {
        mentions,
        sessionId: "session-1"
      }
    }))
    const onRememberCommand = vi.fn()
    const approvalPart = {
      approval: {
        id: "approval-1"
      },
      input: {
        command: "vp check"
      },
      state: "approval-requested",
      toolCallId: "tool-approval",
      toolName: "bash",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart

    respondToAssistantToolApproval({
      addToolApprovalResponse,
      approved: true,
      buildChatRequestOptions,
      latestUserMentions: [],
      onRememberCommand,
      part: approvalPart
    })
    expect(onRememberCommand).toHaveBeenCalledTimes(1)

    onRememberCommand.mockClear()

    respondToAssistantToolApproval({
      addToolApprovalResponse,
      approved: false,
      buildChatRequestOptions,
      latestUserMentions: [],
      onRememberCommand,
      part: approvalPart
    })
    expect(onRememberCommand).not.toHaveBeenCalled()
  })

  it("ignores non-approval tool parts when routing approval responses", () => {
    const addToolApprovalResponse = vi.fn()
    const buildChatRequestOptions = vi.fn((mentions: ChatMention[]) => ({
      body: {
        mentions,
        sessionId: "session-1"
      }
    }))
    const outputPart = {
      input: {
        path: "src/value.ts"
      },
      output: {
        content: "done"
      },
      state: "output-available",
      toolCallId: "tool-output",
      toolName: "read",
      type: "dynamic-tool"
    } satisfies DynamicToolUIPart

    expect(
      respondToAssistantToolApproval({
        addToolApprovalResponse,
        approved: true,
        buildChatRequestOptions,
        latestUserMentions: [],
        part: outputPart
      })
    ).toBe(false)
    expect(addToolApprovalResponse).not.toHaveBeenCalled()
    expect(buildChatRequestOptions).not.toHaveBeenCalled()
  })
})

describe("upsertCommandApprovalRule", () => {
  const baseRule = {
    command: "vp check",
    createdAt: "2026-01-01T00:00:00.000Z",
    projectPath: "/project",
    toolName: "bash"
  } satisfies AgentCommandApprovalRule

  it("appends a new rule to an empty allowlist", () => {
    expect(upsertCommandApprovalRule([], baseRule)).toEqual([baseRule])
  })

  it("replaces an entry with the same tool, project, and command", () => {
    const refreshed = {
      ...baseRule,
      createdAt: "2026-02-02T00:00:00.000Z"
    } satisfies AgentCommandApprovalRule

    expect(upsertCommandApprovalRule([baseRule], refreshed)).toEqual([
      refreshed
    ])
  })

  it("keeps entries that differ in tool, project, or command", () => {
    const otherProject = {
      ...baseRule,
      projectPath: "/other"
    } satisfies AgentCommandApprovalRule
    const otherCommand = {
      ...baseRule,
      command: "vp test"
    } satisfies AgentCommandApprovalRule
    const otherTool = {
      ...baseRule,
      toolName: "runCheck"
    } satisfies AgentCommandApprovalRule
    const refreshed = {
      ...baseRule,
      createdAt: "2026-03-03T00:00:00.000Z"
    } satisfies AgentCommandApprovalRule

    expect(
      upsertCommandApprovalRule(
        [otherProject, otherCommand, otherTool, baseRule],
        refreshed
      )
    ).toEqual([otherProject, otherCommand, otherTool, refreshed])
  })
})
