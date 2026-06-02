import { describe, expect, it } from "vite-plus/test"

import {
  getChatAgentModeFromAgentsEnabled,
  getChatAgentModeToggleDisabled,
  getNextChatAgentMode,
  isChatAgentMode
} from "@/shared/chat/agent-mode"

describe("chat agent mode helpers", () => {
  it("maps the agent enabled flag to the composer mode", () => {
    expect(getChatAgentModeFromAgentsEnabled(false)).toBe("chat")
    expect(getChatAgentModeFromAgentsEnabled(true)).toBe("agent")
  })

  it("toggles between chat and agent modes", () => {
    expect(getNextChatAgentMode("agent")).toBe("chat")
    expect(getNextChatAgentMode("chat")).toBe("agent")
  })

  it("disables mode toggles while the composer cannot switch modes", () => {
    expect(
      getChatAgentModeToggleDisabled({
        isModelUpdating: false,
        isRequestPending: false
      })
    ).toBe(false)
    expect(
      getChatAgentModeToggleDisabled({
        isModelUpdating: true,
        isRequestPending: false
      })
    ).toBe(true)
    expect(
      getChatAgentModeToggleDisabled({
        isModelUpdating: false,
        isRequestPending: true
      })
    ).toBe(true)
  })

  it("validates request body mode values", () => {
    expect(isChatAgentMode("agent")).toBe(true)
    expect(isChatAgentMode("chat")).toBe(true)
    expect(isChatAgentMode("plan")).toBe(false)
    expect(isChatAgentMode(null)).toBe(false)
  })
})
