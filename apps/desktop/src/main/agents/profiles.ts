import type { AgentProfile } from "@etyon/rpc"

import {
  CODE_AGENT_LSP_TOOL_ALIASES,
  CODE_AGENT_READONLY_TOOL_ALIASES,
  CODE_AGENT_TOOL_ALIASES
} from "@/main/agents/code-agent-tool-aliases"
import { compileAgentToolNames } from "@/main/agents/tool-policy"
import type { AgentProfileId, ManagedAgentProfile } from "@/main/agents/types"

export const BUILT_IN_AGENT_PROFILE_IDS = [
  "general-purpose",
  "explore",
  "plan",
  "coder",
  "review",
  "harness-operator"
] as const satisfies readonly AgentProfileId[]

const createReadonlyAgentToolPolicy = (
  allowedToolNames: readonly ManagedAgentProfile["toolPolicy"]["allowedToolNames"][number][] = CODE_AGENT_READONLY_TOOL_ALIASES
): ManagedAgentProfile["toolPolicy"] => ({
  allowWrites: false,
  allowedToolNames: compileAgentToolNames({
    allowedToolNames,
    restrictToSafeTools: true
  }),
  requireApprovalForWrites: true
})

export const BUILT_IN_AGENT_PROFILES = [
  {
    allowedDelegateProfileIds: [],
    available: true,
    budgetPolicy: {
      maxSteps: 8
    },
    delegationPolicy: {
      allowedDelegateProfileIds: [],
      canDelegate: false
    },
    description: "Default chat and lightweight project analysis.",
    executionMode: "generalist",
    focusAreas: ["conversation", "project context", "lightweight analysis"],
    id: "general-purpose",
    instructions:
      "Act as a careful general-purpose assistant. Use read-only project tools only when they reduce uncertainty, and keep the chat viewport as the primary interaction surface.",
    modelPolicy: {
      preferredModel: ""
    },
    name: "General Purpose",
    preferredModel: "",
    readonly: true,
    toolPolicy: {
      allowWrites: false,
      allowedToolNames: [...CODE_AGENT_READONLY_TOOL_ALIASES],
      requireApprovalForWrites: true
    }
  },
  {
    allowedDelegateProfileIds: [],
    available: true,
    budgetPolicy: {
      maxSteps: 8
    },
    delegationPolicy: {
      allowedDelegateProfileIds: [],
      canDelegate: false
    },
    description: "Explores the codebase and locates relevant files.",
    executionMode: "generalist",
    focusAreas: ["code search", "file reading", "project structure"],
    id: "explore",
    instructions:
      "Explore the local project with read-only tools. Return concrete file references and concise findings instead of broad speculation.",
    modelPolicy: {
      preferredModel: ""
    },
    name: "Explore",
    preferredModel: "",
    readonly: true,
    toolPolicy: {
      allowWrites: false,
      allowedToolNames: [
        ...CODE_AGENT_READONLY_TOOL_ALIASES,
        ...CODE_AGENT_LSP_TOOL_ALIASES
      ],
      requireApprovalForWrites: true
    }
  },
  {
    allowedDelegateProfileIds: ["coder", "explore"],
    available: true,
    budgetPolicy: {
      maxSteps: 10
    },
    delegationPolicy: {
      allowedDelegateProfileIds: ["coder", "explore"],
      canDelegate: true
    },
    description: "Turns goals into scoped plans and implementation slices.",
    executionMode: "plan",
    focusAreas: ["requirements", "sequencing", "risk control"],
    id: "plan",
    instructions:
      "Plan work from evidence. Prefer narrow, verifiable phases and delegate exploration only when the caller enabled delegation.",
    modelPolicy: {
      preferredModel: ""
    },
    name: "Plan",
    preferredModel: "",
    readonly: true,
    toolPolicy: {
      allowWrites: false,
      allowedToolNames: [
        ...CODE_AGENT_READONLY_TOOL_ALIASES,
        "requestAccess",
        "agentCoder",
        "agentExplore"
      ],
      requireApprovalForWrites: true
    }
  },
  {
    allowedDelegateProfileIds: ["explore", "plan", "review"],
    available: true,
    budgetPolicy: {
      maxSteps: 12
    },
    delegationPolicy: {
      allowedDelegateProfileIds: ["explore", "plan", "review"],
      canDelegate: true
    },
    description: "Implements small, bounded changes with validation.",
    executionMode: "coder",
    focusAreas: ["implementation", "tests", "technical debt"],
    id: "coder",
    instructions:
      "Implement tightly scoped changes. Use patches and checks only through permissioned tools, and explain verification gaps plainly.",
    modelPolicy: {
      preferredModel: ""
    },
    name: "Coder",
    preferredModel: "",
    readonly: false,
    toolPolicy: {
      allowWrites: true,
      allowedToolNames: [
        ...CODE_AGENT_TOOL_ALIASES,
        ...CODE_AGENT_LSP_TOOL_ALIASES,
        "requestAccess",
        "agentExplore",
        "agentPlan",
        "agentReview"
      ],
      requireApprovalForWrites: true
    }
  },
  {
    allowedDelegateProfileIds: [],
    available: true,
    budgetPolicy: {
      maxSteps: 8
    },
    delegationPolicy: {
      allowedDelegateProfileIds: [],
      canDelegate: false
    },
    description: "Reviews diffs and finds behavioral risks.",
    executionMode: "generalist",
    focusAreas: ["diff review", "risk", "test gaps"],
    id: "review",
    instructions:
      "Review code like a senior engineer. Lead with concrete findings, cite files, and do not modify code.",
    modelPolicy: {
      preferredModel: ""
    },
    name: "Review",
    preferredModel: "",
    readonly: true,
    toolPolicy: {
      allowWrites: false,
      allowedToolNames: [
        ...CODE_AGENT_READONLY_TOOL_ALIASES,
        ...CODE_AGENT_LSP_TOOL_ALIASES
      ],
      requireApprovalForWrites: true
    }
  },
  {
    allowedDelegateProfileIds: [],
    available: true,
    budgetPolicy: {
      maxSteps: 8
    },
    delegationPolicy: {
      allowedDelegateProfileIds: [],
      canDelegate: false
    },
    description: "Inspects agent runs, events, and harness behavior.",
    executionMode: "operator",
    focusAreas: ["agent events", "tool loop", "runtime diagnostics"],
    id: "harness-operator",
    instructions:
      "Debug the agent harness itself. Prefer event evidence and read-only inspection over speculative fixes.",
    modelPolicy: {
      preferredModel: ""
    },
    name: "Harness Operator",
    preferredModel: "",
    readonly: true,
    toolPolicy: {
      allowWrites: false,
      allowedToolNames: ["agentEventsSearch", "agentRunInspect"],
      requireApprovalForWrites: true
    }
  }
] as const satisfies readonly ManagedAgentProfile[]

const createProfileMap = (): Map<string, ManagedAgentProfile> =>
  new Map(BUILT_IN_AGENT_PROFILES.map((profile) => [profile.id, profile]))

const builtInProfilesById = createProfileMap()

const DEFAULT_AGENT_PROFILE_ID = "general-purpose"

const buildCustomProfile = (profile: AgentProfile): ManagedAgentProfile => ({
  ...profile,
  budgetPolicy: {
    maxSteps: 8
  },
  delegationPolicy: {
    allowedDelegateProfileIds: profile.allowedDelegateProfileIds,
    canDelegate: profile.allowedDelegateProfileIds.length > 0
  },
  modelPolicy: {
    preferredModel: profile.preferredModel
  },
  readonly: true,
  toolPolicy: createReadonlyAgentToolPolicy()
})

const mergeProfileOverride = (
  profile: ManagedAgentProfile,
  override?: AgentProfile
): ManagedAgentProfile => {
  if (!override) {
    return profile
  }

  return {
    ...profile,
    allowedDelegateProfileIds: override.allowedDelegateProfileIds,
    available: override.available,
    description: override.description || profile.description,
    executionMode: override.executionMode,
    focusAreas:
      override.focusAreas.length > 0 ? override.focusAreas : profile.focusAreas,
    instructions: override.instructions || profile.instructions,
    modelPolicy: {
      preferredModel: override.preferredModel
    },
    name: override.name || profile.name,
    preferredModel: override.preferredModel,
    readonly: override.readonly,
    delegationPolicy: {
      allowedDelegateProfileIds: override.allowedDelegateProfileIds,
      canDelegate: override.allowedDelegateProfileIds.length > 0
    },
    ...(override.readonly
      ? {
          toolPolicy: createReadonlyAgentToolPolicy(
            profile.toolPolicy.allowedToolNames
          )
        }
      : {})
  }
}

const resolveProfileCandidate = (
  builtInProfile: ManagedAgentProfile | undefined,
  override?: AgentProfile
): ManagedAgentProfile | undefined => {
  if (builtInProfile) {
    return mergeProfileOverride(builtInProfile, override)
  }

  if (override) {
    return buildCustomProfile(override)
  }

  return undefined
}

export const getAgentProfileById = (profileId: string): ManagedAgentProfile => {
  const profile = builtInProfilesById.get(profileId)

  if (!profile) {
    throw new Error(`Unknown agent profile: ${profileId}`)
  }

  return profile
}

export const resolveActiveAgentProfile = (
  settings: { defaultProfileId: string; profiles: AgentProfile[] },
  profileId = settings.defaultProfileId
): ManagedAgentProfile => {
  const override = settings.profiles.find((profile) => profile.id === profileId)
  const builtInProfile = builtInProfilesById.get(profileId)
  const candidate = resolveProfileCandidate(builtInProfile, override)

  if (candidate?.available) {
    return candidate
  }

  const defaultOverride = settings.profiles.find(
    (profile) => profile.id === DEFAULT_AGENT_PROFILE_ID
  )
  const defaultProfile = mergeProfileOverride(
    getAgentProfileById(DEFAULT_AGENT_PROFILE_ID),
    defaultOverride
  )

  if (defaultProfile.available) {
    return defaultProfile
  }

  return (
    BUILT_IN_AGENT_PROFILES.find((profile) => profile.available) ??
    getAgentProfileById(DEFAULT_AGENT_PROFILE_ID)
  )
}
