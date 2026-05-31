import { describe, expect, it } from "vite-plus/test"

import {
  compileAgentToolNames,
  isSafeAgentTool
} from "@/main/agents/tool-policy"
import type { AgentToolName } from "@/main/agents/types"

describe("agent tool policy compiler", () => {
  it("keeps tool order while removing non-safe tools for restricted scopes", () => {
    const allowedToolNames: AgentToolName[] = [
      "find",
      "write",
      "agentExplore",
      "agentRunInspect",
      "bash",
      "gitDiff"
    ]

    expect(
      compileAgentToolNames({
        allowedToolNames,
        restrictToSafeTools: true
      })
    ).toEqual(["find", "agentRunInspect", "gitDiff"])
  })

  it("leaves unrestricted tool lists unchanged", () => {
    const allowedToolNames: AgentToolName[] = ["find", "write", "agentExplore"]

    expect(
      compileAgentToolNames({
        allowedToolNames,
        restrictToSafeTools: false
      })
    ).toEqual(allowedToolNames)
  })

  it("filters tools through explicit skill capabilities", () => {
    const allowedToolNames: AgentToolName[] = [
      "read",
      "edit",
      "gitDiff",
      "bash",
      "webSearch"
    ]

    expect(
      compileAgentToolNames({
        allowedToolNames,
        restrictToSafeTools: true,
        skillCapabilities: ["read-fs", "git"]
      })
    ).toEqual(["read", "gitDiff"])
  })

  it("does not expose tools for unsupported explicit skill capabilities", () => {
    expect(
      compileAgentToolNames({
        allowedToolNames: ["read", "memorySearch"],
        skillCapabilities: ["context-loaders"]
      })
    ).toEqual([])
  })

  it("classifies safe tools through the capability manifest", () => {
    expect(isSafeAgentTool("agentRunInspect")).toBe(true)
    expect(isSafeAgentTool("agentExplore")).toBe(false)
    expect(isSafeAgentTool("bash")).toBe(false)
    expect(isSafeAgentTool("inspect")).toBe(true)
    expect(isSafeAgentTool("mkdir")).toBe(false)
    expect(isSafeAgentTool("requestAccess")).toBe(false)
    expect(isSafeAgentTool("smartEdit")).toBe(false)
    expect(isSafeAgentTool("stat")).toBe(true)
  })
})
