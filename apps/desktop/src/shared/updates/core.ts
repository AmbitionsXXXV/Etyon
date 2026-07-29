// Pure, Node-testable update logic shared by the main-process checker
// (`main/updates/index.ts`) and the renderer's toast gate. No Electron imports.

import type { AvailableUpdate, UpdateStatus } from "@etyon/rpc"

const SEMVER_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
// Release tags are produced by script/release.mjs, so anything that is not a
// plain `vX.Y.Z` means the feed is not what this app expects.
const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const RELEASE_URL_ORIGIN = "https://github.com"
const RELEASE_URL_PATH_PREFIX = "/AmbitionsXXXV/Etyon/"
const DMG_SUFFIX = ".dmg"

const INVALID_RESPONSE = {
  errorCode: "invalid-response",
  state: "error"
} as const

const UP_TO_DATE = { state: "up-to-date" } as const

export interface ReleaseDmgAsset {
  sizeBytes: null | number
  url: string
}

export type ParsedLatestRelease =
  | typeof INVALID_RESPONSE
  | typeof UP_TO_DATE
  | { available: AvailableUpdate; state: "available" }

const parseSemver = (version: string): null | number[] => {
  const match = SEMVER_PATTERN.exec(version.trim())

  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/**
 * Returns a positive number when `left` is newer than `right`, a negative one
 * when it is older, and `0` when the two are equal *or* either side is
 * unparseable — an unknown version must never be reported as an update.
 */
export const compareSemver = (left: string, right: string): number => {
  const leftParts = parseSemver(left)
  const rightParts = parseSemver(right)

  if (!leftParts || !rightParts) {
    return 0
  }

  for (const [index, leftPart] of leftParts.entries()) {
    const rightPart = rightParts[index]

    if (leftPart !== rightPart) {
      return leftPart - rightPart
    }
  }

  return 0
}

/**
 * The only URLs `shell.openExternal` may receive: https GitHub links under
 * `https://github.com/AmbitionsXXXV/Etyon/`. Parsing with `URL` instead of a
 * raw `startsWith` normalizes `..` segments and rejects every other scheme,
 * host, and repository.
 */
export const isAllowedReleaseUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)

    return (
      parsed.origin === RELEASE_URL_ORIGIN &&
      parsed.pathname.startsWith(RELEASE_URL_PATH_PREFIX)
    )
  } catch {
    return false
  }
}

/**
 * Picks the first `.dmg` release asset whose download URL survives the
 * allowlist. macOS is the only packaged target today, so a release without a
 * usable `.dmg` simply falls back to the release page.
 */
export const pickDmgAsset = (assets: unknown): null | ReleaseDmgAsset => {
  if (!Array.isArray(assets)) {
    return null
  }

  for (const asset of assets) {
    if (!asset || typeof asset !== "object") {
      continue
    }

    const {
      browser_download_url: url,
      name,
      size
    } = asset as Record<string, unknown>

    if (
      typeof name !== "string" ||
      !name.toLowerCase().endsWith(DMG_SUFFIX) ||
      typeof url !== "string" ||
      !isAllowedReleaseUrl(url)
    ) {
      continue
    }

    const sizeBytes =
      typeof size === "number" && Number.isSafeInteger(size) && size >= 0
        ? size
        : null

    return { sizeBytes, url }
  }

  return null
}

/**
 * Turns a GitHub `releases/latest` payload into the update decision. Anything
 * the app cannot trust — a non-object payload, a tag that is not `vX.Y.Z`, a
 * release page outside the repository — is reported as `invalid-response`
 * rather than silently ignored, so a broken feed is visible to the user.
 */
export const parseLatestRelease = (
  payload: unknown,
  currentVersion: string
): ParsedLatestRelease => {
  if (!payload || typeof payload !== "object") {
    return INVALID_RESPONSE
  }

  const release = payload as Record<string, unknown>

  // `releases/latest` already excludes drafts and prereleases; treating a stray
  // one as "no update" keeps unfinished builds out of the UI.
  if (release.draft === true || release.prerelease === true) {
    return UP_TO_DATE
  }

  const tagName = release.tag_name
  const htmlUrl = release.html_url

  if (typeof tagName !== "string" || !RELEASE_TAG_PATTERN.test(tagName)) {
    return INVALID_RESPONSE
  }

  if (typeof htmlUrl !== "string" || !isAllowedReleaseUrl(htmlUrl)) {
    return INVALID_RESPONSE
  }

  const version = tagName.slice(1)

  if (compareSemver(version, currentVersion) <= 0) {
    return UP_TO_DATE
  }

  const dmgAsset = pickDmgAsset(release.assets)
  const notes = release.body
  const publishedAt = release.published_at

  return {
    available: {
      dmgSizeBytes: dmgAsset?.sizeBytes ?? null,
      dmgUrl: dmgAsset?.url ?? null,
      htmlUrl,
      notes:
        typeof notes === "string" && notes.trim().length > 0 ? notes : null,
      publishedAt: typeof publishedAt === "string" ? publishedAt : null,
      tagName,
      version
    },
    state: "available"
  }
}

/**
 * A toast fires only for an automatic check that found a version the user has
 * not been told about yet. Manual checks report inline in the About tab, and
 * failures never toast.
 */
export const shouldNotify = (
  status: UpdateStatus,
  lastNotifiedVersion: null | string
): boolean =>
  status.state === "available" &&
  status.checkReason === "auto" &&
  status.available !== null &&
  status.available.version !== lastNotifiedVersion
