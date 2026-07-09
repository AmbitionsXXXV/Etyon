import { tool } from "ai"
import { z } from "zod"

import type {
  WorkspaceCore,
  WorkspaceFileError
} from "@/main/agents/minimal/workspace-core"

/**
 * Publishing tool for the artifacts feature: the agent writes an .html/.md
 * file with the regular write/edit tools (which carry approval), then calls
 * `artifact` to validate the file and surface it in the renderer's preview
 * panel. Re-publishing the same path after an edit is the update flow.
 */

export const ARTIFACT_MAX_BYTES = 2 * 1024 * 1024

export type ArtifactKind = "html" | "markdown"

const ARTIFACT_KIND_BY_EXTENSION = new Map<string, ArtifactKind>([
  [".htm", "html"],
  [".html", "html"],
  [".markdown", "markdown"],
  [".md", "markdown"]
])

const ArtifactInputSchema = z
  .object({
    description: z
      .string()
      .max(500)
      .optional()
      .describe(
        "Optional one-sentence description of what the artifact shows."
      ),
    path: z
      .string()
      .min(1)
      .describe(
        "Path to an existing .html or .md file to publish, relative to the project root."
      ),
    title: z
      .string()
      .min(1)
      .max(120)
      .describe("Short human-readable title shown on the artifact card.")
  })
  .strict()

const throwWorkspaceError = (error: WorkspaceFileError): never => {
  throw new Error(`${error.message} (${error.code}: ${error.path})`)
}

export const getArtifactKind = (path: string): ArtifactKind | null => {
  const normalizedPath = path.toLowerCase()
  const dotIndex = normalizedPath.lastIndexOf(".")

  if (dotIndex === -1) {
    return null
  }

  return ARTIFACT_KIND_BY_EXTENSION.get(normalizedPath.slice(dotIndex)) ?? null
}

export const buildArtifactTool = (workspace: WorkspaceCore) =>
  tool({
    description:
      "Publish an existing .html or .md file from the project as an artifact rendered in the app's preview panel. Write the file first with write/edit; call this again with the same path after editing to update the artifact.",
    execute: async (inputData, context) => {
      const kind = getArtifactKind(inputData.path)

      if (!kind) {
        throw new Error(
          "Artifact path must point to an .html or .md file, e.g. artifacts/report.html."
        )
      }

      const statResult = await workspace.fileStat(
        inputData.path,
        context?.abortSignal
      )

      if (!statResult.ok) {
        throwWorkspaceError(statResult.error)

        return
      }

      if (statResult.value.kind !== "file") {
        throw new Error(
          `Artifact path is not a regular file: ${inputData.path}`
        )
      }

      if (statResult.value.size > ARTIFACT_MAX_BYTES) {
        throw new Error(
          `Artifact file is too large (${statResult.value.size} bytes); the maximum is ${ARTIFACT_MAX_BYTES} bytes.`
        )
      }

      return {
        byteLength: statResult.value.size,
        ...(inputData.description === undefined
          ? {}
          : { description: inputData.description }),
        kind,
        path: statResult.value.path,
        title: inputData.title
      }
    },
    inputSchema: ArtifactInputSchema
  })

export type ArtifactTool = ReturnType<typeof buildArtifactTool>
