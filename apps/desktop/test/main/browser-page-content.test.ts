import { describe, expect, it } from "vite-plus/test"

import {
  PAGE_TEXT_HEAD_MAX_CHARS,
  PAGE_TEXT_TAIL_MAX_CHARS,
  resolveScreenshotSize,
  SCREENSHOT_MAX_EDGE_PX,
  truncatePageText
} from "@/main/browser/page-content"

const BUDGET = PAGE_TEXT_HEAD_MAX_CHARS + PAGE_TEXT_TAIL_MAX_CHARS

describe("truncatePageText", () => {
  it("passes text within budget through untouched", () => {
    const text = "a".repeat(BUDGET)

    expect(truncatePageText(text)).toEqual({ text, truncated: false })
  })

  it("keeps the head and the tail with an elision marker in between", () => {
    const head = "H".repeat(PAGE_TEXT_HEAD_MAX_CHARS)
    const middle = "M".repeat(500)
    const tail = "T".repeat(PAGE_TEXT_TAIL_MAX_CHARS)
    const result = truncatePageText(`${head}${middle}${tail}`)

    expect(result.truncated).toBe(true)
    expect(result.text.startsWith(head)).toBe(true)
    expect(result.text.endsWith(tail)).toBe(true)
    expect(result.text).toContain("[... 500 characters omitted ...]")
    expect(result.text).not.toContain("M")
  })

  it("keeps the page head rather than tailing like a shell log", () => {
    const result = truncatePageText(`START${"x".repeat(BUDGET)}END`)

    expect(result.text.startsWith("START")).toBe(true)
    expect(result.text.endsWith("END")).toBe(true)
  })
})

describe("resolveScreenshotSize", () => {
  it("leaves images inside the vision budget alone", () => {
    expect(resolveScreenshotSize({ height: 800, width: 1280 })).toEqual({
      height: 800,
      width: 1280
    })
    expect(
      resolveScreenshotSize({
        height: SCREENSHOT_MAX_EDGE_PX,
        width: SCREENSHOT_MAX_EDGE_PX
      })
    ).toEqual({
      height: SCREENSHOT_MAX_EDGE_PX,
      width: SCREENSHOT_MAX_EDGE_PX
    })
  })

  it("scales the longest edge down to the budget and keeps the ratio", () => {
    const landscape = resolveScreenshotSize({ height: 1600, width: 3200 })

    expect(landscape.width).toBe(SCREENSHOT_MAX_EDGE_PX)
    expect(landscape.height).toBe(SCREENSHOT_MAX_EDGE_PX / 2)

    const portrait = resolveScreenshotSize({ height: 4000, width: 1000 })

    expect(portrait.height).toBe(SCREENSHOT_MAX_EDGE_PX)
    expect(portrait.width).toBe(Math.round(SCREENSHOT_MAX_EDGE_PX / 4))
  })

  it("never rounds an edge down to zero", () => {
    const sliver = resolveScreenshotSize({ height: 1, width: 20_000 })

    expect(sliver.width).toBe(SCREENSHOT_MAX_EDGE_PX)
    expect(sliver.height).toBe(1)
  })
})
