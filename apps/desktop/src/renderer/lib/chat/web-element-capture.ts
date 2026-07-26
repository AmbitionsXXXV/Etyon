import type { ChatWebElementMention, PickedWebElement } from "@etyon/rpc"
import { useSyncExternalStore } from "react"

/**
 * Hand-off channel from the browser panel's element picker to the composer.
 * The two live in unrelated subtrees, so the pick result travels through a
 * module-level store instead of props (same shape as
 * project-panel-navigation.ts): the panel calls
 * {@link publishPickedWebElement}, the prompt input inserts the mention node
 * and then calls {@link clearPickedWebElement}.
 *
 * Nothing here touches `window` or rpc at load time, so it stays node-testable.
 */

// Long enough to keep a readable `tag#id.class`, short enough for a chip.
const MAX_LABEL_CHARS = 40

export interface PickedWebElementRequest {
  mention: ChatWebElementMention
  requestId: number
}

/** Chip text for a picked element, e.g. `h1#hero` or `div.card`. */
export const buildWebElementMentionLabel = ({
  classes,
  id,
  tagName
}: Pick<PickedWebElement, "classes" | "id" | "tagName">): string => {
  const firstClass = classes.at(0)
  const label = `${tagName}${id ? `#${id}` : ""}${firstClass ? `.${firstClass}` : ""}`

  return label.length > MAX_LABEL_CHARS
    ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…`
    : label
}

/**
 * Narrows a pick result to the mention payload. `rect` and the raw class list
 * are dropped: they only feed the label, and nothing downstream consumes them.
 */
export const createWebElementMention = (
  element: PickedWebElement
): ChatWebElementMention => ({
  // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- `element` is a plain payload object, not a DOM node.
  innerText: element.innerText,
  kind: "webElement",
  label: buildWebElementMentionLabel(element),
  outerHtml: element.outerHtml,
  selector: element.selector,
  styles: element.styles,
  tagName: element.tagName,
  title: element.title,
  url: element.url
})

let currentRequest: PickedWebElementRequest | null = null
let nextRequestId = 0
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const listener of listeners) {
    listener()
  }
}

/**
 * Queues a picked element for the composer. The monotonic `requestId` lets the
 * same element be picked twice in a row and still re-trigger the insert.
 */
export const publishPickedWebElement = (
  mention: ChatWebElementMention
): void => {
  nextRequestId += 1
  currentRequest = {
    mention,
    requestId: nextRequestId
  }
  emit()
}

/** Drops the pending element once the composer has inserted it. */
export const clearPickedWebElement = (): void => {
  if (currentRequest === null) {
    return
  }

  currentRequest = null
  emit()
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): PickedWebElementRequest | null => currentRequest

/** Latest pending element, exposed for direct (non-React) assertions in tests. */
export const getPickedWebElementSnapshot = getSnapshot

/** Subscribes a component to the latest picked element. */
export const usePickedWebElement = (): PickedWebElementRequest | null =>
  // Client and server snapshots are identical (the store is empty on the
  // server), so both getters read the same value.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
