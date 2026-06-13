import { AgentProfileSchema, AgentSettingsSchema } from "@etyon/rpc"
import type { AgentProfile, AgentSettings } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  READONLY_FILE_TOOLS,
  WRITE_FILE_TOOLS,
  resolveActiveProfile,
  resolveProfileById,
  resolveProfileRoster
} from "@/shared/agents/profiles"

const makeSettings = (overrides: Partial<AgentSettings> = {}): AgentSettings =>
  AgentSettingsSchema.parse({ ...overrides })

const makeProfile = (overrides: Partial<AgentProfile>): AgentProfile =>
  AgentProfileSchema.parse(overrides)

describe("agent profiles", () => {
  it("defaults to a write-capable general-purpose profile", () => {
    const profile = resolveActiveProfile(makeSettings())

    expect(profile.id).toBe("general-purpose")
    expect(profile.readonly).toBe(false)
    expect([...profile.allowedTools]).toEqual([...WRITE_FILE_TOOLS])
  })

  it("routes to the configured default profile", () => {
    const profile = resolveActiveProfile(
      makeSettings({ defaultProfileId: "explore" })
    )

    expect(profile.id).toBe("explore")
    expect(profile.readonly).toBe(true)
  })

  it("filters read-only profiles down to read-only tools", () => {
    const profile = resolveActiveProfile(
      makeSettings({ defaultProfileId: "plan" })
    )

    expect(profile.readonly).toBe(true)
    expect([...profile.allowedTools]).toEqual([...READONLY_FILE_TOOLS])
    expect(profile.allowedTools).not.toContain("edit")
    expect(profile.allowedTools).not.toContain("write")
  })

  it("never routes to a disabled default profile", () => {
    const settings = makeSettings({
      defaultProfileId: "explore",
      profiles: [
        makeProfile({ available: false, id: "explore", name: "Explore" })
      ]
    })

    const profile = resolveActiveProfile(settings)

    expect(profile.available).toBe(true)
    expect(profile.id).not.toBe("explore")
  })

  it("ignores a requested profile that is disabled", () => {
    const settings = makeSettings({
      profiles: [makeProfile({ available: false, id: "coder", name: "Coder" })]
    })

    const profile = resolveActiveProfile(settings, "coder")

    expect(profile.id).not.toBe("coder")
  })

  it("inherits the chat model when preferredModel is empty", () => {
    const profile = resolveActiveProfile(makeSettings())

    expect(profile.preferredModel).toBe("")
  })

  it("carries an explicit preferred model from a custom profile", () => {
    const settings = makeSettings({
      defaultProfileId: "specialist",
      profiles: [
        makeProfile({
          id: "specialist",
          name: "Specialist",
          preferredModel: "anthropic/claude-opus-4-8"
        })
      ]
    })

    const profile = resolveActiveProfile(settings)

    expect(profile.id).toBe("specialist")
    expect(profile.preferredModel).toBe("anthropic/claude-opus-4-8")
  })

  it("only allows delegation for write profiles when the setting is on", () => {
    const enabled = resolveActiveProfile(
      makeSettings({ allowSubagentDelegation: true })
    )
    const disabled = resolveActiveProfile(
      makeSettings({ allowSubagentDelegation: false })
    )
    const readonly = resolveActiveProfile(
      makeSettings({
        allowSubagentDelegation: true,
        defaultProfileId: "explore"
      })
    )

    expect(enabled.allowDelegation).toBe(true)
    expect(disabled.allowDelegation).toBe(false)
    expect(readonly.allowDelegation).toBe(false)
  })

  it("overlays custom profiles onto the built-in roster by id", () => {
    const settings = makeSettings({
      profiles: [
        makeProfile({
          description: "Custom coder",
          id: "coder",
          name: "Custom Coder"
        }),
        makeProfile({ id: "custom", name: "Custom" })
      ]
    })

    const roster = resolveProfileRoster(settings)
    const coder = roster.find((profile) => profile.id === "coder")

    expect(coder?.name).toBe("Custom Coder")
    expect(roster.some((profile) => profile.id === "custom")).toBe(true)
    expect(roster.some((profile) => profile.id === "general-purpose")).toBe(
      true
    )
  })

  it("resolves delegate targets and rejects unknown or disabled ones", () => {
    const settings = makeSettings()

    expect(resolveProfileById(settings, "explore")?.id).toBe("explore")
    expect(resolveProfileById(settings, "does-not-exist")).toBeNull()
  })
})
