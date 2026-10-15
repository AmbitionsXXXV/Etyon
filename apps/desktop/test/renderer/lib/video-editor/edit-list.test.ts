import { describe, expect, it } from "vite-plus/test"

import {
  addClip,
  formatEditTime,
  getCutStartMs,
  getTotalLengthMs,
  locateTimelineMs,
  MIN_CUT_MS,
  moveClip,
  removeClip,
  splitClip,
  trimClip
} from "@/renderer/lib/video-editor/edit-list"
import type { EditList } from "@/renderer/lib/video-editor/edit-list"

const base = (): EditList => {
  let list: EditList = []

  list = addClip(list, {
    durationMs: 4000,
    id: "a",
    path: "generated-videos/a.mp4",
    title: "A"
  })
  list = addClip(list, {
    durationMs: 5000,
    id: "b",
    path: "generated-videos/b.mp4",
    title: "B"
  })

  return list
}

describe("edit list", () => {
  it("adds whole clips and sums the cut lengths", () => {
    expect(base().map((clip) => [clip.inMs, clip.outMs])).toEqual([
      [0, 4000],
      [0, 5000]
    ])
    expect(getTotalLengthMs(base())).toBe(9000)
  })

  it("trims inside the clip and never below the minimum cut", () => {
    const trimmed = trimClip(base(), "a", { inMs: 500, outMs: 3000 })

    expect(trimmed[0]).toMatchObject({ inMs: 500, outMs: 3000 })
    expect(
      trimClip(base(), "a", { inMs: -10, outMs: 99_999 })[0]
    ).toMatchObject({ inMs: 0, outMs: 4000 })
    expect(trimClip(base(), "a", { inMs: 3990 })[0]).toMatchObject({
      inMs: 4000 - MIN_CUT_MS,
      outMs: 4000
    })
  })

  it("splits a cut into two over the same file", () => {
    const split = splitClip(base(), "a", 1500, "a2")

    expect(split.map((clip) => [clip.id, clip.inMs, clip.outMs])).toEqual([
      ["a", 0, 1500],
      ["a2", 1500, 4000],
      ["b", 0, 5000]
    ])
    expect(splitClip(base(), "a", 50, "x")).toEqual(base())
  })

  it("moves and removes cuts", () => {
    expect(moveClip(base(), "b", -1).map((clip) => clip.id)).toEqual(["b", "a"])
    expect(moveClip(base(), "b", 5).map((clip) => clip.id)).toEqual(["a", "b"])
    expect(removeClip(base(), "a").map((clip) => clip.id)).toEqual(["b"])
  })

  it("maps timeline time onto a cut and its file time", () => {
    const list = trimClip(base(), "a", { inMs: 1000 })

    expect(locateTimelineMs(list, 0)).toEqual({ clipIndex: 0, fileMs: 1000 })
    expect(locateTimelineMs(list, 3500)).toEqual({ clipIndex: 1, fileMs: 500 })
    expect(locateTimelineMs(list, 99_999)).toEqual({
      clipIndex: 1,
      fileMs: 5000
    })
    expect(locateTimelineMs([], 10)).toBeNull()
    expect(getCutStartMs(list, 1)).toBe(3000)
  })

  it("formats times to tenths", () => {
    expect(formatEditTime(4200)).toBe("0:04.2")
    expect(formatEditTime(65_000)).toBe("1:05.0")
  })
})
