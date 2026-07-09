import { tool } from "ai"
import { z } from "zod"

import type {
  WorkspaceCore,
  WorkspaceFileError
} from "@/main/agents/minimal/workspace-core"

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

const EditInputSchema = z
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

const WriteInputSchema = z
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

export const buildFileTools = (workspace: WorkspaceCore) => ({
  edit: tool({
    description:
      "Apply one or more exact text replacements to a file. Each oldText must appear exactly once. Read the file first to know its current content.",
    execute: async (inputData, context) => {
      const { edits, path: requestedPath } = inputData
      const viewResult = await workspace.view(
        requestedPath,
        context?.abortSignal
      )

      if (!viewResult.ok) {
        throwWorkspaceError(viewResult.error)

        return
      }

      const editedContent = applyExactEdits({
        content: viewResult.value.content,
        edits
      })
      const writeResult = await workspace.writeFile(
        requestedPath,
        editedContent,
        {
          expectedMtimeMs: viewResult.value.info.mtimeMs,
          ...(context?.abortSignal ? { signal: context.abortSignal } : {})
        }
      )

      if (!writeResult.ok) {
        throwWorkspaceError(writeResult.error)

        return
      }

      return {
        appliedEdits: edits.length,
        bytesWritten: writeResult.value.bytesWritten,
        path: writeResult.value.info.path
      }
    },
    inputSchema: EditInputSchema,
    needsApproval: true
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
      const writeResult = await workspace.writeFile(
        inputData.path,
        inputData.content,
        {
          createParentDirectories: true,
          requireReadSnapshot: true,
          ...(context?.abortSignal ? { signal: context.abortSignal } : {})
        }
      )

      if (!writeResult.ok) {
        throwWorkspaceError(writeResult.error)

        return
      }

      return {
        bytesWritten: writeResult.value.bytesWritten,
        path: writeResult.value.info.path
      }
    },
    inputSchema: WriteInputSchema,
    needsApproval: true
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
