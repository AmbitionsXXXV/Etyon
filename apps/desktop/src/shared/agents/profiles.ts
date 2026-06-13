import type {
  AgentExecutionMode,
  AgentProfile,
  AgentSettings
} from "@etyon/rpc"

import {
  BUILT_IN_PROFILE_I18N_KEY,
  BUILT_IN_PROFILES
} from "./built-in/registry"

/**
 * Profile-aware runtime layer over the single Mastra file agent.
 *
 * Built-in profiles give chat routing a stable roster of specialist behaviors
 * (instructions, tool policy, model policy) without registering a separate
 * Mastra agent per profile. The active profile is resolved from
 * `settings.agents.defaultProfileId` (or an explicit request override) and the
 * user's `settings.agents.profiles` overrides are layered on top by id.
 */

export type FileToolName = "edit" | "grep" | "ls" | "read" | "write"

export const READONLY_FILE_TOOLS: readonly FileToolName[] = [
  "read",
  "ls",
  "grep"
]
export const WRITE_FILE_TOOLS: readonly FileToolName[] = [
  "read",
  "ls",
  "grep",
  "edit",
  "write"
]

export interface ResolvedAgentProfile {
  allowDelegation: boolean
  allowedDelegateProfileIds: readonly string[]
  allowedTools: readonly FileToolName[]
  available: boolean
  executionMode: AgentExecutionMode
  id: string
  instructions: string
  name: string
  preferredModel: string
  readonly: boolean
}

// Built-in profile definitions live in `built-in/<id>.ts`, aggregated by the
// registry and re-exported here so consumers import the whole profiles surface
// from one module.
export { BUILT_IN_PROFILE_I18N_KEY, BUILT_IN_PROFILES }

const FALLBACK_PROFILE = BUILT_IN_PROFILES[0] as AgentProfile

/**
 * Built-in roster with the user's `settings.agents.profiles` overlaid by id.
 * A stored profile fully replaces a built-in with the same id (the settings UI
 * seeds an override from the built-in before editing), and unknown ids are
 * appended as custom profiles.
 */
export const resolveProfileRoster = (
  settings: AgentSettings
): AgentProfile[] => {
  const byId = new Map<string, AgentProfile>()

  for (const profile of BUILT_IN_PROFILES) {
    byId.set(profile.id, profile)
  }

  for (const profile of settings.profiles) {
    byId.set(profile.id, profile)
  }

  return [...byId.values()]
}

const toResolvedProfile = (
  profile: AgentProfile,
  settings: AgentSettings
): ResolvedAgentProfile => ({
  allowDelegation:
    settings.allowSubagentDelegation &&
    !profile.readonly &&
    profile.allowedDelegateProfileIds.length > 0,
  allowedDelegateProfileIds: profile.allowedDelegateProfileIds,
  allowedTools: profile.readonly ? READONLY_FILE_TOOLS : WRITE_FILE_TOOLS,
  available: profile.available,
  executionMode: profile.executionMode,
  id: profile.id,
  instructions: profile.instructions,
  name: profile.name,
  preferredModel: profile.preferredModel,
  readonly: profile.readonly
})

/**
 * Resolves the profile that should run this turn. Falls back to the first
 * available profile when the requested or default id is missing or disabled, so
 * a disabled `defaultProfileId` can never be used for routing.
 */
export const resolveActiveProfile = (
  settings: AgentSettings,
  requestedProfileId?: string | null
): ResolvedAgentProfile => {
  const roster = resolveProfileRoster(settings)
  const fallback =
    roster.find((profile) => profile.available) ?? FALLBACK_PROFILE
  const requestedId = requestedProfileId ?? settings.defaultProfileId
  const picked =
    roster.find((profile) => profile.id === requestedId && profile.available) ??
    fallback

  return toResolvedProfile(picked, settings)
}

/**
 * Resolves a named profile for delegation targets. Returns null when the id is
 * unknown or the profile is unavailable.
 */
export const resolveProfileById = (
  settings: AgentSettings,
  profileId: string
): ResolvedAgentProfile | null => {
  const profile = resolveProfileRoster(settings).find(
    (entry) => entry.id === profileId && entry.available
  )

  return profile ? toResolvedProfile(profile, settings) : null
}
