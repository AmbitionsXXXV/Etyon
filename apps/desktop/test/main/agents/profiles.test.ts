import { AppSettingsSchema } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

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
      "searchFiles",
      "readFile",
      "gitDiff"
    ])
    expect(profile.toolPolicy.allowWrites).toBe(false)
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
})
