import { createHash } from "node:crypto"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  utimes,
  writeFile
} from "node:fs/promises"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"

import {
  buildReadToolResultTool,
  readToolResultPage,
  saveToolResult,
  TOOL_RESULT_MAX_BYTES,
  TOOL_RESULT_STORE_MAX_BYTES,
  TOOL_RESULT_TTL_MS
} from "@/main/agents/tool-result-store"

let root: string
beforeEach(async () => {
  root = await mkdtemp("/private/tmp/etyon-tool-result-store-")
})
afterEach(async () => {
  await rm(root, { force: true, recursive: true })
})
const scope = () => ({
  sessionId: "session",
  storageRoot: path.join(root, "results")
})
const storedPath = (ref: string, sessionId = "session"): string =>
  path.join(
    scope().storageRoot,
    createHash("sha256").update(sessionId).digest("hex"),
    `${ref}.json`
  )

describe("chat-scoped durable tool results", () => {
  it("stores private files and reconstructs the complete result through bounded pages", async () => {
    const body = `${"前文😀".repeat(1000)}ending evidence`
    const saved = await saveToolResult({
      ...scope(),
      output: { type: "text", value: body }
    })
    expect(saved.ref).toMatch(/^[a-f\d]{64}$/u)
    const directory = await lstat(path.dirname(storedPath(saved.ref)))
    const file = await lstat(storedPath(saved.ref))
    expect(directory.mode % 0o1000).toBe(0o700)
    expect(file.mode % 0o1000).toBe(0o600)
    let restored = ""
    let offset: number | null = 0
    while (offset !== null) {
      const page = await readToolResultPage({
        ...scope(),
        limit: 101,
        offset,
        ref: saved.ref
      })
      expect(page.content.length).toBeLessThanOrEqual(101)
      restored += page.content
      offset = page.nextOffset
    }
    expect(restored).toBe(body)
    await expect(
      readToolResultPage({ ...scope(), limit: 2, offset: 3, ref: saved.ref })
    ).rejects.toThrow("Unicode character")
    await expect(
      readToolResultPage({ ...scope(), limit: 1, offset: 2, ref: saved.ref })
    ).rejects.toThrow("too small")
    const emoji = await readToolResultPage({
      ...scope(),
      limit: 2,
      offset: 2,
      ref: saved.ref
    })
    expect(emoji.content).toBe("😀")
  })

  it("keeps JSON exact, refuses cross-chat references and rejects path traversal and oversized pages", async () => {
    const value = { evidence: "important fact", numbers: [1, 2, 3] }
    const saved = await saveToolResult({
      ...scope(),
      output: { type: "json", value }
    })
    const page = await readToolResultPage({ ...scope(), ref: saved.ref })
    expect(JSON.parse(page.content)).toEqual(value)
    await expect(
      readToolResultPage({
        ...scope(),
        ref: saved.ref,
        sessionId: "another-chat"
      })
    ).rejects.toThrow("unavailable for this chat")
    await expect(
      readToolResultPage({ ...scope(), ref: "../outside" })
    ).rejects.toThrow("Invalid tool result reference")
    await expect(
      readToolResultPage({ ...scope(), limit: 8193, ref: saved.ref })
    ).rejects.toThrow("8192")
    await expect(
      readToolResultPage({ ...scope(), offset: 1_000_000, ref: saved.ref })
    ).rejects.toThrow("offset exceeds")
    await expect(
      saveToolResult({
        ...scope(),
        output: { type: "text", value: "x".repeat(TOOL_RESULT_MAX_BYTES) }
      })
    ).rejects.toThrow("512 KiB")
  })

  it("binds the read tool to its chat even when a direct caller supplies extra scope fields", async () => {
    const saved = await saveToolResult({
      ...scope(),
      output: { type: "text", value: "foreign chat body" },
      sessionId: "foreign"
    })
    const definition = buildReadToolResultTool(scope())
    if (!definition.execute) {
      throw new Error("Expected a read tool.")
    }
    const input = {
      ref: saved.ref,
      sessionId: "foreign",
      storageRoot: scope().storageRoot
    }
    await expect(
      definition.execute(input, {
        context: {},
        messages: [],
        toolCallId: "read-ref"
      })
    ).rejects.toThrow("unavailable for this chat")
  })

  it("refuses tampered or symlinked references", async () => {
    const saved = await saveToolResult({
      ...scope(),
      output: { type: "text", value: "evidence" }
    })
    const record = JSON.parse(await readFile(storedPath(saved.ref), "utf-8"))
    await writeFile(
      storedPath(saved.ref),
      JSON.stringify({ ...record, content: "tampered" })
    )
    await expect(
      readToolResultPage({ ...scope(), ref: saved.ref })
    ).rejects.toThrow("integrity")
    await rm(storedPath(saved.ref))
    await writeFile(path.join(root, "outside.txt"), "private external data")
    await symlink(path.join(root, "outside.txt"), storedPath(saved.ref))
    await expect(
      readToolResultPage({ ...scope(), ref: saved.ref })
    ).rejects.toThrow()
  })

  it("collects expired results while keeping protected references and reports expiry explicitly", async () => {
    const first = await saveToolResult({
      ...scope(),
      output: { type: "text", value: "old result" }
    })
    const oldTime = new Date(Date.now() - TOOL_RESULT_TTL_MS - 1000)
    const record = JSON.parse(await readFile(storedPath(first.ref), "utf-8"))
    await writeFile(
      storedPath(first.ref),
      JSON.stringify({
        ...record,
        createdAt: new Date(
          oldTime.getTime() - TOOL_RESULT_TTL_MS
        ).toISOString(),
        expiresAt: oldTime.toISOString()
      })
    )
    await utimes(storedPath(first.ref), oldTime, oldTime)
    await saveToolResult({
      ...scope(),
      output: { type: "text", value: "new result" },
      protectedRefs: [first.ref]
    })
    expect(await readFile(storedPath(first.ref), "utf-8")).toContain(
      "old result"
    )
    await expect(
      readToolResultPage({ ...scope(), ref: first.ref })
    ).rejects.toThrow("expired")
    await saveToolResult({
      ...scope(),
      output: { type: "text", value: "next result" }
    })
    await expect(lstat(storedPath(first.ref))).rejects.toThrow()
  })

  it("refuses capacity exhaustion instead of evicting available result bodies", async () => {
    const saved = await saveToolResult({
      ...scope(),
      output: { type: "text", value: "keep this fact" }
    })
    const occupied = path.join(
      path.dirname(storedPath(saved.ref)),
      `${"a".repeat(64)}.json`
    )
    await mkdir(path.dirname(occupied), { recursive: true })
    await writeFile(occupied, "")
    await truncate(occupied, TOOL_RESULT_STORE_MAX_BYTES)
    await expect(
      saveToolResult({
        ...scope(),
        output: { type: "text", value: "cannot fit" }
      })
    ).rejects.toThrow("storage is full")
    const preserved = await readToolResultPage({ ...scope(), ref: saved.ref })
    expect(preserved.content).toBe("keep this fact")
  })
})
