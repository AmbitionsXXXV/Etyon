import { describe, expect, it } from "vite-plus/test"

import { buildMediaUrl, parseMediaUrl } from "@/shared/chat/media-url"
import {
  estimateVideoTokens,
  getVideoResolutions,
  getVideoSize
} from "@/shared/chat/video-tools"

describe("estimateVideoTokens", () => {
  it("follows Ark's seconds × W × H × 24 / 1024 rule", () => {
    expect(
      estimateVideoTokens({ duration: 5, ratio: "16:9", resolution: "720p" })
    ).toBe(108_000)
    expect(
      estimateVideoTokens({ duration: 10, ratio: "9:16", resolution: "720p" })
    ).toBe(216_000)
    expect(
      estimateVideoTokens({ duration: 4, ratio: "16:9", resolution: "480p" })
    ).toBe(38_880)
  })
})

describe("getVideoResolutions", () => {
  it("offers only what each Seedance model accepts on amux", () => {
    expect(getVideoResolutions("amux/bytedance/seedance-2.0-fast")).toEqual([
      "720p"
    ])
    expect(getVideoResolutions("amux/bytedance/seedance-2.0-mini")).toEqual([
      "480p",
      "720p"
    ])
    expect(getVideoResolutions("amux/bytedance/seedance-2.0")).toEqual([
      "480p",
      "720p",
      "1080p"
    ])
  })
})

describe("getVideoSize", () => {
  it("returns sizes the ByteDance provider maps to Ark levels", () => {
    expect(getVideoSize("1080p", "1:1")).toBe("1440x1440")
    expect(getVideoSize("480p", "9:16")).toBe("480x864")
  })

  it("sizes adaptive like 16:9", () => {
    expect(getVideoSize("720p", "adaptive")).toBe("1280x720")
  })
})

describe("media urls", () => {
  it("round-trips a session and a project-relative path", () => {
    const url = buildMediaUrl({
      path: "generated-videos/paper boat 纸船-1a2b.mp4",
      sessionId: "session-1"
    })

    expect(url.startsWith("etyon-media://session/session-1/")).toBe(true)
    expect(parseMediaUrl(url)).toEqual({
      relativePath: "generated-videos/paper boat 纸船-1a2b.mp4",
      sessionId: "session-1"
    })
  })

  it("rejects other schemes and urls without a path", () => {
    expect(parseMediaUrl("etyon-attachment://media/abc.png")).toBeNull()
    expect(parseMediaUrl("etyon-media://session/only-session")).toBeNull()
    expect(parseMediaUrl("not a url")).toBeNull()
  })
})
