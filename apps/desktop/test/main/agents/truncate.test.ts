import { describe, expect, it } from "vite-plus/test"

import {
  appendToolResultSummaryAnnotation,
  createToolResultSummaryCache,
  formatToolResultSummaryAnnotation,
  formatSize,
  summarizeToolResult,
  summarizeToolResultWithProcessor,
  truncateHead,
  truncateLine,
  truncateTail
} from "@/main/agents/truncate"

describe("agent truncate utilities", () => {
  it("keeps short content unchanged", () => {
    expect(truncateTail("short", 10)).toEqual({
      content: "short",
      truncated: false
    })
  })

  it("truncates tail without splitting surrogate pairs", () => {
    const result = truncateTail("😀😀😀", 2)

    expect(result).toEqual({
      content: "😀😀",
      truncated: true
    })
    expect(result.content).not.toContain("\uFFFD")
  })

  it("truncates head from the beginning", () => {
    expect(truncateHead("abcdef", 3)).toEqual({
      content: "def",
      truncated: true
    })
  })

  it("truncates each line independently", () => {
    expect(truncateLine("abcdef\nghijkl", 3)).toEqual({
      content: "abc\nghi",
      truncated: true
    })
  })

  it("formats byte sizes", () => {
    expect(formatSize(0)).toBe("0 B")
    expect(formatSize(1024)).toBe("1 KB")
    expect(formatSize(1536)).toBe("1.5 KB")
    expect(formatSize(1024 * 1024)).toBe("1 MB")
  })

  it("creates deterministic summaries for long tool output", () => {
    expect(summarizeToolResult("abcdef", 3)).toEqual({
      content: "abc",
      omittedChars: 3,
      totalChars: 6,
      truncated: true
    })
  })

  it("formats explicit truncate annotations for model-visible output", () => {
    const summary = summarizeToolResult("abcdef", 3)

    expect(
      formatToolResultSummaryAnnotation(summary, {
        fullOutputPath: "/tmp/output.json",
        label: "stdout"
      })
    ).toBe(
      "[stdout truncated: omitted 3 of 6 chars; full output saved to /tmp/output.json]"
    )
    expect(appendToolResultSummaryAnnotation("abc", summary)).toBe(
      "abc\n\n[truncated: omitted 3 of 6 chars]"
    )
    expect(
      formatToolResultSummaryAnnotation(summarizeToolResult("abc", 10))
    ).toBe("")
  })

  it("uses a model summary processor for truncated tool output", async () => {
    const summary = await summarizeToolResultWithProcessor("abcdef", {
      maxChars: 3,
      processor: ({ deterministicSummary, maxSummaryChars }) => ({
        content: `summary ${deterministicSummary.omittedChars} ${maxSummaryChars}`
      })
    })

    expect(summary).toEqual({
      content: "summary 3 2000",
      omittedChars: 3,
      processor: "model",
      totalChars: 6,
      truncated: true
    })
    expect(formatToolResultSummaryAnnotation(summary)).toBe(
      "[truncated: omitted 3 of 6 chars; model summary used]"
    )
  })

  it("falls back to deterministic output when the summary processor fails", async () => {
    const summary = await summarizeToolResultWithProcessor("abcdef", {
      maxChars: 3,
      processor: () => {
        throw new Error("summary unavailable")
      }
    })

    expect(summary).toMatchObject({
      content: "abc",
      omittedChars: 3,
      processor: "deterministic",
      processorErrorMessage: "summary unavailable",
      totalChars: 6,
      truncated: true
    })
  })

  it("keeps a bounded least-recently-used summary cache", () => {
    const cache = createToolResultSummaryCache({
      maxChars: 4,
      maxEntries: 2
    })

    cache.set("old", "abcdef")
    cache.set("evicted", "12345")
    expect(cache.get("old")).toEqual({
      content: "abcd",
      omittedChars: 2,
      totalChars: 6,
      truncated: true
    })

    cache.set("new", "xyz")

    expect(cache.get("evicted")).toBeUndefined()
    expect(cache.entries().map((entry) => entry.id)).toEqual(["old", "new"])
  })

  it("stores processed summaries in the cache", async () => {
    const cache = createToolResultSummaryCache({
      maxChars: 3,
      maxEntries: 2
    })

    await expect(
      cache.setWithProcessor("model", "abcdef", {
        processor: () => "processed"
      })
    ).resolves.toMatchObject({
      content: "processed",
      processor: "model"
    })
    expect(cache.get("model")).toMatchObject({
      content: "processed",
      processor: "model"
    })
  })
})
