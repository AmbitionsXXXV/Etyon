import { tool } from "ai"
import { z } from "zod"

import { captureFileCheckpoint } from "@/main/agents/checkpoints"
import type {
  WorkspaceCore,
  WorkspaceFileError
} from "@/main/agents/minimal/workspace-core"
import {
  claimWrite,
  writeClaimConflictMessage
} from "@/main/agents/write-claims"
import { needsFileEditApproval } from "@/shared/agents/permission-mode"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"

const TOOL_OUTPUT_MAX_CHARS = 12_000
const READ_DEFAULT_LINE_LIMIT = 1000

const ReadInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum number of lines to read."),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Line number to start reading from, 1-indexed."),
    path: z
      .string()
      .min(1)
      .describe("Path to the file to read, relative to the project root.")
  })
  .strict()

const LsInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(500)
      .describe("Maximum number of directory entries to return."),
    path: z
      .string()
      .optional()
      .describe("Directory to list; defaults to the project root.")
  })
  .strict()

const GrepInputSchema = z
  .object({
    context: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Number of context lines before and after each match."),
    glob: z
      .string()
      .min(1)
      .optional()
      .describe("Filter searched files by glob, e.g. '*.ts'."),
    ignoreCase: z
      .boolean()
      .optional()
      .describe("Run a case-insensitive search."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(100)
      .describe("Maximum number of matches per file."),
    literal: z
      .boolean()
      .optional()
      .describe("Treat pattern as a literal string instead of a regex."),
    path: z
      .string()
      .optional()
      .describe("Directory or file to search; defaults to the project root."),
    pattern: z.string().min(1).describe("Search pattern.")
  })
  .strict()

export const EditInputSchema = z
  .object({
    edits: z
      .array(
        z
          .object({
            newText: z.string().describe("Replacement text for this edit."),
            oldText: z
              .string()
              .min(1)
              .describe(
                "Exact text to replace; must appear exactly once in the file."
              )
          })
          .strict()
      )
      .min(1),
    path: z
      .string()
      .min(1)
      .describe("Path to the file to edit, relative to the project root.")
  })
  .strict()

export const WriteInputSchema = z
  .object({
    content: z.string().describe("Complete file content to write."),
    path: z
      .string()
      .min(1)
      .describe("Path to the file to write, relative to the project root.")
  })
  .strict()

const clampText = (text: string): { text: string; truncated: boolean } =>
  text.length <= TOOL_OUTPUT_MAX_CHARS
    ? { text, truncated: false }
    : {
        text: `${text.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[... output truncated at ${TOOL_OUTPUT_MAX_CHARS} characters]`,
        truncated: true
      }

const throwWorkspaceError = (error: WorkspaceFileError): never => {
  throw new Error(`${error.message} (${error.code}: ${error.path})`)
}

const applyExactEdits = ({
  content,
  edits
}: {
  content: string
  edits: readonly { newText: string; oldText: string }[]
}): string => {
  let nextContent = content

  for (const { newText, oldText } of edits) {
    const firstIndex = nextContent.indexOf(oldText)

    if (firstIndex === -1) {
      throw new Error(
        `oldText was not found in the file: ${JSON.stringify(truncateForMessage(oldText))}`
      )
    }

    if (nextContent.includes(oldText, firstIndex + 1)) {
      throw new Error(
        `oldText is not unique in the file; add surrounding context: ${JSON.stringify(truncateForMessage(oldText))}`
      )
    }

    nextContent =
      nextContent.slice(0, firstIndex) +
      newText +
      nextContent.slice(firstIndex + oldText.length)
  }

  return nextContent
}

const truncateForMessage = (text: string): string =>
  text.length > 120 ? `${text.slice(0, 120)}…` : text

/**
 * Ownership claim placed by a writable holder (parent = "parent", a child =
 * `childWriteHolder(...)`) before it writes, so parallel writers never clobber a
 * file another one owns. Present only when several writers share a top-level run.
 */
export interface FileWriteClaim {
  holder: string
  topRunId: string
}

interface WriteConflictResult {
  error: string
  path: string
  status: "conflict"
}

/** Claims the path for `writeClaim`; returns a structured error on conflict. */
const claimFileWrite = (
  writeClaim: FileWriteClaim | undefined,
  requestedPath: string
): WriteConflictResult | null => {
  if (!writeClaim) {
    return null
  }

  const claim = claimWrite({
    holder: writeClaim.holder,
    path: requestedPath,
    topRunId: writeClaim.topRunId
  })

  return claim.ok
    ? null
    : {
        error: writeClaimConflictMessage(requestedPath, claim.holder),
        path: requestedPath,
        status: "conflict"
      }
}

const captureFileToolCheckpoint = async ({
  origin,
  requestedPath,
  runId,
  toolCallId,
  workspace
}: {
  origin: "edit" | "write"
  requestedPath: string
  runId: string | undefined
  toolCallId: string | undefined
  workspace: WorkspaceCore
}): Promise<void> => {
  if (!(runId && toolCallId)) {
    return
  }

  await captureFileCheckpoint({
    origin,
    paths: [requestedPath],
    projectPath: workspace.projectPath,
    runId,
    toolCallId
  })
}

/**
 * Applies exact edits and writes the file (throwing the workspace error, exactly
 * like the tool did inline). Exported so a writable delegated child reuses the
 * same edit path as the parent instead of re-implementing it.
 */
export const runWorkspaceEdit = async ({
  edits,
  requestedPath,
  signal,
  workspace
}: {
  edits: readonly { newText: string; oldText: string }[]
  requestedPath: string
  signal?: AbortSignal
  workspace: WorkspaceCore
}): Promise<{ appliedEdits: number; bytesWritten: number; path: string }> => {
  const viewResult = await workspace.view(requestedPath, signal)

  if (!viewResult.ok) {
    return throwWorkspaceError(viewResult.error)
  }

  const editedContent = applyExactEdits({
    content: viewResult.value.content,
    edits
  })
  const writeResult = await workspace.writeFile(requestedPath, editedContent, {
    expectedMtimeMs: viewResult.value.info.mtimeMs,
    ...(signal ? { signal } : {})
  })

  if (!writeResult.ok) {
    return throwWorkspaceError(writeResult.error)
  }

  return {
    appliedEdits: edits.length,
    bytesWritten: writeResult.value.bytesWritten,
    path: writeResult.value.info.path
  }
}

/** Creates/overwrites a file (throwing on workspace error). Exported for reuse
 * by a writable delegated child, mirroring {@link runWorkspaceEdit}. */
export const runWorkspaceWrite = async ({
  content,
  requestedPath,
  signal,
  workspace
}: {
  content: string
  requestedPath: string
  signal?: AbortSignal
  workspace: WorkspaceCore
}): Promise<{ bytesWritten: number; path: string }> => {
  const writeResult = await workspace.writeFile(requestedPath, content, {
    createParentDirectories: true,
    requireReadSnapshot: true,
    ...(signal ? { signal } : {})
  })

  if (!writeResult.ok) {
    return throwWorkspaceError(writeResult.error)
  }

  return {
    bytesWritten: writeResult.value.bytesWritten,
    path: writeResult.value.info.path
  }
}

export const buildFileTools = (
  workspace: WorkspaceCore,
  permissionMode: AgentPermissionMode,
  writeClaim?: FileWriteClaim,
  checkpointRunId?: string
) => ({
  edit: tool({
    description:
      "Apply one or more exact text replacements to a file. Each oldText must appear exactly once. Read the file first to know its current content.",
    execute: async (inputData, context) => {
      const conflict = claimFileWrite(writeClaim, inputData.path)

      if (conflict) {
        return conflict
      }

      await captureFileToolCheckpoint({
        origin: "edit",
        requestedPath: inputData.path,
        runId: checkpointRunId,
        toolCallId: context?.toolCallId,
        workspace
      })
      const result = await runWorkspaceEdit({
        edits: inputData.edits,
        requestedPath: inputData.path,
        workspace,
        ...(context?.abortSignal ? { signal: context.abortSignal } : {})
      })

      return result
    },
    inputSchema: EditInputSchema,
    needsApproval: needsFileEditApproval(permissionMode)
  }),
  grep: tool({
    description:
      "Search file contents in the project with ripgrep. Returns matching lines as 'path:line:text'.",
    execute: async (inputData, context) => {
      const searchResult = await workspace.searchContent({
        ...(inputData.context === undefined
          ? {}
          : { context: inputData.context }),
        ...(inputData.glob === undefined ? {} : { glob: inputData.glob }),
        ...(inputData.ignoreCase === undefined
          ? {}
          : { ignoreCase: inputData.ignoreCase }),
        limit: inputData.limit ?? 100,
        ...(inputData.literal === undefined
          ? {}
          : { literal: inputData.literal }),
        pattern: inputData.pattern,
        ...(inputData.path === undefined
          ? {}
          : { requestedPath: inputData.path }),
        ...(context?.abortSignal ? { signal: context.abortSignal } : {})
      })

      if (!searchResult.ok) {
        throwWorkspaceError(searchResult.error)

        return
      }

      const { text, truncated } = clampText(searchResult.value.trimEnd())

      return {
        matches: text.length > 0 ? text : "(no matches)",
        pattern: inputData.pattern,
        truncated
      }
    },
    inputSchema: GrepInputSchema
  }),
  ls: tool({
    description: "List the entries of a project directory with kind and size.",
    execute: async (inputData, context) => {
      const listResult = await workspace.listDir(
        inputData.path ?? ".",
        context?.abortSignal
      )

      if (!listResult.ok) {
        throwWorkspaceError(listResult.error)

        return
      }

      const entries = listResult.value.slice(0, inputData.limit)

      return {
        entries: entries.map((entry) => ({
          kind: entry.kind,
          name: entry.path,
          size: entry.size
        })),
        path: inputData.path ?? ".",
        truncated: listResult.value.length > entries.length
      }
    },
    inputSchema: LsInputSchema
  }),
  read: tool({
    description:
      "Read a text file from the project. Supports offset/limit for large files; output is line-numbered.",
    execute: async (inputData, context) => {
      const viewResult = await workspace.view(
        inputData.path,
        context?.abortSignal
      )

      if (!viewResult.ok) {
        throwWorkspaceError(viewResult.error)

        return
      }

      const lines = viewResult.value.content.split("\n")
      const offset = inputData.offset ?? 1
      const limit = inputData.limit ?? READ_DEFAULT_LINE_LIMIT
      const selectedLines = lines.slice(offset - 1, offset - 1 + limit)
      const numberedContent = selectedLines
        .map((line, index) => `${offset + index}\t${line}`)
        .join("\n")
      const { text, truncated } = clampText(numberedContent)

      return {
        content: text,
        path: viewResult.value.info.path,
        totalLines: lines.length,
        truncated: truncated || offset - 1 + limit < lines.length
      }
    },
    inputSchema: ReadInputSchema
  }),
  write: tool({
    description:
      "Create or overwrite a file with the given content. Overwriting an existing file requires reading it first.",
    execute: async (inputData, context) => {
      const conflict = claimFileWrite(writeClaim, inputData.path)

      if (conflict) {
        return conflict
      }

      await captureFileToolCheckpoint({
        origin: "write",
        requestedPath: inputData.path,
        runId: checkpointRunId,
        toolCallId: context?.toolCallId,
        workspace
      })
      const result = await runWorkspaceWrite({
        content: inputData.content,
        requestedPath: inputData.path,
        workspace,
        ...(context?.abortSignal ? { signal: context.abortSignal } : {})
      })

      return result
    },
    inputSchema: WriteInputSchema,
    needsApproval: needsFileEditApproval(permissionMode)
  })
})

export type FileTools = ReturnType<typeof buildFileTools>

export type FileTool = FileTools[keyof FileTools]

/** Narrows a tool set to a profile's allowed tool names (e.g. read-only). */
export const selectFileTools = (
  tools: FileTools,
  allowed: readonly string[]
): Record<string, FileTool> => {
  const allowedSet = new Set(allowed)
  const selected: Record<string, FileTool> = {}

  for (const name of Object.keys(tools)) {
    if (allowedSet.has(name)) {
      selected[name] = tools[name as keyof FileTools]
    }
  }

  return selected
}
