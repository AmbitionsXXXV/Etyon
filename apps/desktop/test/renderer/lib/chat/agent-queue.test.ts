import { describe, expect, it } from "vite-plus/test"

import {
  resolveAgentComposerPrimaryAction,
  resolveAgentComposerQueueState
} from "@/renderer/lib/chat/agent-queue"

describe("agent queue composer state", () => {
  it("keeps the composer editable while an agent request is pending", () => {
    expect(
      resolveAgentComposerQueueState({
        agentsEnabled: true,
        isModelUpdating: false,
        isRequestPending: true
      })
    ).toEqual({
      canQueueMessage: true,
      isComposerDisabled: false
    })
  })

  it("keeps the composer editable while a non-agent response is pending", () => {
    expect(
      resolveAgentComposerQueueState({
        agentsEnabled: false,
        isModelUpdating: false,
        isRequestPending: true
      })
    ).toEqual({
      canQueueMessage: false,
      isComposerDisabled: false
    })
  })

  it("keeps model updates blocking the composer", () => {
    expect(
      resolveAgentComposerQueueState({
        agentsEnabled: true,
        isModelUpdating: true,
        isRequestPending: true
      })
    ).toEqual({
      canQueueMessage: true,
      isComposerDisabled: true
    })
  })

  it("shows stop while an agent request is pending and the prompt is empty", () => {
    expect(
      resolveAgentComposerPrimaryAction({
        hasPromptInputValue: false,
        isOutputActive: true,
        isQueueSubmitEnabled: true
      })
    ).toBe("stop")
  })

  it("switches to submit while an agent request is pending and the prompt has content", () => {
    expect(
      resolveAgentComposerPrimaryAction({
        hasPromptInputValue: true,
        isOutputActive: true,
        isQueueSubmitEnabled: true
      })
    ).toBe("submit")
  })

  it("keeps stop while queue submit is unavailable", () => {
    expect(
      resolveAgentComposerPrimaryAction({
        hasPromptInputValue: true,
        isOutputActive: true,
        isQueueSubmitEnabled: false
      })
    ).toBe("stop")
  })

  it("shows submit outside an active agent request", () => {
    expect(
      resolveAgentComposerPrimaryAction({
        hasPromptInputValue: false,
        isOutputActive: false,
        isQueueSubmitEnabled: false
      })
    ).toBe("submit")
  })
})
