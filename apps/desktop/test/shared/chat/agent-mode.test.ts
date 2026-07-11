import { describe, expect, it } from "vite-plus/test"

import {
  CHAT_PLAN_MODE_SYSTEM_PROMPT,
  getChatAgentModeAgentsEnabled,
  getChatAgentModeFromAgentsEnabled,
  getChatAgentModeSystemPrompt,
  getChatAgentModeToggleDisabled,
  getNextChatAgentMode,
  isChatAgentMode,
  isChatImagenCommandText,
  isChatPlanCommandText,
  isChatWorkflowCommandText,
  stripChatImagenCommand,
  stripChatPlanCommand
} from "@/shared/chat/agent-mode"
import type { ChatAgentMode } from "@/shared/chat/agent-mode"

describe("chat agent mode helpers", () => {
  it("maps the agent enabled flag to the composer mode", () => {
    expect(getChatAgentModeFromAgentsEnabled(false)).toBe("chat")
    expect(getChatAgentModeFromAgentsEnabled(true)).toBe("agent")
  })

  it("cycles through chat, agent, and plan modes", () => {
    expect(getNextChatAgentMode("chat")).toBe("agent")
    expect(getNextChatAgentMode("agent")).toBe("plan")
    expect(getNextChatAgentMode("plan")).toBe("chat")
  })

  it("enables agent tooling for agent and plan modes", () => {
    expect(getChatAgentModeAgentsEnabled("chat")).toBe(false)
    expect(getChatAgentModeAgentsEnabled("agent")).toBe(true)
    expect(getChatAgentModeAgentsEnabled("plan")).toBe(true)
  })

  it("disables mode toggles while the composer cannot switch modes", () => {
    expect(
      getChatAgentModeToggleDisabled({
        isRequestPending: false
      })
    ).toBe(false)
    expect(
      getChatAgentModeToggleDisabled({
        isRequestPending: true
      })
    ).toBe(true)
  })

  it("validates request body mode values", () => {
    expect(isChatAgentMode("agent")).toBe(true)
    expect(isChatAgentMode("chat")).toBe(true)
    expect(isChatAgentMode("plan")).toBe(true)
    expect(isChatAgentMode(null)).toBe(false)
  })

  it("detects and strips the /plan command prefix", () => {
    expect(isChatPlanCommandText("/plan refactor the auth flow")).toBe(true)
    expect(isChatPlanCommandText("  /plan ")).toBe(true)
    expect(isChatPlanCommandText("plan the work")).toBe(false)
    expect(stripChatPlanCommand("/plan refactor the auth flow")).toBe(
      "refactor the auth flow"
    )
  })

  it("detects and strips the /imagen command prefix", () => {
    expect(isChatImagenCommandText("/imagen a sunset over tokyo")).toBe(true)
    expect(isChatImagenCommandText("  /imagen ")).toBe(true)
    expect(isChatImagenCommandText("/imagenary")).toBe(false)
    expect(isChatImagenCommandText("draw an image")).toBe(false)
    expect(stripChatImagenCommand("/imagen a sunset over tokyo")).toBe(
      "a sunset over tokyo"
    )
  })

  it("detects the /workflow command prefix", () => {
    expect(isChatWorkflowCommandText("/workflow audit the auth flow")).toBe(
      true
    )
    expect(isChatWorkflowCommandText("  /workflow ")).toBe(true)
    expect(isChatWorkflowCommandText("/workflows")).toBe(false)
    expect(isChatWorkflowCommandText("run a workflow")).toBe(false)
  })

  it("returns the plan system prompt only for plan mode", () => {
    const noMode: ChatAgentMode | undefined = undefined

    expect(getChatAgentModeSystemPrompt("plan")).toBe(
      CHAT_PLAN_MODE_SYSTEM_PROMPT
    )
    expect(getChatAgentModeSystemPrompt("agent")).toBeNull()
    expect(getChatAgentModeSystemPrompt(noMode)).toBeNull()
  })
})
