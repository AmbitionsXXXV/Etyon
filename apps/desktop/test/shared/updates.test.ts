import type { AvailableUpdate, UpdateStatus } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  compareSemver,
  isAllowedReleaseUrl,
  parseLatestRelease,
  pickDmgAsset,
  shouldNotify
} from "@/shared/updates/core"

// Assembled via join so the source carries no literal `javascript:` URL, which
// the linter rejects; the runtime value is still `javascript:alert(1)`.
const SCRIPT_URL = ["javascript", "alert(1)"].join(":")

const DMG_URL =
  "https://github.com/AmbitionsXXXV/Etyon/releases/download/v0.2.0/etyon-0.2.0-arm64.dmg"
const RELEASE_PAGE_URL =
  "https://github.com/AmbitionsXXXV/Etyon/releases/tag/v0.2.0"

const buildReleasePayload = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  assets: [
    {
      browser_download_url: DMG_URL,
      name: "etyon-0.2.0-arm64.dmg",
      size: 123_456_789
    }
  ],
  body: "## Highlights\n\n- Faster startup",
  draft: false,
  html_url: RELEASE_PAGE_URL,
  prerelease: false,
  published_at: "2026-07-21T09:00:00Z",
  tag_name: "v0.2.0",
  ...overrides
})

const buildStatus = (
  available: AvailableUpdate | null,
  overrides: Partial<UpdateStatus> = {}
): UpdateStatus => ({
  available,
  buildIdentifier: "release",
  checkReason: "auto",
  currentVersion: "0.1.8",
  errorCode: null,
  lastCheckedAt: 1_753_600_000_000,
  state: available ? "available" : "up-to-date",
  ...overrides
})

describe("compareSemver", () => {
  it("orders newer versions above older ones", () => {
    expect(compareSemver("0.2.0", "0.1.8")).toBeGreaterThan(0)
    expect(compareSemver("1.0.0", "0.9.9")).toBeGreaterThan(0)
    expect(compareSemver("0.1.9", "0.1.8")).toBeGreaterThan(0)
  })

  it("orders older versions below newer ones", () => {
    expect(compareSemver("0.1.8", "0.2.0")).toBeLessThan(0)
    expect(compareSemver("0.9.9", "1.0.0")).toBeLessThan(0)
  })

  it("treats equal versions as equal regardless of a leading v", () => {
    expect(compareSemver("0.1.8", "0.1.8")).toBe(0)
    expect(compareSemver("v0.1.8", "0.1.8")).toBe(0)
  })

  it("reports 0 when either side is malformed so nothing looks newer", () => {
    expect(compareSemver("not-a-version", "0.1.8")).toBe(0)
    expect(compareSemver("0.2.0", "0.1")).toBe(0)
    expect(compareSemver("", "0.1.8")).toBe(0)
  })
})

describe("isAllowedReleaseUrl", () => {
  it("accepts https URLs inside the Etyon repository", () => {
    expect(isAllowedReleaseUrl(RELEASE_PAGE_URL)).toBe(true)
    expect(isAllowedReleaseUrl(DMG_URL)).toBe(true)
  })

  it("rejects plaintext http, foreign repositories, and script URLs", () => {
    expect(
      isAllowedReleaseUrl("http://github.com/AmbitionsXXXV/Etyon/releases")
    ).toBe(false)
    expect(
      isAllowedReleaseUrl("https://github.com/attacker/Etyon/releases")
    ).toBe(false)
    expect(
      isAllowedReleaseUrl("https://github.com/AmbitionsXXXV/EtyonEvil/releases")
    ).toBe(false)
    expect(
      isAllowedReleaseUrl("https://github.com.evil.test/AmbitionsXXXV/Etyon/")
    ).toBe(false)
    expect(isAllowedReleaseUrl(SCRIPT_URL)).toBe(false)
    expect(isAllowedReleaseUrl("not a url")).toBe(false)
  })

  it("rejects path traversal that escapes the repository prefix", () => {
    expect(
      isAllowedReleaseUrl("https://github.com/AmbitionsXXXV/Etyon/../../evil")
    ).toBe(false)
  })
})

describe("pickDmgAsset", () => {
  it("returns the first allowed .dmg asset with its size", () => {
    expect(
      pickDmgAsset([
        { browser_download_url: DMG_URL, name: "etyon.zip", size: 1 },
        { browser_download_url: DMG_URL, name: "etyon.dmg", size: 42 }
      ])
    ).toEqual({ sizeBytes: 42, url: DMG_URL })
  })

  it("keeps a missing size null", () => {
    expect(
      pickDmgAsset([{ browser_download_url: DMG_URL, name: "etyon.dmg" }])
    ).toEqual({ sizeBytes: null, url: DMG_URL })
  })

  it("normalizes invalid asset sizes to null", () => {
    for (const size of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        pickDmgAsset([
          { browser_download_url: DMG_URL, name: "etyon.dmg", size }
        ])
      ).toEqual({ sizeBytes: null, url: DMG_URL })
    }
  })

  it("skips assets hosted outside the repository", () => {
    expect(
      pickDmgAsset([
        {
          browser_download_url: "https://evil.test/etyon.dmg",
          name: "etyon.dmg"
        }
      ])
    ).toBeNull()
  })

  it("returns null for a missing or empty asset list", () => {
    expect(pickDmgAsset(null)).toBeNull()
    expect(pickDmgAsset([])).toBeNull()
    expect(pickDmgAsset([{ name: "etyon.zip" }])).toBeNull()
  })
})

describe("parseLatestRelease", () => {
  it("reports a newer release with its notes and dmg asset", () => {
    const result = parseLatestRelease(buildReleasePayload(), "0.1.8")

    expect(result).toEqual({
      available: {
        dmgSizeBytes: 123_456_789,
        dmgUrl: DMG_URL,
        htmlUrl: RELEASE_PAGE_URL,
        notes: "## Highlights\n\n- Faster startup",
        publishedAt: "2026-07-21T09:00:00Z",
        tagName: "v0.2.0",
        version: "0.2.0"
      },
      state: "available"
    })
  })

  it("falls back to the release page when no dmg is attached", () => {
    const result = parseLatestRelease(
      buildReleasePayload({ assets: [] }),
      "0.1.8"
    )

    expect(result).toEqual({
      available: expect.objectContaining({
        dmgSizeBytes: null,
        dmgUrl: null,
        htmlUrl: RELEASE_PAGE_URL
      }),
      state: "available"
    })
  })

  it("reports up-to-date when the release matches the running version", () => {
    expect(parseLatestRelease(buildReleasePayload(), "0.2.0")).toEqual({
      state: "up-to-date"
    })
  })

  it("reports up-to-date when the local build is ahead of the release", () => {
    expect(parseLatestRelease(buildReleasePayload(), "0.3.0")).toEqual({
      state: "up-to-date"
    })
  })

  it("ignores drafts and prereleases that slip into the feed", () => {
    expect(
      parseLatestRelease(buildReleasePayload({ draft: true }), "0.1.8")
    ).toEqual({ state: "up-to-date" })
    expect(
      parseLatestRelease(buildReleasePayload({ prerelease: true }), "0.1.8")
    ).toEqual({ state: "up-to-date" })
  })

  it("reports invalid-response for a tag that is not vX.Y.Z", () => {
    for (const tagName of [
      "0.2.0",
      "v1.2",
      "release-2026-07",
      "v0.2.0-beta.1"
    ]) {
      expect(
        parseLatestRelease(buildReleasePayload({ tag_name: tagName }), "0.1.8")
      ).toEqual({ errorCode: "invalid-response", state: "error" })
    }
  })

  it("reports invalid-response for a release page outside the repository", () => {
    expect(
      parseLatestRelease(
        buildReleasePayload({
          html_url: "https://evil.test/releases/tag/v0.2.0"
        }),
        "0.1.8"
      )
    ).toEqual({ errorCode: "invalid-response", state: "error" })
  })

  it("reports invalid-response for a payload that is not an object", () => {
    expect(parseLatestRelease(null, "0.1.8")).toEqual({
      errorCode: "invalid-response",
      state: "error"
    })
    expect(parseLatestRelease("nope", "0.1.8")).toEqual({
      errorCode: "invalid-response",
      state: "error"
    })
  })

  it("drops blank release notes", () => {
    const result = parseLatestRelease(
      buildReleasePayload({ body: "   ", published_at: null }),
      "0.1.8"
    )

    expect(result).toEqual({
      available: expect.objectContaining({ notes: null, publishedAt: null }),
      state: "available"
    })
  })
})

describe("shouldNotify", () => {
  const available: AvailableUpdate = {
    dmgSizeBytes: null,
    dmgUrl: null,
    htmlUrl: RELEASE_PAGE_URL,
    notes: null,
    publishedAt: null,
    tagName: "v0.2.0",
    version: "0.2.0"
  }

  it("notifies once for a newly found version", () => {
    expect(shouldNotify(buildStatus(available), null)).toBe(true)
    expect(shouldNotify(buildStatus(available), "0.1.9")).toBe(true)
  })

  it("stays quiet for a version the user already saw", () => {
    expect(shouldNotify(buildStatus(available), "0.2.0")).toBe(false)
  })

  it("stays quiet for manual checks and non-available states", () => {
    expect(
      shouldNotify(buildStatus(available, { checkReason: "manual" }), null)
    ).toBe(false)
    expect(
      shouldNotify(
        buildStatus(null, { errorCode: "network", state: "error" }),
        null
      )
    ).toBe(false)
    expect(shouldNotify(buildStatus(null), null)).toBe(false)
  })
})
