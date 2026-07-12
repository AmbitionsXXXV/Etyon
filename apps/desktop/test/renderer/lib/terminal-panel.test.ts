import { describe, expect, it } from "vite-plus/test"

import {
  createTerminalTheme,
  hasTerminalDimensionsChanged,
  resolveTerminalDimensions
} from "@/renderer/lib/chat/terminal-panel"

describe("resolveTerminalDimensions", () => {
  it("returns null when the fit addon cannot measure the container", () => {
    expect(resolveTerminalDimensions()).toBeNull()
    expect(resolveTerminalDimensions(null)).toBeNull()
  })

  it("returns null for a zero-size (collapsed) container", () => {
    expect(resolveTerminalDimensions({ cols: 0, rows: 0 })).toBeNull()
    expect(resolveTerminalDimensions({ cols: 80, rows: 0 })).toBeNull()
    expect(resolveTerminalDimensions({ cols: 0, rows: 24 })).toBeNull()
  })

  it("returns null for negative or non-finite dimensions", () => {
    expect(resolveTerminalDimensions({ cols: -5, rows: 24 })).toBeNull()
    expect(resolveTerminalDimensions({ cols: Number.NaN, rows: 24 })).toBeNull()
    expect(
      resolveTerminalDimensions({ cols: 80, rows: Number.POSITIVE_INFINITY })
    ).toBeNull()
  })

  it("returns null when either dimension is missing", () => {
    expect(resolveTerminalDimensions({ cols: 80 })).toBeNull()
    expect(resolveTerminalDimensions({ rows: 24 })).toBeNull()
  })

  it("floors fractional dimensions to whole cells", () => {
    expect(resolveTerminalDimensions({ cols: 80.9, rows: 24.4 })).toEqual({
      cols: 80,
      rows: 24
    })
  })

  it("passes through valid whole dimensions unchanged", () => {
    expect(resolveTerminalDimensions({ cols: 120, rows: 40 })).toEqual({
      cols: 120,
      rows: 40
    })
  })

  it("clamps dimensions to the RPC schema's 1..1000 range", () => {
    expect(resolveTerminalDimensions({ cols: 5000, rows: 9000 })).toEqual({
      cols: 1000,
      rows: 1000
    })
    expect(resolveTerminalDimensions({ cols: 1, rows: 1 })).toEqual({
      cols: 1,
      rows: 1
    })
  })
})

describe("hasTerminalDimensionsChanged", () => {
  it("treats a null previous value as changed (first measurement)", () => {
    expect(hasTerminalDimensionsChanged(null, { cols: 80, rows: 24 })).toBe(
      true
    )
  })

  it("is false when the dimensions are identical", () => {
    expect(
      hasTerminalDimensionsChanged(
        { cols: 80, rows: 24 },
        { cols: 80, rows: 24 }
      )
    ).toBe(false)
  })

  it("is true when either dimension differs", () => {
    expect(
      hasTerminalDimensionsChanged(
        { cols: 80, rows: 24 },
        { cols: 81, rows: 24 }
      )
    ).toBe(true)
    expect(
      hasTerminalDimensionsChanged(
        { cols: 80, rows: 24 },
        { cols: 80, rows: 25 }
      )
    ).toBe(true)
  })
})

describe("createTerminalTheme", () => {
  it("matches the read-only terminal look (zinc-950 bg, zinc-100 fg)", () => {
    const theme = createTerminalTheme()

    expect(theme.background).toBe("#09090b")
    expect(theme.foreground).toBe("#f4f4f5")
    expect(theme.cursor).toBe("#f4f4f5")
  })

  it("defines a full 16-color ANSI palette", () => {
    const theme = createTerminalTheme()
    const ansiColors = [
      theme.black,
      theme.red,
      theme.green,
      theme.yellow,
      theme.blue,
      theme.magenta,
      theme.cyan,
      theme.white,
      theme.brightBlack,
      theme.brightRed,
      theme.brightGreen,
      theme.brightYellow,
      theme.brightBlue,
      theme.brightMagenta,
      theme.brightCyan,
      theme.brightWhite
    ]

    expect(ansiColors).toHaveLength(16)
    for (const color of ansiColors) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/u)
    }
  })
})
