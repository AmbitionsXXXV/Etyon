import { PickedWebElementSchema } from "@etyon/rpc"
import type { PickedWebElement } from "@etyon/rpc"
import type { WebContents } from "electron"

import { withBrowserLease } from "@/main/browser/manager"

/**
 * User-driven element picking inside the embedded browser. The browsing
 * partition has no preload and no node integration (plans/browser-tab.md D2),
 * so there is no message channel between the page and the renderer: the picker
 * is injected from main into an isolated world, and its result comes back as
 * the resolved value of the injected promise.
 *
 * The isolated world shares the DOM (the highlight overlay is visible on the
 * page) but not the JS globals, so the page can neither see nor call the cancel
 * hook the script installs.
 */

// A fixed, private world id. Isolated worlds persist per document, so the same
// id is reused to reach the cancel hook a previous injection installed.
const PICKER_WORLD_ID = 1013
// A pick left running forever would pin the view against LRU eviction through
// its lease, so it gives up on its own.
const PICK_TIMEOUT_MS = 120_000

const PICKER_SCRIPT = `(async () => {
  const OVERLAY_ID = "__etyon_element_picker_overlay__"
  const MAX_SELECTOR_DEPTH = 5
  const MAX_CLASSES = 5
  const MAX_INNER_TEXT_CHARS = 300
  const MAX_OUTER_HTML_CHARS = 4000
  const STYLE_KEYS = [
    "backgroundColor",
    "borderRadius",
    "color",
    "display",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "margin",
    "padding",
    "position"
  ]

  // A superseded pick must tear its own listeners down, otherwise two overlays
  // fight over the same DOM and the older cleanup deletes the newer hook.
  const previousCancel = globalThis.__etyonCancelElementPick

  if (typeof previousCancel === "function") {
    previousCancel()
  }

  const formatLabel = (element) => {
    const id = element.id ? "#" + element.id : ""
    const firstClass = element.classList.length > 0 ? "." + element.classList[0] : ""

    return element.tagName.toLowerCase() + id + firstClass
  }

  const buildSelector = (element) => {
    if (element.id) {
      const idSelector = "#" + CSS.escape(element.id)

      try {
        if (document.querySelectorAll(idSelector).length === 1) {
          return idSelector
        }
      } catch {
        // An id that cannot be escaped into a valid selector falls through to
        // the structural path below.
      }
    }

    const parts = []
    let current = element
    let depth = 0

    while (current && current.nodeType === 1 && depth < MAX_SELECTOR_DEPTH) {
      const tag = current.tagName.toLowerCase()
      const parent = current.parentElement

      if (!parent) {
        parts.unshift(tag)
        break
      }

      const sameTag = Array.prototype.filter.call(
        parent.children,
        (child) => child.tagName === current.tagName
      )

      parts.unshift(
        sameTag.length > 1
          ? tag + ":nth-of-type(" + (sameTag.indexOf(current) + 1) + ")"
          : tag
      )
      current = parent
      depth += 1
    }

    return parts.join(" > ")
  }

  const readStyles = (element) => {
    const computed = window.getComputedStyle(element)
    const styles = {}

    for (const key of STYLE_KEYS) {
      const value = computed[key]

      if (typeof value === "string" && value !== "") {
        styles[key] = value
      }
    }

    return styles
  }

  const describeElement = (element) => {
    const rect = element.getBoundingClientRect()
    const text = element.innerText || element.textContent || ""

    return {
      classes: Array.from(element.classList).slice(0, MAX_CLASSES),
      id: element.id || null,
      innerText: text.trim().slice(0, MAX_INNER_TEXT_CHARS),
      outerHtml: element.outerHTML.slice(0, MAX_OUTER_HTML_CHARS),
      rect: {
        height: Math.round(rect.height),
        width: Math.round(rect.width),
        x: Math.round(rect.x),
        y: Math.round(rect.y)
      },
      selector: buildSelector(element),
      styles: readStyles(element),
      tagName: element.tagName.toLowerCase(),
      title: document.title,
      url: location.href
    }
  }

  document.getElementById(OVERLAY_ID)?.remove()

  const overlay = document.createElement("div")

  overlay.id = OVERLAY_ID
  overlay.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "width:0",
    "height:0",
    "display:none",
    "box-sizing:border-box",
    "pointer-events:none",
    "z-index:2147483647",
    "outline:2px solid rgb(59,130,246)",
    "background:rgba(59,130,246,0.18)"
  ].join(";")

  const badge = document.createElement("div")

  badge.style.cssText = [
    "position:absolute",
    "top:-20px",
    "left:0",
    "max-width:320px",
    "overflow:hidden",
    "white-space:nowrap",
    "text-overflow:ellipsis",
    "padding:1px 6px",
    "border-radius:3px",
    "background:rgb(59,130,246)",
    "color:#fff",
    "font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace"
  ].join(";")
  overlay.append(badge)
  document.documentElement.append(overlay)

  const previousCursor = document.documentElement.style.cursor

  document.documentElement.style.cursor = "crosshair"

  return await new Promise((resolve) => {
    let hovered = null
    let isSettled = false

    const handleMouseMove = (event) => {
      const element = document.elementFromPoint(event.clientX, event.clientY)

      if (!element || overlay.contains(element)) {
        return
      }

      const rect = element.getBoundingClientRect()

      hovered = element
      overlay.style.display = "block"
      overlay.style.top = rect.top + "px"
      overlay.style.left = rect.left + "px"
      overlay.style.width = rect.width + "px"
      overlay.style.height = rect.height + "px"
      badge.textContent = formatLabel(element)
    }

    const handleClick = (event) => {
      event.preventDefault()
      event.stopImmediatePropagation()

      const target = hovered ?? (event.target instanceof Element ? event.target : null)

      finish(target ? describeElement(target) : null)
    }

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      finish(null)
    }

    const cleanUp = () => {
      document.removeEventListener("mousemove", handleMouseMove, true)
      document.removeEventListener("click", handleClick, true)
      document.removeEventListener("keydown", handleKeyDown, true)
      overlay.remove()
      document.documentElement.style.cursor = previousCursor
      delete globalThis.__etyonCancelElementPick
    }

    function finish(value) {
      if (isSettled) {
        return
      }

      isSettled = true

      try {
        cleanUp()
      } finally {
        resolve(value)
      }
    }

    document.addEventListener("mousemove", handleMouseMove, true)
    document.addEventListener("click", handleClick, true)
    document.addEventListener("keydown", handleKeyDown, true)
    globalThis.__etyonCancelElementPick = () => {
      finish(null)
    }
  })
})()`

const CANCEL_SCRIPT = `(() => {
  const cancel = globalThis.__etyonCancelElementPick

  if (typeof cancel === "function") {
    cancel()
  }

  return true
})()`

export interface ElementPickInput {
  sessionId: string
}

// One abort handle per session: a second pick, a navigation, a torn-down view,
// or the renderer's cancel all funnel through it.
const activePicks = new Map<string, () => void>()

/**
 * Best-effort in-page teardown for the abort routes (navigation, timeout,
 * renderer cancel). A no-op once the script has already resolved, and skipped
 * entirely for a destroyed view, where the world no longer exists.
 */
const cancelPickInPage = async (webContents: WebContents): Promise<void> => {
  if (webContents.isDestroyed()) {
    return
  }

  try {
    await webContents.executeJavaScriptInIsolatedWorld(PICKER_WORLD_ID, [
      { code: CANCEL_SCRIPT }
    ])
  } catch {
    // The frame may have gone away mid-cancel; the world dies with it.
  }
}

/** Cancels the session's in-flight pick, if any. Idempotent. */
export const cancelElementPick = ({ sessionId }: ElementPickInput): void => {
  activePicks.get(sessionId)?.()
}

/**
 * Runs the picker and resolves with the clicked element, or `null` for every
 * cancel route. Held inside `withBrowserLease` so the LRU cannot evict the view
 * while the user is hovering, and so a disposal rejects instead of hanging.
 */
export const runElementPick = async ({
  sessionId
}: ElementPickInput): Promise<PickedWebElement | null> => {
  cancelElementPick({ sessionId })

  return await withBrowserLease(sessionId, async (view) => {
    const { webContents } = view
    const { promise: aborted, resolve: resolveAborted } =
      Promise.withResolvers<null>()
    const abortPick = (): void => {
      resolveAborted(null)
    }
    // Only the structural slice the picker cares about; the deprecated
    // positional arguments of this event are ignored.
    const handleNavigation = (details: { isMainFrame: boolean }): void => {
      if (details.isMainFrame) {
        abortPick()
      }
    }
    const timeoutHandle = setTimeout(abortPick, PICK_TIMEOUT_MS)

    webContents.on("did-start-navigation", handleNavigation)
    webContents.once("destroyed", abortPick)
    activePicks.set(sessionId, abortPick)

    try {
      const picked: unknown = await Promise.race([
        webContents.executeJavaScriptInIsolatedWorld(PICKER_WORLD_ID, [
          { code: PICKER_SCRIPT }
        ]),
        aborted
      ])

      if (picked === null) {
        // Only the still-registered pick may reach into the page: a superseded
        // one would tear down the pick that replaced it.
        if (activePicks.get(sessionId) === abortPick) {
          await cancelPickInPage(webContents)
        }

        return null
      }

      const parsed = PickedWebElementSchema.safeParse(picked)

      return parsed.success ? parsed.data : null
    } finally {
      clearTimeout(timeoutHandle)
      webContents.off("did-start-navigation", handleNavigation)
      webContents.off("destroyed", abortPick)

      if (activePicks.get(sessionId) === abortPick) {
        activePicks.delete(sessionId)
      }
    }
  })
}
