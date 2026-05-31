import type { ManagedAgentProfile } from "@/main/agents/types"

export type AgentModelRouteReason = "fallback" | "implicit" | "profile" | "user"

export interface AgentModelRoute {
  fallbackChain: string[]
  modelId: null | string
  profileId: string
  reason: AgentModelRouteReason
  stepKind: null | string
}

export interface ResolveAgentModelRouteOptions {
  fallbackChain?: readonly (null | string | undefined)[]
  profile: Pick<ManagedAgentProfile, "id" | "modelPolicy">
  stepKind?: string
  userSelectedModel?: null | string
}

export const getAgentModelFallbackCandidates = (
  route: AgentModelRoute
): string[] => {
  const candidates: string[] = []

  for (const modelId of route.fallbackChain) {
    if (modelId !== route.modelId && !candidates.includes(modelId)) {
      candidates.push(modelId)
    }
  }

  return candidates
}

const normalizeModelId = (modelId?: null | string): null | string => {
  const normalized = modelId?.trim()

  return normalized || null
}

const normalizeFallbackChain = (
  fallbackChain: readonly (null | string | undefined)[]
): string[] => {
  const normalizedChain: string[] = []

  for (const modelId of fallbackChain) {
    const normalizedModelId = normalizeModelId(modelId)

    if (normalizedModelId) {
      normalizedChain.push(normalizedModelId)
    }
  }

  return normalizedChain
}

export const resolveAgentModelRoute = ({
  fallbackChain = [],
  profile,
  stepKind,
  userSelectedModel
}: ResolveAgentModelRouteOptions): AgentModelRoute => {
  const normalizedFallbackChain = normalizeFallbackChain(fallbackChain)
  const profileModel = normalizeModelId(profile.modelPolicy.preferredModel)
  const userModel = normalizeModelId(userSelectedModel)
  const fallbackModel = normalizedFallbackChain[0] ?? null
  const stepKindValue = normalizeModelId(stepKind)

  if (profileModel) {
    return {
      fallbackChain: normalizedFallbackChain,
      modelId: profileModel,
      profileId: profile.id,
      reason: "profile",
      stepKind: stepKindValue
    }
  }

  if (userModel) {
    return {
      fallbackChain: normalizedFallbackChain,
      modelId: userModel,
      profileId: profile.id,
      reason: "user",
      stepKind: stepKindValue
    }
  }

  if (fallbackModel) {
    return {
      fallbackChain: normalizedFallbackChain,
      modelId: fallbackModel,
      profileId: profile.id,
      reason: "fallback",
      stepKind: stepKindValue
    }
  }

  return {
    fallbackChain: normalizedFallbackChain,
    modelId: null,
    profileId: profile.id,
    reason: "implicit",
    stepKind: stepKindValue
  }
}
