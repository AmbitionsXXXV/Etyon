import { AppSettingsSchema } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  CODE_AGENT_LSP_TOOL_ALIASES,
  CODE_AGENT_READONLY_TOOL_ALIASES,
  CODE_AGENT_TOOL_ALIASES
} from "@/main/agents/code-agent-tool-aliases"
import {
  BUILT_IN_AGENT_PROFILE_IDS,
  getAgentProfileById,
  resolveActiveAgentProfile
} from "@/main/agents/profiles"

describe("agent profiles", () => {
  it("defines stable built-in profile ids with general-purpose first", () => {
    expect(BUILT_IN_AGENT_PROFILE_IDS).toEqual([
      "general-purpose",
      "explore",
      "plan",
      "coder",
      "review",
      "harness-operator"
    ])
  })

  it("keeps the default profile read-only and limited to project context tools", () => {
    const profile = getAgentProfileById("general-purpose")

    expect(profile).toMatchObject({
      available: true,
      executionMode: "generalist",
      id: "general-purpose",
      name: "General Purpose",
      readonly: true
    })
    expect(profile.toolPolicy.allowedToolNames).toEqual([
      ...CODE_AGENT_READONLY_TOOL_ALIASES
    ])
    expect(profile.toolPolicy.allowWrites).toBe(false)
  })

  it("adds inspect to code-oriented profiles without changing general chat", () => {
    expect(
      getAgentProfileById("general-purpose").toolPolicy.allowedToolNames
    ).not.toContain("inspect")
    expect(getAgentProfileById("explore").toolPolicy.allowedToolNames).toEqual([
      ...CODE_AGENT_READONLY_TOOL_ALIASES,
      ...CODE_AGENT_LSP_TOOL_ALIASES
    ])
    expect(getAgentProfileById("review").toolPolicy.allowedToolNames).toEqual([
      ...CODE_AGENT_READONLY_TOOL_ALIASES,
      ...CODE_AGENT_LSP_TOOL_ALIASES
    ])
    expect(getAgentProfileById("coder").toolPolicy.allowedToolNames).toEqual([
      ...CODE_AGENT_TOOL_ALIASES,
      ...CODE_AGENT_LSP_TOOL_ALIASES,
      "agentExplore",
      "agentPlan",
      "agentReview"
    ])
  })

  it("falls back to the default profile when settings point to an unavailable profile", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        profiles: [
          {
            available: false,
            id: "coder",
            name: "Coder"
          }
        ]
      }
    }).agents

    const profile = resolveActiveAgentProfile(settings)

    expect(profile.id).toBe("general-purpose")
  })

  it("uses readonly overrides to remove write-capable tool policy", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        profiles: [
          {
            id: "coder",
            name: "Coder",
            readonly: true
          }
        ]
      }
    }).agents

    const profile = resolveActiveAgentProfile(settings)

    expect(profile.readonly).toBe(true)
    expect(profile.toolPolicy.allowWrites).toBe(false)
    expect(profile.toolPolicy.allowedToolNames).not.toContain("applyPatch")
    expect(profile.toolPolicy.allowedToolNames).not.toContain("bash")
    expect(profile.toolPolicy.allowedToolNames).not.toContain("write")
  })

  it("keeps profile-specific safe tools when a readonly override is saved", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "harness-operator",
        profiles: [
          {
            id: "harness-operator",
            name: "Harness Operator",
            readonly: true
          }
        ]
      }
    }).agents

    const profile = resolveActiveAgentProfile(settings)

    expect(profile.toolPolicy.allowedToolNames).toEqual([
      "agentEventsSearch",
      "agentRunInspect"
    ])
  })
})
