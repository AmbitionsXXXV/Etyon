import { describe, expect, it } from "vite-plus/test"

import {
  createToolResultSummaryCache,
  formatSize,
  summarizeToolResult,
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
})
