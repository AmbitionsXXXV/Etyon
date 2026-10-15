import { useSyncExternalStore } from "react"

import { addClip } from "@/renderer/lib/video-editor/edit-list"
import type { EditClip, EditList } from "@/renderer/lib/video-editor/edit-list"

/**
 * One edit list per chat session, outside React so it survives the panel tab
 * closing and the session switching away and back. Mirrored to localStorage so
 * a reload keeps the cuts; storage failures (private mode, quota) only cost
 * that persistence.
 */

const STORAGE_PREFIX = "etyon:video-editor:"
const EMPTY_LIST: EditList = []
const lists = new Map<string, EditList>()
const listeners = new Set<() => void>()

const isEditClip = (value: unknown): value is EditClip => {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const clip = value as Record<string, unknown>

  return (
    typeof clip.id === "string" &&
    typeof clip.path === "string" &&
    typeof clip.title === "string" &&
    typeof clip.durationMs === "number" &&
    typeof clip.inMs === "number" &&
    typeof clip.outMs === "number"
  )
}

const readStored = (sessionId: string): EditList => {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${sessionId}`)
    const parsed: unknown = raw ? JSON.parse(raw) : []

    return Array.isArray(parsed) ? parsed.filter(isEditClip) : EMPTY_LIST
  } catch {
    return EMPTY_LIST
  }
}

export const getEditList = (sessionId: string): EditList => {
  const cached = lists.get(sessionId)

  if (cached) {
    return cached
  }

  const stored = readStored(sessionId)

  lists.set(sessionId, stored)

  return stored
}

export const setEditList = (sessionId: string, next: EditList): void => {
  lists.set(sessionId, next)

  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${sessionId}`,
      JSON.stringify(next)
    )
  } catch {
    // Keep the in-memory list; only persistence is lost.
  }

  for (const listener of listeners) {
    listener()
  }
}

export const updateEditList = (
  sessionId: string,
  update: (list: EditList) => EditList
): void => setEditList(sessionId, update(getEditList(sessionId)))

/**
 * Appends a clip from the chat. Its length is filled in by the editor once the
 * file's metadata loads, unless the caller already knows it.
 */
export const addClipToEditor = (
  sessionId: string,
  clip: { durationMs?: number; path: string; title: string }
): void =>
  updateEditList(sessionId, (list) =>
    addClip(list, {
      durationMs: clip.durationMs ?? 0,
      id: crypto.randomUUID(),
      path: clip.path,
      title: clip.title
    })
  )

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export const useEditList = (sessionId: string): EditList =>
  useSyncExternalStore(subscribe, () => getEditList(sessionId))
