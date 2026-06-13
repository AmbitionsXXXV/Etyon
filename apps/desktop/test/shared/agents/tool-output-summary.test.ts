import { describe, expect, it } from "vite-plus/test"

import { summarizeToolOutput } from "@/shared/agents/tool-output-summary"

describe("summarizeToolOutput", () => {
  it("summarizes a short single-line string without truncation", () => {
    const result = summarizeToolOutput("hello world")

    expect(result.lineCount).toBe(1)
    expect(result.totalChars).toBe(11)
    expect(result.truncated).toBe(false)
    expect(result.preview).toBe("hello world")
    expect(result.summary).toBe("1 line · 11 chars")
  })

  it("truncates and reports long multi-line output deterministically", () => {
    const text = Array.from({ length: 40 }, (_, index) => `line ${index}`).join(
      "\n"
    )
    const first = summarizeToolOutput(text)
    const second = summarizeToolOutput(text)

    expect(first.lineCount).toBe(40)
    expect(first.truncated).toBe(true)
    expect(first.preview.split("\n").length).toBeLessThanOrEqual(6)
    // Deterministic: identical input yields identical summary.
    expect(first).toEqual(second)
  })

  it("renders non-string output as pretty JSON", () => {
    const result = summarizeToolOutput({ ok: true, path: "a.ts" })

    expect(result.preview).toContain('"path": "a.ts"')
    expect(result.totalChars).toBeGreaterThan(0)
  })

  it("treats null/undefined as empty", () => {
    expect(summarizeToolOutput(null).totalChars).toBe(0)
    expect(summarizeToolOutput().preview).toBe("")
  })
})
