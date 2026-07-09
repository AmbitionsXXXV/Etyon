import type { AgentProfile, AgentSettings } from "@etyon/rpc"

import {
  BUILT_IN_PROFILE_I18N_KEY,
  resolveProfileRoster
} from "@/shared/agents/profiles"

export const AGENT_MAX_STEPS_MAX = 200
export const AGENT_MAX_STEPS_MIN = 1

export const clampAgentMaxSteps = (value: number): number =>
  Math.min(
    AGENT_MAX_STEPS_MAX,
    Math.max(AGENT_MAX_STEPS_MIN, Math.round(value))
  )

export const AGENT_CONCURRENT_SUBAGENTS_MAX = 4
export const AGENT_CONCURRENT_SUBAGENTS_MIN = 1

export const clampConcurrentSubagents = (value: number): number =>
  Math.min(
    AGENT_CONCURRENT_SUBAGENTS_MAX,
    Math.max(AGENT_CONCURRENT_SUBAGENTS_MIN, Math.round(value))
  )

export const isBuiltInProfileId = (profileId: string): boolean =>
  profileId in BUILT_IN_PROFILE_I18N_KEY

export interface AgentProfileMetrics {
  active: number
  custom: number
  delegation: number
}

/** Counts shown in the settings roster metric cards. */
export const getAgentProfileMetrics = (
  agents: AgentSettings
): AgentProfileMetrics => {
  const roster = resolveProfileRoster(agents)

  return {
    active: roster.filter((profile) => profile.available).length,
    custom: roster.filter((profile) => !isBuiltInProfileId(profile.id)).length,
    delegation: roster.filter(
      (profile) =>
        !profile.readonly && profile.allowedDelegateProfileIds.length > 0
    ).length
  }
}

/**
 * Upserts a profile override carrying the new availability flag. Toggling a
 * built-in seeds a full override (matching its current data) so the roster keeps
 * rendering it; toggling an existing custom profile updates it in place.
 */
export const setAgentProfileAvailability = (
  agents: AgentSettings,
  profile: AgentProfile,
  available: boolean
): AgentProfile[] => {
  const nextProfile: AgentProfile = { ...profile, available }
  const existingIndex = agents.profiles.findIndex(
    (entry) => entry.id === profile.id
  )

  if (existingIndex === -1) {
    return [...agents.profiles, nextProfile]
  }

  return agents.profiles.map((entry, index) =>
    index === existingIndex ? nextProfile : entry
  )
}
