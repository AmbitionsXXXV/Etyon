import { describe, expect, it } from "vite-plus/test"

import {
  FIRST_LIGHT_TOTAL_MS,
  getLandingPoint,
  getOriginPoint,
  getPhaseStartMs,
  getRegionRevealTotalMs,
  getRingMaxDiameterPx,
  orderRegionsByDistanceToLanding,
  REGION_REVEAL_PARAMS,
  parseFirstLightMode
} from "@/renderer/lib/first-light/timeline"

describe("parseFirstLightMode", () => {
  it("maps firstRun param values to run modes", () => {
    expect(parseFirstLightMode("1")).toBe("play")
    expect(parseFirstLightMode("preview")).toBe("preview")
  })

  it("treats missing or unknown values as off", () => {
    expect(parseFirstLightMode(null)).toBe("off")
    expect(parseFirstLightMode("")).toBe("off")
    expect(parseFirstLightMode("0")).toBe("off")
    expect(parseFirstLightMode("play")).toBe("off")
  })
})

describe("getPhaseStartMs", () => {
  it("matches the storyboard offsets", () => {
    expect(getPhaseStartMs("backdrop")).toBe(0)
    expect(getPhaseStartMs("firstDot")).toBe(350)
    expect(getPhaseStartMs("greeting")).toBe(1500)
    expect(getPhaseStartMs("descent")).toBe(2600)
    expect(getPhaseStartMs("reveal")).toBe(3200)
  })

  it("sums to the total duration", () => {
    expect(FIRST_LIGHT_TOTAL_MS).toBe(4000)
    expect(getPhaseStartMs("reveal") + 800).toBe(FIRST_LIGHT_TOTAL_MS)
  })
})

describe("getOriginPoint", () => {
  it("places the first dot at (50%, 42%) of the viewport", () => {
    expect(getOriginPoint({ height: 1000, width: 2000 })).toEqual({
      x: 1000,
      y: 420
    })
  })
})

describe("getLandingPoint", () => {
  it("returns the center of the anchor rect when provided", () => {
    const landing = getLandingPoint(
      { height: 80, left: 200, top: 600, width: 400 },
      { height: 1000, width: 2000 }
    )

    expect(landing).toEqual({ x: 400, y: 640 })
  })

  it("falls back to (50%, 78%) of the viewport without a rect", () => {
    expect(getLandingPoint(null, { height: 1000, width: 2000 })).toEqual({
      x: 1000,
      y: 780
    })
  })
})

describe("getRingMaxDiameterPx", () => {
  it("uses 40vw below the cap", () => {
    expect(getRingMaxDiameterPx(1000)).toBe(400)
  })

  it("caps at 480px on wide viewports", () => {
    expect(getRingMaxDiameterPx(2000)).toBe(480)
  })
})

describe("orderRegionsByDistanceToLanding", () => {
  it("orders regions nearest-first by center distance to the landing point", () => {
    // Centers: (50, 50), (950, 950), (450, 450).
    const rects = [
      { height: 100, left: 0, top: 0, width: 100 },
      { height: 100, left: 900, top: 900, width: 100 },
      { height: 100, left: 400, top: 400, width: 100 }
    ]

    expect(orderRegionsByDistanceToLanding(rects, { x: 450, y: 450 })).toEqual([
      2, 0, 1
    ])
  })

  it("keeps original order for equidistant regions", () => {
    // Centers (10, 10) and (30, 10); the landing at x = 20 is equidistant.
    const rects = [
      { height: 20, left: 0, top: 0, width: 20 },
      { height: 20, left: 20, top: 0, width: 20 }
    ]

    expect(orderRegionsByDistanceToLanding(rects, { x: 20, y: 10 })).toEqual([
      0, 1
    ])
  })

  it("returns an empty order when there are no regions", () => {
    expect(orderRegionsByDistanceToLanding([], { x: 0, y: 0 })).toEqual([])
  })
})

describe("getRegionRevealTotalMs", () => {
  it("is zero when there are no regions", () => {
    expect(getRegionRevealTotalMs(0)).toBe(0)
  })

  it("is a single duration for one region", () => {
    expect(getRegionRevealTotalMs(1)).toBe(REGION_REVEAL_PARAMS.durationMs)
  })

  it("adds one stagger per extra region", () => {
    expect(getRegionRevealTotalMs(2)).toBe(
      REGION_REVEAL_PARAMS.staggerMs + REGION_REVEAL_PARAMS.durationMs
    )
    expect(getRegionRevealTotalMs(3)).toBe(
      2 * REGION_REVEAL_PARAMS.staggerMs + REGION_REVEAL_PARAMS.durationMs
    )
  })
})
