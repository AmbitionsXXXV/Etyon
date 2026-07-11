import { describe, expect, it } from "vite-plus/test"

import { formatElapsedDuration } from "@/renderer/lib/utils"

describe("formatElapsedDuration", () => {
  it("shows whole seconds under a minute", () => {
    expect(formatElapsedDuration(0)).toBe("0s")
    expect(formatElapsedDuration(42_000)).toBe("42s")
    expect(formatElapsedDuration(-100)).toBe("0s")
  })

  it("shows minutes and seconds under an hour", () => {
    expect(formatElapsedDuration(122_000)).toBe("2m 2s")
    // Rounds up across the minute boundary.
    expect(formatElapsedDuration(59_500)).toBe("1m 0s")
  })

  it("shows hours and minutes beyond an hour", () => {
    expect(formatElapsedDuration(3_780_000)).toBe("1h 3m")
  })
})
