import { describe, expect, it } from "vite-plus/test"

import {
  listAgentComposerQueueActions,
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

  it("preserves the existing disabled state when agents are disabled", () => {
    expect(
      resolveAgentComposerQueueState({
        agentsEnabled: false,
        isModelUpdating: false,
        isRequestPending: true
      })
    ).toEqual({
      canQueueMessage: false,
      isComposerDisabled: true
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

  it("offers steering and follow-up queue actions while queueing is available", () => {
    expect(listAgentComposerQueueActions({ canQueueMessage: true })).toEqual([
      {
        labelKey: "chat.composer.queueSteer",
        queue: "steer"
      },
      {
        labelKey: "chat.composer.queueFollowUp",
        queue: "follow-up"
      }
    ])
  })

  it("does not offer queue actions outside an active agent request", () => {
    expect(listAgentComposerQueueActions({ canQueueMessage: false })).toEqual(
      []
    )
  })
})
