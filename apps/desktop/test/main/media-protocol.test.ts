import { describe, expect, it, vi } from "vite-plus/test"

import { parseByteRange, resolveMediaFilePath } from "@/main/media-protocol"

vi.mock("electron", () => ({
  app: { getPath: () => "/private/tmp/etyon-media-protocol-test" },
  protocol: { handle: vi.fn() }
}))
vi.mock("@/main/db", () => ({ getDb: () => ({}) }))
vi.mock("@/main/logger", () => ({ logger: {} }))

const projectPath = "/projects/demo"

describe("resolveMediaFilePath", () => {
  it("serves video files under generated-videos", () => {
    expect(
      resolveMediaFilePath({
        projectPath,
        relativePath: "generated-videos/boat-1a2b.mp4"
      })
    ).toBe("/projects/demo/generated-videos/boat-1a2b.mp4")
  })

  it("serves storyboard keyframe images under generated-frames", () => {
    expect(
      resolveMediaFilePath({
        projectPath,
        relativePath: "generated-frames/boat-k0-1a2b.png"
      })
    ).toBe("/projects/demo/generated-frames/boat-k0-1a2b.png")
  })

  it("refuses paths outside the served dirs or with other extensions", () => {
    for (const relativePath of [
      "generated-videos/../secrets.mp4",
      "../other/generated-videos/boat.mp4",
      "src/boat.mp4",
      "generated-videos/notes.txt",
      "generated-videos",
      "generated-frames/notes.md",
      "src/boat.png",
      "/etc/generated-videos/boat.mp4"
    ]) {
      expect(resolveMediaFilePath({ projectPath, relativePath })).toBeNull()
    }
  })
})

describe("parseByteRange", () => {
  it("reads closed, open-ended, and suffix ranges", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ end: 99, start: 0 })
    expect(parseByteRange("bytes=500-", 1000)).toEqual({
      end: 999,
      start: 500
    })
    expect(parseByteRange("bytes=-100", 1000)).toEqual({
      end: 999,
      start: 900
    })
  })

  it("clamps the end to the file size", () => {
    expect(parseByteRange("bytes=900-5000", 1000)).toEqual({
      end: 999,
      start: 900
    })
  })

  it("rejects malformed and unsatisfiable ranges", () => {
    for (const header of [
      "bytes=1000-",
      "bytes=50-10",
      "bytes=-",
      "items=0-1",
      "bytes=0-1,4-5"
    ]) {
      expect(parseByteRange(header, 1000)).toBeNull()
    }
  })
})
