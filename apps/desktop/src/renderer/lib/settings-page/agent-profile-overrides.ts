import type { AgentProfile, AgentSettings } from "@etyon/rpc"

export const resolveAgentProfileDraft = (
  agents: AgentSettings,
  defaults: AgentProfile
): AgentProfile => {
  const override = agents.profiles.find((profile) => profile.id === defaults.id)

  return override ? { ...defaults, ...override } : defaults
}

const normalizeAgentProfileOverride = (
  profile: AgentProfile,
  defaults: AgentProfile
): AgentProfile => {
  const name = profile.name.trim() || defaults.name

  return {
    allowedDelegateProfileIds: profile.allowedDelegateProfileIds,
    available: profile.available,
    description: profile.description,
    executionMode: profile.executionMode,
    focusAreas: profile.focusAreas,
    id: profile.id,
    instructions: profile.instructions,
    name,
    preferredModel: profile.preferredModel,
    readonly: profile.readonly
  }
}

export const upsertAgentProfileOverride = ({
  agents,
  defaults,
  patch
}: {
  agents: AgentSettings
  defaults: AgentProfile
  patch: Partial<AgentProfile>
}): AgentSettings => {
  const currentProfile = resolveAgentProfileDraft(agents, defaults)
  const nextProfile = normalizeAgentProfileOverride(
    {
      ...currentProfile,
      ...patch
    },
    defaults
  )

  return {
    ...agents,
    profiles: [
      ...agents.profiles.filter((profile) => profile.id !== defaults.id),
      nextProfile
    ]
  }
}

export const removeAgentProfileOverride = ({
  agents,
  profileId
}: {
  agents: AgentSettings
  profileId: string
}): AgentSettings => ({
  ...agents,
  profiles: agents.profiles.filter((profile) => profile.id !== profileId)
})
