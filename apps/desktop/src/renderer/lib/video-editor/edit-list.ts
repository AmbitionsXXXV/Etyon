/**
 * The video editor's model: an ordered list of cuts over the original clip
 * files. Nothing here touches a file — trim, split, reorder, and remove only
 * change the list, so the originals stay intact and every edit is cheap to undo.
 *
 * Pure (no React, no window) so it stays node-testable.
 */

export interface EditClip {
  /** The clip's full length, from its metadata. */
  durationMs: number
  id: string
  /** Where the cut ends, in the clip's own time. */
  outMs: number
  /** Where the cut starts, in the clip's own time. */
  inMs: number
  /** Project-relative path of the original file. */
  path: string
  title: string
}

export type EditList = readonly EditClip[]

/** Shortest cut trim and split may leave, so a clip never becomes empty. */
export const MIN_CUT_MS = 200

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

export const getCutLengthMs = (clip: EditClip): number => clip.outMs - clip.inMs

export const getTotalLengthMs = (list: EditList): number =>
  list.reduce((total, clip) => total + getCutLengthMs(clip), 0)

export const addClip = (
  list: EditList,
  clip: Omit<EditClip, "inMs" | "outMs">
): EditList => [...list, { ...clip, inMs: 0, outMs: clip.durationMs }]

export const removeClip = (list: EditList, id: string): EditList =>
  list.filter((clip) => clip.id !== id)

/** Moves a clip by `offset` places, clamped to the ends of the list. */
export const moveClip = (
  list: EditList,
  id: string,
  offset: number
): EditList => {
  const from = list.findIndex((clip) => clip.id === id)

  if (from === -1) {
    return list
  }

  const to = clamp(from + offset, 0, list.length - 1)

  if (to === from) {
    return list
  }

  const next = [...list]
  const [clip] = next.splice(from, 1)

  if (clip) {
    next.splice(to, 0, clip)
  }

  return next
}

/** Sets a cut's start and end, keeping it inside the clip and ≥ MIN_CUT_MS. */
export const trimClip = (
  list: EditList,
  id: string,
  { inMs, outMs }: { inMs?: number; outMs?: number }
): EditList =>
  list.map((clip) => {
    if (clip.id !== id) {
      return clip
    }

    const nextIn = clamp(
      inMs ?? clip.inMs,
      0,
      Math.max(0, clip.durationMs - MIN_CUT_MS)
    )
    const nextOut = clamp(
      outMs ?? clip.outMs,
      nextIn + MIN_CUT_MS,
      clip.durationMs
    )

    return { ...clip, inMs: nextIn, outMs: nextOut }
  })

/**
 * Splits a cut at a point in the clip's own time into two cuts over the same
 * file. A point too close to either end leaves the list unchanged.
 */
export const splitClip = (
  list: EditList,
  id: string,
  atMs: number,
  newId: string
): EditList =>
  list.flatMap((clip) => {
    if (
      clip.id !== id ||
      atMs - clip.inMs < MIN_CUT_MS ||
      clip.outMs - atMs < MIN_CUT_MS
    ) {
      return [clip]
    }

    return [
      { ...clip, outMs: atMs },
      { ...clip, id: newId, inMs: atMs }
    ]
  })

/**
 * Where a point on the edited timeline falls: which cut, and the time inside
 * that clip's file. Past the end it lands on the last cut's end.
 */
export const locateTimelineMs = (
  list: EditList,
  timelineMs: number
): { clipIndex: number; fileMs: number } | null => {
  let start = 0

  for (const [clipIndex, clip] of list.entries()) {
    const length = getCutLengthMs(clip)

    if (timelineMs < start + length) {
      return {
        clipIndex,
        fileMs: clip.inMs + Math.max(0, timelineMs - start)
      }
    }

    start += length
  }

  const lastIndex = list.length - 1
  const last = list[lastIndex]

  return last ? { clipIndex: lastIndex, fileMs: last.outMs } : null
}

/** The timeline time where a cut starts. */
export const getCutStartMs = (list: EditList, clipIndex: number): number =>
  list
    .slice(0, clipIndex)
    .reduce((total, clip) => total + getCutLengthMs(clip), 0)

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60

/** 0:04.2 style, tenths of a second. */
export const formatEditTime = (ms: number): string => {
  const totalTenths = Math.round(ms / 100)
  const minutes = Math.floor(totalTenths / (SECONDS_PER_MINUTE * 10))
  const seconds = (totalTenths / 10) % SECONDS_PER_MINUTE

  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`
}

export const msToSeconds = (ms: number): number => ms / MS_PER_SECOND
