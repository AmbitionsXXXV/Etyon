import type { ToolSet } from "ai"

import { buildArtifactTool } from "@/main/agents/minimal/artifact-tool"
import { buildDelegateTool } from "@/main/agents/minimal/delegation"
import {
  buildFileTools,
  selectFileTools
} from "@/main/agents/minimal/file-tools"
import { buildImagenTool } from "@/main/agents/minimal/imagen-tool"
import {
  buildSaveMemoryTool,
  buildSearchMemoryTool
} from "@/main/agents/minimal/memory-tools"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { getDb } from "@/main/db"
import { isImageGenerationAvailable } from "@/main/server/lib/providers"
import { getSettings } from "@/main/settings"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

/**
 * System prompt and tool set for the self-owned agent loop. This replaces the
 * Mastra `Agent` registration: the loop consumes a plain AI SDK `ToolSet`, and
 * profile policy (readonly, delegation, memory) is applied here at build time.
 */

export const AGENT_BASE_INSTRUCTIONS = `You are Etyon's local file agent. You work directly on the user's project directory with these tools:

- read: read a text file (line-numbered, supports offset/limit)
- ls: list a directory
- grep: search file contents with ripgrep
- edit: apply exact text replacements to a file (requires user approval)
- write: create or overwrite a file (requires user approval)
- artifact: publish an .html or .md file from the project as a rendered artifact in the app's preview panel
- imagen: generate an image from a text prompt; it renders inline in the chat message (available when an OpenAI provider is configured)

Guidelines:
- Paths are relative to the project root. You cannot access files outside it or secret files such as .env or keys.
- Read a file before editing or overwriting it; edits are rejected if the file changed since it was read.
- Keep edits minimal and targeted. Prefer edit over write for existing files.
- After changing files, briefly summarize what changed and why.
- If a tool fails, read the error, adjust, and retry rather than giving up.

Turn discipline:
- Keep working until the user's request is fully handled; end your turn only when the task is done or you are genuinely blocked on the user.
- Never end your turn right after announcing an action ("先确认…", "let me check…"). If you say you will do something, do it in the same turn by calling the tool.
- If you cannot proceed (missing capability, denied approval), say so explicitly and give your best final answer instead of promising future work.

Artifacts:
- Use an artifact for substantial, self-contained deliverables meant to be viewed rather than read as chat text — reports, dashboards, visualizations, documents. Keep explanations and short snippets in chat; when in doubt, do not create an artifact.
- Write the content to a file under artifacts/ (e.g. artifacts/report.html), then call artifact with its path and a short title. To update it, edit the file and call artifact again with the same path.
- HTML artifacts render in a sandboxed preview with no network access: write a complete, fully self-contained document — inline all CSS and JavaScript, embed images as data: URIs, never reference external scripts, stylesheets, fonts, or images.
- Support light and dark themes: honor the prefers-color-scheme media query and a data-theme attribute ("dark" or "light") set on the root element.

Images (when the imagen tool is available):
- Call imagen to generate an image from a text prompt; it saves the image under generated-images/ and shows it inline in the chat message. You do not need an image model selected — imagen handles that itself.
- Write a vivid, specific prompt (subject, style, composition, lighting). When the user's request is underspecified, choose sensible defaults rather than asking; only ask if the request is genuinely ambiguous.
- Generate one image per call; call again for variations or alternatives.
- After generating, describe in one sentence what you made — do not repeat the full prompt.`

export const buildAgentSystemPrompt = (profile: ResolvedAgentProfile): string =>
  profile.instructions.length > 0
    ? `${AGENT_BASE_INSTRUCTIONS}\n\n${profile.instructions}`
    : AGENT_BASE_INSTRUCTIONS

export interface BuildAgentToolsetOptions {
  agentRunId: string | null
  chatSessionId: string | null
  modelId: string | null
  profile: ResolvedAgentProfile
  projectPath: string
}

export const buildAgentToolset = ({
  agentRunId,
  chatSessionId,
  modelId,
  profile,
  projectPath
}: BuildAgentToolsetOptions): ToolSet => {
  const workspace = getWorkspaceCore(projectPath)
  const fileTools = selectFileTools(
    buildFileTools(workspace),
    profile.allowedTools
  )

  return {
    ...fileTools,
    // Publishing is read-only on the filesystem, but the write-then-publish
    // flow only makes sense for profiles that can create the file.
    ...(profile.readonly ? {} : { artifact: buildArtifactTool(workspace) }),
    // Image generation writes a file, so it follows the same writable-profile
    // rule, and additionally needs a usable OpenAI provider for the Images API.
    ...(profile.readonly || !isImageGenerationAvailable()
      ? {}
      : { imagen: buildImagenTool(workspace) }),
    // Delegation needs a persisted parent run to attach child runs to; without
    // one (agents disabled or run-start failed) the parent stays solo.
    ...(profile.allowDelegation && chatSessionId && agentRunId
      ? {
          delegate: buildDelegateTool({
            chatSessionId,
            parentModelId: modelId,
            parentProfile: profile,
            parentRunId: agentRunId,
            projectPath
          })
        }
      : {}),
    // The project digest (in the system prompt) is the free tier; these cost a
    // network round trip, so they're only offered when memory is on, and only
    // paid when the agent itself calls them.
    ...(getSettings().memory.enabled
      ? {
          save_memory: buildSaveMemoryTool({ db: getDb(), projectPath }),
          search_memory: buildSearchMemoryTool({ db: getDb(), projectPath })
        }
      : {})
  }
}
