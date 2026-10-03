import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import { tool } from "ai"
import { z } from "zod"

import { getAppConfigDir } from "@/main/app-paths"

export const TOOL_RESULT_MAX_BYTES = 512 * 1024
export const TOOL_RESULT_STORE_MAX_BYTES = 32 * 1024 * 1024
export const TOOL_RESULT_TTL_MS = 24 * 60 * 60 * 1000
export const TOOL_RESULT_MAX_PAGE_CHARS = 8192
const DEFAULT_PAGE_CHARS = 2048
const MAX_STORED_FILE_BYTES = TOOL_RESULT_MAX_BYTES * 2 + 4096
const HASH_PATTERN = /^[a-f\d]{64}$/u
const storageQueues = new Map<string, Promise<boolean>>()

const StoredToolResultSchema = z
  .object({
    byteLength: z.number().int().nonnegative().max(TOOL_RESULT_MAX_BYTES),
    content: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    kind: z.enum(["text", "json"]),
    ref: z.string().regex(HASH_PATTERN),
    sessionHash: z.string().regex(HASH_PATTERN)
  })
  .strict()
export interface ToolResultStoreScope {
  sessionId: string
  storageRoot?: string
}
export interface StoredToolResultReference {
  byteLength: number
  expiresAt: string
  kind: "text" | "json"
  ref: string
}

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex")
const getRoot = (storageRoot?: string): string =>
  path.resolve(
    storageRoot ?? path.join(getAppConfigDir(homedir()), "tool-results")
  )
const getRef = (sessionHash: string, kind: string, content: string): string =>
  hash(`${sessionHash}\0${kind}\0${content}`)

const withStorageLock = async <T>(
  root: string,
  execute: () => Promise<T>
): Promise<T> => {
  const previous = storageQueues.get(root) ?? Promise.resolve(true)
  const { promise, resolve } = Promise.withResolvers<boolean>()
  storageQueues.set(root, promise)
  await previous
  try {
    return await execute()
  } finally {
    resolve(true)
    if (storageQueues.get(root) === promise) {
      storageQueues.delete(root)
    }
  }
}

const ensurePrivateDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { mode: 0o700, recursive: true })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Tool result storage directory is unsafe.")
  }
  await chmod(directory, 0o700)
}

const readStored = async (scope: ToolResultStoreScope, ref: string) => {
  if (!HASH_PATTERN.test(ref)) {
    throw new Error("Invalid tool result reference.")
  }
  const sessionHash = hash(scope.sessionId)
  const directory = path.join(getRoot(scope.storageRoot), sessionHash)
  const directoryInfo = await lstat(directory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("Tool result storage directory is unsafe.")
  }
  const handle = await open(
    path.join(directory, `${ref}.json`),
    constants.O_RDONLY + constants.O_NOFOLLOW
  )
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_STORED_FILE_BYTES) {
      throw new Error("Stored tool result is not a bounded regular file.")
    }
    const stored = StoredToolResultSchema.parse(
      JSON.parse(await handle.readFile("utf-8"))
    )
    if (
      stored.ref !== ref ||
      stored.sessionHash !== sessionHash ||
      getRef(sessionHash, stored.kind, stored.content) !== ref ||
      Buffer.byteLength(stored.content) !== stored.byteLength ||
      !Number.isFinite(Date.parse(stored.expiresAt))
    ) {
      throw new Error("Tool result reference integrity check failed.")
    }
    if (Date.parse(stored.expiresAt) <= Date.now()) {
      throw new Error(
        "Stored tool result expired. Inspect the original persisted invocation or a read-only source; do not replay side-effecting commands merely to recover this output."
      )
    }
    return stored
  } finally {
    await handle.close()
  }
}

const inspectStoredFiles = async (
  root: string,
  protectedRefs: ReadonlySet<string>
): Promise<number> => {
  let totalBytes = 0
  for (const session of await readdir(root, { withFileTypes: true })) {
    if (!session.isDirectory() || !HASH_PATTERN.test(session.name)) {
      continue
    }
    const directory = path.join(root, session.name)
    for (const name of await readdir(directory)) {
      const ref = name.slice(0, 64)
      const isTemporary = /^[a-f\d]{64}\.[a-f\d-]{36}\.tmp$/u.test(name)
      if (!HASH_PATTERN.test(ref) || (name !== `${ref}.json` && !isTemporary)) {
        continue
      }
      const file = path.join(directory, name)
      const info = await lstat(file)
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error("Tool result storage contains an unsafe entry.")
      }
      if (
        Date.now() - info.mtimeMs >= TOOL_RESULT_TTL_MS &&
        (isTemporary || !protectedRefs.has(ref))
      ) {
        await rm(file)
        continue
      }
      totalBytes += info.size
    }
  }
  return totalBytes
}

export const saveToolResult = async ({
  output,
  protectedRefs = [],
  ...scope
}: ToolResultStoreScope & {
  output: Extract<ToolResultOutput, { type: "text" | "json" }>
  protectedRefs?: Iterable<string>
}): Promise<StoredToolResultReference> => {
  if (!scope.sessionId) {
    throw new Error("Tool result storage requires a chat session.")
  }
  const serialized = JSON.stringify(output)
  if (Buffer.byteLength(serialized) > TOOL_RESULT_MAX_BYTES) {
    throw new Error(
      "Tool result exceeds the 512 KiB durable result limit. Narrow the original tool request."
    )
  }
  const content =
    output.type === "text" ? output.value : JSON.stringify(output.value)
  const sessionHash = hash(scope.sessionId)
  const ref = getRef(sessionHash, output.type, content)
  const now = new Date()
  const stored = {
    byteLength: Buffer.byteLength(content),
    content,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TOOL_RESULT_TTL_MS).toISOString(),
    kind: output.type,
    ref,
    sessionHash
  }
  const root = getRoot(scope.storageRoot)
  const directory = path.join(root, sessionHash)
  await withStorageLock(root, async () => {
    await ensurePrivateDirectory(root)
    await ensurePrivateDirectory(directory)
    const file = path.join(directory, `${ref}.json`)
    let existingSize = 0
    try {
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error("Tool result destination is unsafe.")
      }
      existingSize = info.size
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        throw error
      }
    }
    const pinned = new Set([...protectedRefs, ref])
    const used = await inspectStoredFiles(root, pinned)
    const payload = JSON.stringify(stored)
    if (
      used - existingSize + Buffer.byteLength(payload) >
      TOOL_RESULT_STORE_MAX_BYTES
    ) {
      throw new Error(
        "Durable tool result storage is full. Existing results were preserved; reduce the original tool output or wait for expiry."
      )
    }
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, payload, { flag: "wx", mode: 0o600 })
      await rename(temporary, file)
    } finally {
      await rm(temporary, { force: true })
    }
  })
  return {
    byteLength: stored.byteLength,
    expiresAt: stored.expiresAt,
    kind: stored.kind,
    ref
  }
}

const getPageEnd = (content: string, offset: number, limit: number): number => {
  if (offset > content.length) {
    throw new Error("Tool result offset exceeds the stored result length.")
  }
  if (offset > 0 && (content.codePointAt(offset - 1) ?? 0) > 0xffff) {
    throw new Error(
      "Tool result offset is inside a Unicode character. Use the previous page's nextOffset."
    )
  }
  let end = Math.min(offset + limit, content.length)
  if (end < content.length && (content.codePointAt(end - 1) ?? 0) > 0xffff) {
    if (end === offset + 1) {
      throw new Error(
        "Tool result page limit is too small for this Unicode character. Request at least two characters."
      )
    }
    end -= 1
  }
  return end
}

export const readToolResultPage = async ({
  limit = DEFAULT_PAGE_CHARS,
  offset = 0,
  ref,
  ...scope
}: ToolResultStoreScope & { limit?: number; offset?: number; ref: string }) => {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > TOOL_RESULT_MAX_PAGE_CHARS
  ) {
    throw new Error(
      "Tool result page requires a nonnegative offset and a limit from 1 to 8192 characters."
    )
  }
  let stored
  try {
    stored = await readStored(scope, ref)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        "Tool result reference is unavailable for this chat or expired.",
        { cause: error }
      )
    }
    throw error
  }
  const end = getPageEnd(stored.content, offset, limit)
  return {
    content: stored.content.slice(offset, end),
    expiresAt: stored.expiresAt,
    kind: stored.kind,
    nextOffset: end < stored.content.length ? end : null,
    offset,
    ref,
    totalLength: stored.content.length
  }
}

export const buildReadToolResultTool = (scope: ToolResultStoreScope) =>
  tool({
    description:
      "Read a stored long tool result from this chat by its exact reference. Returns a bounded text or JSON page. Follow nextOffset for more; default page size is 2048 characters. Earlier page references remain readable until their stated expiry. This does not execute the original tool or expand its permissions.",
    execute: async (input) => await readToolResultPage({ ...input, ...scope }),
    inputSchema: z
      .object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(TOOL_RESULT_MAX_PAGE_CHARS)
          .optional(),
        offset: z.number().int().nonnegative().optional(),
        ref: z.string().regex(HASH_PATTERN)
      })
      .strict()
  })
