import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { ModelMessage } from "ai"
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"

import {
  estimateModelMessageTokens,
  prepareBudgetedContext,
  prepareBudgetedMessages
} from "@/main/agents/context-budget"
import {
  readToolResultPage,
  saveToolResult
} from "@/main/agents/tool-result-store"

const budget = {
  contextWindow: 32_000,
  maxInputTokens: 16_000,
  reserveOutputTokens: 4096
}
let storageRoot: string
beforeEach(async () => {
  storageRoot = await mkdtemp("/private/tmp/etyon-context-budget-")
})
afterEach(async () => {
  await rm(storageRoot, { force: true, recursive: true })
})
const toolTurn = (value: string): ModelMessage[] => [
  { content: "Find the final evidence in the long result.", role: "user" },
  {
    content: [
      {
        input: { path: "evidence.txt" },
        toolCallId: "call",
        toolName: "read",
        type: "tool-call"
      }
    ],
    role: "assistant"
  },
  {
    content: [
      {
        output: { type: "text", value },
        toolCallId: "call",
        toolName: "read",
        type: "tool-result"
      }
    ],
    role: "tool"
  }
]
describe("model call budget", () => {
  it("accounts for non-ASCII text and image inputs", () => {
    expect(
      estimateModelMessageTokens([{ content: "中文", role: "user" }])
    ).toBeGreaterThan(
      estimateModelMessageTokens([{ content: "ab", role: "user" }])
    )
    expect(
      estimateModelMessageTokens([
        {
          content: [{ image: "data:image/png;base64,AAAA", type: "image" }],
          role: "user"
        }
      ])
    ).toBeGreaterThan(8000)
  })

  it("counts legacy tool screenshot formats as images rather than their base64 text length", () => {
    const messages: ModelMessage[] = [
      { content: "Compare the screenshot", role: "user" },
      {
        content: [
          {
            output: {
              type: "content",
              value: [
                {
                  type: "image-url",
                  url: `data:image/png;base64,${"A".repeat(100_000)}`
                },
                {
                  type: "image-data",
                  data: "A".repeat(100_000),
                  mediaType: "image/png"
                }
              ]
            },
            toolCallId: "screenshot",
            toolName: "browser",
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    ]
    const estimate = estimateModelMessageTokens(messages)
    expect(estimate).toBeGreaterThan(16_000)
    expect(estimate).toBeLessThan(18_000)
  })

  it("counts image-shaped JSON tool output as actual text and preserves it through a JSON reference", async () => {
    const value = {
      data: "A".repeat(40_000),
      mediaType: "image/png",
      type: "image-data"
    }
    const messages: ModelMessage[] = [
      { content: "Inspect this result", role: "user" },
      {
        content: [
          {
            output: { type: "json", value },
            toolCallId: "json-image",
            toolName: "read",
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    ]
    expect(estimateModelMessageTokens(messages)).toBeGreaterThan(40_000)
    const prepared = await prepareBudgetedContext(messages, 1000, budget, {
      sessionId: "session",
      storageRoot
    })
    const ref = JSON.stringify(prepared.messages).match(
      /"ref":"([a-f\d]{64})"/u
    )?.[1]
    if (!ref) {
      throw new Error("Expected a JSON result reference.")
    }
    let body = ""
    let offset: number | null = 0
    while (offset !== null) {
      const page = await readToolResultPage({
        limit: 8192,
        offset,
        ref,
        sessionId: "session",
        storageRoot
      })
      body += page.content
      offset = page.nextOffset
    }
    expect(JSON.parse(body)).toEqual(value)
  })

  it("refuses an output reserve that consumes the usable provider context", () => {
    expect(() =>
      prepareBudgetedMessages(
        [{ content: "small input", role: "user" }],
        1000,
        { ...budget, contextWindow: 4000, reserveOutputTokens: 4096 }
      )
    ).toThrow("output reservation")
    expect(() =>
      prepareBudgetedMessages(
        [{ content: "small input", role: "user" }],
        1000,
        { ...budget, contextWindow: 1024, reserveOutputTokens: 384 }
      )
    ).toThrow("output reservation")
  })
  it("compacts complete old turns and preserves the latest tool boundary", () => {
    const latest: ModelMessage[] = [
      { content: "Current request", role: "user" },
      {
        content: [
          {
            input: { path: "a.txt" },
            toolCallId: "call-1",
            toolName: "read",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            output: { type: "text", value: "File content" },
            toolCallId: "call-1",
            toolName: "read",
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    ]
    const messages: ModelMessage[] = [
      { content: "Old request", role: "user" },
      { content: "x".repeat(30_000), role: "assistant" },
      ...latest
    ]
    const result = prepareBudgetedMessages(messages, 1000, budget)
    expect(result.compacted).toBe(true)
    expect(result.messages.slice(-3)).toEqual(latest)
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(result.limit)
  })
  it("does not silently remove pending calls when the current turn cannot fit", () => {
    expect(() =>
      prepareBudgetedMessages(
        [{ content: "x".repeat(50_000), role: "user" }],
        1000,
        budget
      )
    ).toThrow("Pending tool calls were preserved")
  })

  it("continues a long current turn with a recoverable body and the original tool-call boundary", async () => {
    const body = `${"evidence line\n".repeat(3000)}critical final fact`
    const messages = toolTurn(body)
    const prepared = await prepareBudgetedContext(messages, 1000, budget, {
      sessionId: "session",
      storageRoot
    })
    expect(prepared.estimatedInputTokens).toBeLessThanOrEqual(prepared.limit)
    expect(prepared.compacted).toBe(true)
    expect(prepared.messages.slice(0, 2)).toEqual(messages.slice(0, 2))
    expect(messages).toEqual(toolTurn(body))
    const serialized = JSON.stringify(prepared.messages)
    const ref = serialized.match(/Stored tool result: ([a-f\d]{64})/u)?.[1]
    if (!ref) {
      throw new Error("Expected a durable result reference.")
    }
    let content = ""
    let offset: number | null = 0
    while (offset !== null) {
      const page = await readToolResultPage({
        limit: 8192,
        offset,
        ref,
        sessionId: "session",
        storageRoot
      })
      content += page.content
      offset = page.nextOffset
    }
    expect(content).toBe(body)
    expect(content).toContain("critical final fact")
  })

  it("preserves denied outputs, images and unresolved calls when paging other results", async () => {
    const messages = toolTurn("x".repeat(40_000))
    messages.push({
      content: [
        {
          input: { action: "wait" },
          toolCallId: "pending",
          toolName: "ask_user",
          type: "tool-call"
        }
      ],
      role: "assistant"
    })
    const preserved: ModelMessage[] = [
      {
        content: [
          {
            output: { reason: "Do not execute", type: "execution-denied" },
            toolCallId: "denied",
            toolName: "bash",
            type: "tool-result"
          }
        ],
        role: "tool"
      },
      {
        content: [
          {
            output: {
              type: "content",
              value: [
                {
                  data: { data: "AAAA", type: "data" },
                  mediaType: "image/png",
                  type: "file"
                }
              ]
            },
            toolCallId: "image",
            toolName: "browser",
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    ]
    messages.push(...preserved)
    const prepared = await prepareBudgetedContext(
      messages,
      1000,
      { ...budget, maxInputTokens: 24_000 },
      { sessionId: "session", storageRoot }
    )
    expect(prepared.messages.at(-3)).toEqual(messages.at(-3))
    expect(prepared.messages.slice(-2)).toEqual(preserved)
    expect(prepared.messages[0]).toEqual(messages[0])
  })

  it("does not drop an old pending approval when a new user message arrives", () => {
    const pending: ModelMessage[] = [
      { content: "Original request", role: "user" },
      {
        content: [
          {
            input: { command: "write" },
            toolCallId: "pending",
            toolName: "bash",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      { content: "New message", role: "user" },
      { content: "x".repeat(30_000), role: "assistant" }
    ]
    expect(() => prepareBudgetedMessages(pending, 1000, budget)).toThrow(
      "Pending tool calls were preserved"
    )
  })

  it("reuses original references for prior read pages without caching the page output recursively", async () => {
    const saved = await saveToolResult({
      output: { type: "text", value: "source".repeat(8000) },
      sessionId: "session",
      storageRoot
    })
    const page = await readToolResultPage({
      limit: 8192,
      ref: saved.ref,
      sessionId: "session",
      storageRoot
    })
    const messages: ModelMessage[] = [
      { content: "Read and compare pages", role: "user" }
    ]
    for (const id of ["page-1", "page-2", "page-3"]) {
      messages.push(
        {
          content: [
            {
              input: { ref: saved.ref },
              toolCallId: id,
              toolName: "read_tool_result",
              type: "tool-call"
            }
          ],
          role: "assistant"
        },
        {
          content: [
            {
              output: {
                type: "json",
                value: { ...page, hookContext: "extra hook evidence" }
              },
              toolCallId: id,
              toolName: "read_tool_result",
              type: "tool-result"
            }
          ],
          role: "tool"
        }
      )
    }
    const prepared = await prepareBudgetedContext(messages, 1000, budget, {
      sessionId: "session",
      storageRoot
    })
    expect(prepared.estimatedInputTokens).toBeLessThanOrEqual(prepared.limit)
    expect(prepared.messages.at(-1)).toEqual(messages.at(-1))
    expect(JSON.stringify(prepared.messages)).toContain(
      "stored-tool-result-page"
    )
    expect(JSON.stringify(prepared.messages)).toContain("extra hook evidence")
    const [directory] = await readdir(storageRoot)
    if (!directory) {
      throw new Error("Expected a private result directory.")
    }
    expect(await readdir(path.join(storageRoot, directory))).toHaveLength(1)
    expect(
      await readToolResultPage({
        limit: 8192,
        ref: saved.ref,
        sessionId: "session",
        storageRoot
      })
    ).toEqual(page)
  })

  it("fails explicitly on storage failure or irreducible user content instead of truncating it", async () => {
    const blocked = path.join(storageRoot, "not-a-directory")
    await writeFile(blocked, "existing file")
    const messages = toolTurn("x".repeat(30_000))
    await expect(
      prepareBudgetedContext(messages, 1000, budget, {
        sessionId: "session",
        storageRoot: blocked
      })
    ).rejects.toThrow()
    expect(await readFile(blocked, "utf-8")).toBe("existing file")
    expect(messages).toEqual(toolTurn("x".repeat(30_000)))
    await expect(
      prepareBudgetedContext(
        [{ content: "x".repeat(40_000), role: "user" }],
        1000,
        budget,
        { sessionId: "session", storageRoot }
      )
    ).rejects.toThrow("Pending tool calls were preserved")
  })
})
