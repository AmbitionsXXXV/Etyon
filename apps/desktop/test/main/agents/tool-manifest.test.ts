import { describe, expect, it } from "vite-plus/test"

import {
  getAgentToolManifest,
  listAgentToolManifests
} from "@/main/agents/tool-manifest"
import { AGENT_TOOL_NAMES } from "@/main/agents/types"

describe("agent tool manifests", () => {
  it("defines a manifest for every known agent tool", () => {
    expect(
      listAgentToolManifests()
        .map(({ id }) => id)
        .toSorted()
    ).toEqual([...AGENT_TOOL_NAMES].toSorted())
  })

  it("classifies built-in tool capabilities and risk levels", () => {
    expect(getAgentToolManifest("read")).toMatchObject({
      capabilities: ["read-fs"],
      owner: "builtin",
      riskLevel: "safe"
    })
    expect(getAgentToolManifest("edit")).toMatchObject({
      capabilities: ["write-fs"],
      owner: "builtin",
      riskLevel: "medium"
    })
    expect(getAgentToolManifest("bash")).toMatchObject({
      capabilities: ["shell"],
      owner: "builtin",
      riskLevel: "high"
    })
    expect(getAgentToolManifest("inspect")).toMatchObject({
      capabilities: ["lsp", "read-fs", "sandbox"],
      owner: "builtin",
      riskLevel: "safe"
    })
    expect(getAgentToolManifest("agentExplore")).toMatchObject({
      capabilities: ["agent-run"],
      owner: "builtin",
      riskLevel: "medium"
    })
    expect(getAgentToolManifest("memorySearch")).toMatchObject({
      capabilities: ["memory"],
      owner: "builtin",
      riskLevel: "safe"
    })
    expect(getAgentToolManifest("webSearch")).toMatchObject({
      capabilities: ["network"],
      owner: "builtin",
      riskLevel: "high"
    })
  })
})
