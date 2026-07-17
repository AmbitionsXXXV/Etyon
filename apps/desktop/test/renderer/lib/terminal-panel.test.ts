import { describe, expect, it } from "vite-plus/test"

import {
  buildTerminalTheme,
  hasTerminalDimensionsChanged,
  isTerminalContainerMeasurable,
  resolveTerminalDimensions,
  TERMINAL_MIN_MOUNT_HEIGHT_PX,
  TERMINAL_MIN_MOUNT_WIDTH_PX
} from "@/renderer/lib/chat/terminal-panel"

describe("isTerminalContainerMeasurable", () => {
  // Regression: the live dead-screen bug booted xterm from a hidden project
  // panel (0×0) and from a mid-expansion sliver (~30px wide → a 2-col pty). In
  // an occluded, frame-throttled window no ResizeObserver tick ever repaired
  // it, so such containers must never boot the terminal in the first place.
  it("rejects a hidden or collapsed container (0×0)", () => {
    expect(isTerminalContainerMeasurable({ height: 0, width: 0 })).toBe(false)
  })

  it("rejects mid-expansion slivers in either axis", () => {
    expect(isTerminalContainerMeasurable({ height: 849, width: 30 })).toBe(
      false
    )
    expect(isTerminalContainerMeasurable({ height: 20, width: 272 })).toBe(
      false
    )
  })

  it("accepts a settled open panel", () => {
    expect(isTerminalContainerMeasurable({ height: 849, width: 272 })).toBe(
      true
    )
  })

  it("treats the minimum thresholds as inclusive", () => {
    expect(
      isTerminalContainerMeasurable({
        height: TERMINAL_MIN_MOUNT_HEIGHT_PX,
        width: TERMINAL_MIN_MOUNT_WIDTH_PX
      })
    ).toBe(true)
    expect(
      isTerminalContainerMeasurable({
        height: TERMINAL_MIN_MOUNT_HEIGHT_PX - 1,
        width: TERMINAL_MIN_MOUNT_WIDTH_PX
      })
    ).toBe(false)
    expect(
      isTerminalContainerMeasurable({
        height: TERMINAL_MIN_MOUNT_HEIGHT_PX,
        width: TERMINAL_MIN_MOUNT_WIDTH_PX - 1
      })
    ).toBe(false)
  })
})

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

describe("buildTerminalTheme", () => {
  const resolved = {
    background: "rgb(9, 9, 11)",
    cursorAccent: "rgb(9, 9, 11)",
    foreground: "rgb(244, 244, 245)",
    isDark: true,
    selectionBackground: "rgba(63, 63, 70, 0.3)"
  }

  it("maps the resolved surface onto the terminal background", () => {
    const theme = buildTerminalTheme(resolved)

    expect(theme.background).toBe("rgb(9, 9, 11)")
  })

  it("maps the resolved foreground onto text and cursor", () => {
    const theme = buildTerminalTheme(resolved)

    expect(theme.foreground).toBe("rgb(244, 244, 245)")
    expect(theme.cursor).toBe("rgb(244, 244, 245)")
    expect(theme.cursorAccent).toBe("rgb(9, 9, 11)")
    expect(theme.selectionBackground).toBe("rgba(63, 63, 70, 0.3)")
  })

  it("flips the ANSI palette between light and dark surfaces", () => {
    const darkRed = buildTerminalTheme(resolved).red
    const lightRed = buildTerminalTheme({ ...resolved, isDark: false }).red

    expect(darkRed).not.toBe(lightRed)
  })

  it("defines a full 16-color ANSI palette", () => {
    const theme = buildTerminalTheme(resolved)
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
