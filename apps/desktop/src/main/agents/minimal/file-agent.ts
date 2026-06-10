import { Agent } from "@mastra/core/agent"
import type { MastraModelConfig } from "@mastra/core/llm"
import { Mastra } from "@mastra/core/mastra"

import { buildFileTools } from "@/main/agents/minimal/file-tools"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { resolveModel } from "@/main/server/lib/providers"

export const FILE_AGENT_ID = "file-agent"

export interface FileAgentRequestContext {
  modelId?: string
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

const requireProjectPath = (requestContext: unknown): string => {
  const projectPath = readRequestContextValue(requestContext, "projectPath")

  if (typeof projectPath !== "string" || projectPath.length === 0) {
    throw new Error("file-agent requires a projectPath in the request context.")
  }

  return projectPath
}

const fileAgent = new Agent({
  id: FILE_AGENT_ID,
  instructions: FILE_AGENT_INSTRUCTIONS,
  model: ({ requestContext }) => {
    const modelId = readRequestContextValue(requestContext, "modelId")

    // Etyon's resolveModel returns an AI SDK v6 LanguageModel; Mastra's
    // MastraModelConfig union types the same interface from its vendored
    // @ai-sdk/provider copy, so the cast bridges nominally distinct types.
    return resolveModel(
      typeof modelId === "string" ? modelId : undefined
    ) as MastraModelConfig
  },
  name: "Etyon File Agent",
  tools: ({ requestContext }) =>
    buildFileTools(getWorkspaceCore(requireProjectPath(requestContext)))
})

export const fileAgentMastra = new Mastra({
  agents: {
    [FILE_AGENT_ID]: fileAgent
  }
})
