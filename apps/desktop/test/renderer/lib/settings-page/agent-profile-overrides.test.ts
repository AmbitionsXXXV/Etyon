import type { AgentProfile, AgentSettings } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  removeAgentProfileOverride,
  resolveAgentProfileDraft,
  upsertAgentProfileOverride
} from "@/renderer/lib/settings-page/agent-profile-overrides"

const baseAgents: AgentSettings = {
  allowSubagentDelegation: false,
  approvals: {
    commandAllowlist: []
  },
  defaultProfileId: "coder",
  enabled: true,
  lsp: {
    diagnosticTimeoutMs: 5000,
    enabled: false,
    initTimeoutMs: 15_000,
    requireSandbox: true
  },
  maxConcurrentSubagents: 2,
  maxSteps: 8,
  profiles: [],
  requireApprovalForWrites: true,
  retry: {
    maxAutomaticRetries: 1,
    retryTransientFailures: true
  },
  sandbox: {
    allowNetwork: false,
    autoAllowSandboxedShell: false,
    enabled: false,
    failIfUnavailable: true
  },
  showToolTraces: true
}

const coderDefaults: AgentProfile = {
  allowedDelegateProfileIds: [],
  available: true,
  description: "Implementation profile",
  executionMode: "coder",
  focusAreas: ["Implementation", "Tests"],
  id: "coder",
  instructions: "",
  name: "Coder",
  preferredModel: "",
  readonly: false
}

describe("agent profile override helpers", () => {
  it("resolves the built-in profile defaults when no override exists", () => {
    expect(resolveAgentProfileDraft(baseAgents, coderDefaults)).toEqual(
      coderDefaults
    )
  })

  it("upserts a profile override while preserving unrelated overrides", () => {
    const reviewOverride: AgentProfile = {
      ...coderDefaults,
      id: "review",
      name: "Reviewer",
      readonly: true
    }
    const nextAgents = upsertAgentProfileOverride({
      agents: {
        ...baseAgents,
        profiles: [reviewOverride]
      },
      defaults: coderDefaults,
      patch: {
        instructions: "Prefer small patches.",
        name: "Focused Coder",
        readonly: true
      }
    })

    expect(nextAgents.profiles).toEqual([
      reviewOverride,
      {
        ...coderDefaults,
        instructions: "Prefer small patches.",
        name: "Focused Coder",
        readonly: true
      }
    ])
  })

  it("falls back to the built-in name when an override name is blank", () => {
    const nextAgents = upsertAgentProfileOverride({
      agents: baseAgents,
      defaults: coderDefaults,
      patch: {
        name: "   "
      }
    })

    expect(nextAgents.profiles[0]?.name).toBe("Coder")
  })

  it("removes a profile override", () => {
    expect(
      removeAgentProfileOverride({
        agents: {
          ...baseAgents,
          profiles: [
            {
              ...coderDefaults,
              name: "Focused Coder"
            }
          ]
        },
        profileId: "coder"
      }).profiles
    ).toEqual([])
  })
})
