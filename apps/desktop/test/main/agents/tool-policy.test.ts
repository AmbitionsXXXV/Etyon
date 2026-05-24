import { describe, expect, it } from "vite-plus/test"

import {
  compileAgentToolNames,
  isSafeAgentTool
} from "@/main/agents/tool-policy"
import type { AgentToolName } from "@/main/agents/types"

describe("agent tool policy compiler", () => {
  it("keeps tool order while removing non-safe tools for restricted scopes", () => {
    const allowedToolNames: AgentToolName[] = [
      "findFiles",
      "applyPatch",
      "agentExplore",
      "agentRunInspect",
      "rtkCommand",
      "gitDiff"
    ]

    expect(
      compileAgentToolNames({
        allowedToolNames,
        restrictToSafeTools: true
      })
    ).toEqual(["findFiles", "agentRunInspect", "gitDiff"])
  })

  it("leaves unrestricted tool lists unchanged", () => {
    const allowedToolNames: AgentToolName[] = [
      "findFiles",
      "applyPatch",
      "agentExplore"
    ]

    expect(
      compileAgentToolNames({
        allowedToolNames,
        restrictToSafeTools: false
      })
    ).toEqual(allowedToolNames)
  })

  it("filters tools through explicit skill capabilities", () => {
    const allowedToolNames: AgentToolName[] = [
      "readFile",
      "editFile",
      "gitDiff",
      "runCheck",
      "webSearch"
    ]

    expect(
      compileAgentToolNames({
        allowedToolNames,
        restrictToSafeTools: true,
        skillCapabilities: ["read-fs", "git"]
      })
    ).toEqual(["readFile", "gitDiff"])
  })

  it("does not expose tools for unsupported explicit skill capabilities", () => {
    expect(
      compileAgentToolNames({
        allowedToolNames: ["readFile", "memorySearch"],
        skillCapabilities: ["context-loaders"]
      })
    ).toEqual([])
  })

  it("classifies safe tools through the capability manifest", () => {
    expect(isSafeAgentTool("agentRunInspect")).toBe(true)
    expect(isSafeAgentTool("agentExplore")).toBe(false)
    expect(isSafeAgentTool("runCheck")).toBe(false)
  })
})
