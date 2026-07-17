import { describe, expect, it } from "vite-plus/test"

import { formatContextWindowCompact } from "@/shared/providers/context-window"

describe("formatContextWindowCompact", () => {
  it("returns null for a missing or zero window", () => {
    expect(formatContextWindowCompact()).toBeNull()
    expect(formatContextWindowCompact(0)).toBeNull()
  })

  it("formats a one-million window as '1M' (regression: was '1000K')", () => {
    expect(formatContextWindowCompact(1_000_000)).toBe("1M")
  })

  it("formats millions with up to one decimal, trimming trailing zeros", () => {
    expect(formatContextWindowCompact(1_500_000)).toBe("1.5M")
    expect(formatContextWindowCompact(1_047_576)).toBe("1M")
    expect(formatContextWindowCompact(2_000_000)).toBe("2M")
    expect(formatContextWindowCompact(10_000_000)).toBe("10M")
  })

  it("formats thousands as rounded 'K'", () => {
    expect(formatContextWindowCompact(202_752)).toBe("203K")
    expect(formatContextWindowCompact(400_000)).toBe("400K")
    expect(formatContextWindowCompact(1000)).toBe("1K")
  })

  it("returns the bare number below one thousand", () => {
    expect(formatContextWindowCompact(512)).toBe("512")
  })
})
