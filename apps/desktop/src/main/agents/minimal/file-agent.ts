import { Agent } from "@mastra/core/agent"
import type { MastraModelConfig } from "@mastra/core/llm"
import { Mastra } from "@mastra/core/mastra"

import { buildDelegateTool } from "@/main/agents/minimal/delegation"
import {
  buildFileTools,
  selectFileTools
} from "@/main/agents/minimal/file-tools"
import {
  buildSaveMemoryTool,
  buildSearchMemoryTool
} from "@/main/agents/minimal/memory-tools"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { getDb } from "@/main/db"
import { resolveModel } from "@/main/server/lib/providers"
import { getSettings } from "@/main/settings"
import { resolveActiveProfile } from "@/shared/agents/profiles"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

export const FILE_AGENT_ID = "file-agent"

export interface FileAgentRequestContext {
  modelId?: string
  profileId?: string
  projectPath: string
  [key: string]: unknown
}

const FILE_AGENT_INSTRUCTIONS = `You are Etyon's local file agent. You work directly on the user's project directory with these tools:

- read: read a text file (line-numbered, supports offset/limit)
- ls: list a directory
- grep: search file contents with ripgrep
- edit: apply exact text replacements to a file (requires user approval)
- write: create or overwrite a file (requires user approval)

Guidelines:
- Paths are relative to the project root. You cannot access files outside it or secret files such as .env or keys.
- Read a file before editing or overwriting it; edits are rejected if the file changed since it was read.
- Keep edits minimal and targeted. Prefer edit over write for existing files.
- After changing files, briefly summarize what changed and why.
- If a tool fails, read the error, adjust, and retry rather than giving up.`

const readRequestContextValue = (
  requestContext: unknown,
  key: string
): unknown => {
  if (requestContext && typeof requestContext === "object") {
    if (
      "get" in requestContext &&
      typeof (requestContext as { get: unknown }).get === "function"
    ) {
      return (requestContext as { get: (key: string) => unknown }).get(key)
    }

    return (requestContext as Record<string, unknown>)[key]
  }

  return undefined
}

const readStringValue = (
  requestContext: unknown,
  key: string
): string | undefined => {
  const value = readRequestContextValue(requestContext, key)

  return typeof value === "string" && value.length > 0 ? value : undefined
}

const requireProjectPath = (requestContext: unknown): string => {
  const projectPath = readStringValue(requestContext, "projectPath")

  if (!projectPath) {
    throw new Error("file-agent requires a projectPath in the request context.")
  }

  return projectPath
}

const resolveRequestProfile = (requestContext: unknown): ResolvedAgentProfile =>
  resolveActiveProfile(
    getSettings().agents,
    readStringValue(requestContext, "profileId") ?? null
  )

const fileAgent = new Agent({
  id: FILE_AGENT_ID,
  instructions: ({ requestContext }) => {
    const profile = resolveRequestProfile(requestContext)

    return profile.instructions.length > 0
      ? `${FILE_AGENT_INSTRUCTIONS}\n\n${profile.instructions}`
      : FILE_AGENT_INSTRUCTIONS
  },
  model: ({ requestContext }) => {
    const profile = resolveRequestProfile(requestContext)
    const requestModelId = readStringValue(requestContext, "modelId")
    const modelId =
      profile.preferredModel.length > 0
        ? profile.preferredModel
        : requestModelId

    // Etyon's resolveModel returns an AI SDK v6 LanguageModel; Mastra's
    // MastraModelConfig union types the same interface from its vendored
    // @ai-sdk/provider copy, so the cast bridges nominally distinct types.
    return resolveModel(modelId) as MastraModelConfig
  },
  name: "Etyon File Agent",
  tools: ({ requestContext }) => {
    const profile = resolveRequestProfile(requestContext)
    const projectPath = requireProjectPath(requestContext)
    const workspace = getWorkspaceCore(projectPath)
    const fileTools = selectFileTools(
      buildFileTools(workspace),
      profile.allowedTools
    )

    const chatSessionId = readStringValue(requestContext, "chatSessionId")
    const parentRunId = readStringValue(requestContext, "agentRunId")

    return {
      ...fileTools,
      // Delegation needs a persisted parent run to attach child runs to;
      // without one (agents disabled or run-start failed) the parent stays
      // solo.
      ...(profile.allowDelegation && chatSessionId && parentRunId
        ? {
            delegate: buildDelegateTool({
              chatSessionId,
              parentModelId: readStringValue(requestContext, "modelId") ?? null,
              parentProfile: profile,
              parentRunId,
              projectPath
            })
          }
        : {}),
      // The project digest (in the system prompt) is the free tier; these
      // cost a network round trip, so they're only offered when memory is
      // on, and only paid when the agent itself calls them.
      ...(getSettings().memory.enabled
        ? {
            save_memory: buildSaveMemoryTool({ db: getDb(), projectPath }),
            search_memory: buildSearchMemoryTool({ db: getDb(), projectPath })
          }
        : {})
    }
  }
})

export const fileAgentMastra = new Mastra({
  agents: {
    [FILE_AGENT_ID]: fileAgent
  }
})
