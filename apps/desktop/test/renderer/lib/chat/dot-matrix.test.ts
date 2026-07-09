import { describe, expect, it } from "vite-plus/test"

import {
  getDotMatrixAlpha,
  getDotMatrixStaticAlpha
} from "@/renderer/lib/chat/dot-matrix"

const GRID = { cols: 20, rows: 14 }

describe("dot-matrix animation math", () => {
  it("keeps every dot alpha within [0, 1] across the grid and time", () => {
    for (let timeMs = 0; timeMs <= 5000; timeMs += 250) {
      for (let row = 0; row < GRID.rows; row += 1) {
        for (let col = 0; col < GRID.cols; col += 1) {
          const alpha = getDotMatrixAlpha({ ...GRID, col, row, timeMs })

          expect(alpha).toBeGreaterThanOrEqual(0)
          expect(alpha).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it("is deterministic for the same cell and time", () => {
    const cell = { ...GRID, col: 5, row: 3, timeMs: 1234 }

    expect(getDotMatrixAlpha(cell)).toBe(getDotMatrixAlpha({ ...cell }))
  })

  it("animates: the ripple moves dots over time", () => {
    const cell = { ...GRID, col: 10, row: 7 }
    const alphas = new Set(
      [0, 200, 400, 600, 800].map((timeMs) =>
        getDotMatrixAlpha({ ...cell, timeMs }).toFixed(4)
      )
    )

    expect(alphas.size).toBeGreaterThan(1)
  })

  it("provides a stable static frame for reduced motion", () => {
    const cell = { ...GRID, col: 2, row: 2, timeMs: 9999 }

    expect(getDotMatrixStaticAlpha(cell)).toBe(
      getDotMatrixAlpha({ ...cell, timeMs: 0 })
    )
  })
})
