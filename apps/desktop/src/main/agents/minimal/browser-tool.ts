import fs from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"

import type { JSONValue } from "@ai-sdk/provider"
import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import type { ToolApprovalStatus } from "ai"
import { tool } from "ai"
import type { WebContentsView } from "electron"
import { z } from "zod"

import {
  getAttachmentsDir,
  persistAttachmentBytes,
  resolveAttachmentRequestPath
} from "@/main/attachments"
import {
  BROWSER_INTERACTION_SCHEMAS,
  BROWSER_INTERACTION_WORLD_ID,
  BROWSER_PAGE_SNAPSHOT_SCRIPT,
  browserElementToModelJson,
  interactWithBrowser
} from "@/main/browser/interaction"
import type {
  BrowserElement,
  BrowserInteractionInput
} from "@/main/browser/interaction"
import {
  BrowserViewDisposedError,
  ensureBrowserView,
  loadBrowserViewUrlFromAgent,
  withBrowserLease,
  withPaintableBrowserView
} from "@/main/browser/manager"
import {
  resolveScreenshotSize,
  truncatePageText
} from "@/main/browser/page-content"
import { resolveAllowedBrowserUrl } from "@/main/browser/url-policy"
import { needsBrowserApproval } from "@/shared/agents/permission-mode"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"

/**
 * The agent half of the embedded browser. Every action drives the SAME
 * `WebContentsView` the user sees in the session's Browser panel (main/browser/
 * manager.ts owns it) — the agent never gets a private page, so what it does is
 * visible while it happens, and an agent-initiated navigation reveals the tab.
 *
 * All Electron work happens inside `withBrowserLease`, which pins the view
 * against LRU eviction for the duration of the call and rejects with
 * `BrowserViewDisposedError` instead of hanging if the view is torn down.
 */

// Navigation gives up waiting after this long and reports the partial state
// rather than failing: a page that streams forever is still usable, and the
// user can watch the rest land in the panel.
const NAVIGATION_TIMEOUT_MS = 15_000
// A view that just gained a paintable surface needs a beat before the
// compositor hands over a frame.
const BLANK_CAPTURE_RETRY_DELAY_MS = 300
const SCREENSHOT_MEDIA_TYPE = "image/png"

const NavigateActionSchema = z
  .object({
    action: z.literal("navigate"),
    url: z
      .string()
      .min(1)
      .describe(
        "Where to go: an http(s) URL, or a bare domain such as example.com (https:// is assumed). Other schemes are refused."
      )
  })
  .strict()
  .describe("Load a page in this session's browser and wait for it to settle.")

const ReadActionSchema = z
  .object({ action: z.literal("read") })
  .strict()
  .describe(
    "Extract the current page's visible text. Long pages are truncated head + tail."
  )

const ScreenshotActionSchema = z
  .object({ action: z.literal("screenshot") })
  .strict()
  .describe(
    "Capture the current page as an image. Use it for layout, charts, or rendering questions; prefer read for text."
  )

const BrowserInputSchema = z.discriminatedUnion("action", [
  NavigateActionSchema,
  ReadActionSchema,
  ScreenshotActionSchema,
  ...BROWSER_INTERACTION_SCHEMAS
])

/** How a navigation ended. `timeout` still carries the page state so far. */
type BrowserNavigationStatus = "aborted" | "loaded" | "timeout"

/**
 * Result shapes, written as one union of object literal types rather than
 * separate interfaces on purpose: an interface has no implicit index signature,
 * so it would not satisfy the SDK's `JSONValue` constraint on the `json`
 * branch of `toModelOutput`.
 */
type BrowserToolResult =
  | {
      action: "click" | "press" | "scroll" | "type"
      title: string
      url: string
    }
  | {
      action: "navigate"
      status: BrowserNavigationStatus
      title: string
      url: string
    }
  | {
      action: "read"
      elements: BrowserElement[]
      text: string
      title: string
      truncated: boolean
      url: string
    }
  | {
      action: "screenshot"
      height: number
      // `etyon-attachment://` ref: what the chat timeline renders, and the only
      // handle used to read the bytes back for vision-capable providers.
      imageUrl: string
      path: string
      title: string
      url: string
      width: number
    }

type BrowserNavigateResult = Extract<BrowserToolResult, { action: "navigate" }>
type BrowserReadResult = Extract<BrowserToolResult, { action: "read" }>
type BrowserScreenshotResult = Extract<
  BrowserToolResult,
  { action: "screenshot" }
>

interface PageSnapshot {
  elements: BrowserElement[]
  text: string
  title: string
  url: string
}

const BrowserElementSchema = z.object({
  checked: z.boolean().optional(),
  disabled: z.boolean().optional(),
  name: z.string().max(200),
  ref: z.string().min(1).max(100),
  role: z.string().max(80),
  type: z.string().max(100),
  value: z.string().max(1000).optional()
})

// Serialized inside the page so the IPC hop carries one string rather than a
// structured-clone of whatever the page defines.

// A named guard rather than an inline `instanceof` in the catch: the lint rule
// for type checks around a throw would rewrite that branch into a TypeError,
// and a torn-down view is not a type error.
const isBrowserViewDisposedError = (error: unknown): boolean =>
  error instanceof BrowserViewDisposedError

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const parsePageSnapshot = (raw: unknown): PageSnapshot => {
  if (typeof raw !== "string") {
    return { elements: [], text: "", title: "", url: "" }
  }

  try {
    const parsed: unknown = JSON.parse(raw)

    if (typeof parsed !== "object" || parsed === null) {
      return { elements: [], text: "", title: "", url: "" }
    }

    const snapshot = parsed as Partial<PageSnapshot>

    return {
      elements: Array.isArray(snapshot.elements)
        ? snapshot.elements
            .flatMap((element) => {
              const parsedElement = BrowserElementSchema.safeParse(element)
              return parsedElement.success ? [parsedElement.data] : []
            })
            .slice(0, 100)
        : [],
      text: typeof snapshot.text === "string" ? snapshot.text : "",
      title: typeof snapshot.title === "string" ? snapshot.title : "",
      url: typeof snapshot.url === "string" ? snapshot.url : ""
    }
  } catch {
    return { elements: [], text: "", title: "", url: "" }
  }
}

const requireLoadedPage = (view: WebContentsView): string => {
  const url = view.webContents.getURL()

  if (url === "") {
    throw new Error(
      'No page is loaded in this session\'s browser. Call browser with action "navigate" first.'
    )
  }

  return url
}

interface NavigationOutcome {
  error?: unknown
  status: BrowserNavigationStatus | "failed"
}

// Turns the load into a value up front: a load that fails AFTER the race was
// won by the timeout or an abort can then never surface as an unhandled
// rejection.
const settleNavigationLoad = async (
  load: Promise<void>
): Promise<NavigationOutcome> => {
  try {
    await load

    return { status: "loaded" }
  } catch (error) {
    return { error, status: "failed" }
  }
}

/**
 * Races the load against the timeout and the run's abort signal. An abort also
 * stops the page — a cancelled run must not keep loading in front of the user —
 * and the timer and listener are detached on every exit path.
 */
const awaitNavigation = async ({
  load,
  signal,
  view
}: {
  load: Promise<void>
  signal: AbortSignal | undefined
  view: WebContentsView
}): Promise<BrowserNavigationStatus> => {
  const timeout = Promise.withResolvers<NavigationOutcome>()
  const aborted = Promise.withResolvers<NavigationOutcome>()
  const timeoutHandle = setTimeout(() => {
    timeout.resolve({ status: "timeout" })
  }, NAVIGATION_TIMEOUT_MS)
  const onAbort = (): void => {
    if (!view.webContents.isDestroyed()) {
      view.webContents.stop()
    }

    aborted.resolve({ status: "aborted" })
  }

  if (signal?.aborted) {
    onAbort()
  } else {
    signal?.addEventListener("abort", onAbort)
  }

  try {
    const outcome = await Promise.race([
      settleNavigationLoad(load),
      timeout.promise,
      aborted.promise
    ])

    if (outcome.status === "failed") {
      throw new Error(`Navigation failed: ${getErrorMessage(outcome.error)}`)
    }

    return outcome.status
  } finally {
    clearTimeout(timeoutHandle)
    signal?.removeEventListener("abort", onAbort)
  }
}

const runNavigate = (
  sessionId: string,
  input: string,
  signal: AbortSignal | undefined
): Promise<BrowserNavigateResult> => {
  const url = resolveAllowedBrowserUrl(input)

  if (url === null) {
    throw new Error(
      `Cannot browse to "${input}": only http and https URLs are allowed.`
    )
  }

  return withBrowserLease(sessionId, async (view) => {
    const status = await awaitNavigation({
      load: loadBrowserViewUrlFromAgent({ sessionId, url }),
      signal,
      view
    })

    return {
      action: "navigate",
      status,
      title: view.webContents.getTitle(),
      url: view.webContents.getURL() || url
    }
  })
}

const runRead = (sessionId: string): Promise<BrowserReadResult> =>
  withBrowserLease(sessionId, async (view) => {
    const pageUrl = requireLoadedPage(view)
    const snapshot = parsePageSnapshot(
      await view.webContents.executeJavaScriptInIsolatedWorld(
        BROWSER_INTERACTION_WORLD_ID,
        [{ code: BROWSER_PAGE_SNAPSHOT_SCRIPT }]
      )
    )
    const { text, truncated } = truncatePageText(snapshot.text)

    return {
      action: "read",
      elements: snapshot.elements,
      text,
      title: snapshot.title || view.webContents.getTitle(),
      truncated,
      url: snapshot.url || pageUrl
    }
  })

const capturePageWithRetry = async (view: WebContentsView) => {
  const image = await view.webContents.capturePage()

  if (!image.isEmpty()) {
    return image
  }

  await delay(BLANK_CAPTURE_RETRY_DELAY_MS)

  return await view.webContents.capturePage()
}

const runScreenshot = (sessionId: string): Promise<BrowserScreenshotResult> =>
  withBrowserLease(sessionId, async (view) => {
    const pageUrl = requireLoadedPage(view)
    const captured = await withPaintableBrowserView(
      sessionId,
      (paintableView) => capturePageWithRetry(paintableView)
    )

    if (captured.isEmpty()) {
      throw new Error(
        "The browser view produced no frame to capture. Open the Browser panel for this session and try again."
      )
    }

    const size = captured.getSize()
    const target = resolveScreenshotSize(size)
    const scaled =
      target.width === size.width && target.height === size.height
        ? captured
        : captured.resize({
            height: target.height,
            quality: "good",
            width: target.width
          })
    const persisted = await persistAttachmentBytes({
      bytes: scaled.toPNG(),
      mediaType: SCREENSHOT_MEDIA_TYPE
    })

    if (!persisted) {
      throw new Error("Failed to store the screenshot.")
    }

    const storedSize = scaled.getSize()

    return {
      action: "screenshot",
      height: storedSize.height,
      imageUrl: persisted.url,
      path: persisted.path,
      title: view.webContents.getTitle(),
      url: pageUrl,
      width: storedSize.width
    }
  })

/**
 * Reads a stored screenshot back for the model. The url is resolved through the
 * attachment protocol's own containment check, so a hand-edited history entry
 * cannot make this read a file outside the attachments directory.
 */
const readScreenshotBytes = async (
  imageUrl: string
): Promise<Buffer | null> => {
  const filePath = resolveAttachmentRequestPath({
    attachmentsDir: getAttachmentsDir(),
    requestUrl: imageUrl
  })

  if (!filePath) {
    return null
  }

  try {
    return await fs.readFile(filePath)
  } catch {
    return null
  }
}

/**
 * Drives the session's embedded browser. `supportsToolResultImages` decides
 * whether a screenshot reaches the model as an actual image: only the native
 * Anthropic provider turns a `content` tool output with a file part into a real
 * `tool_result` image block. The OpenAI-compatible chat-completions path (which
 * every relay model here uses) JSON-stringifies that same structure, which
 * would dump base64 into the transcript — those providers get the metadata
 * summary instead. Base64 never enters the persisted result either way.
 */
const runBrowserInteraction = (
  sessionId: string,
  input: BrowserInteractionInput,
  signal?: AbortSignal
): Promise<BrowserToolResult> =>
  withBrowserLease(sessionId, async (view) => {
    requireLoadedPage(view)
    await withPaintableBrowserView(
      sessionId,
      async (paintableView, ownerWindow) => {
        await interactWithBrowser(
          paintableView.webContents,
          input,
          signal,
          ownerWindow ?? undefined
        )
      }
    )
    return {
      action: input.action,
      title: view.webContents.getTitle(),
      url: view.webContents.getURL()
    }
  })

export const buildBrowserTool = ({
  chatSessionId,
  supportsToolResultImages
}: {
  chatSessionId: string
  supportsToolResultImages: boolean
}) =>
  tool({
    description:
      "Drive this chat session's embedded browser: navigate, read text and fresh element refs, screenshot, click, type, scroll, or press a key. Use refs from the latest read; read again after changes. It is the same live view the user sees in the app's Browser panel, and it keeps their logged-in sessions, so each call needs user approval. Only http and https URLs work.",
    execute: async (inputData, context): Promise<BrowserToolResult> => {
      // Recreates the view when the panel was never opened or the LRU reclaimed
      // it (restoring the last url), so every action has a page to act on.
      ensureBrowserView({ sessionId: chatSessionId })

      try {
        if (inputData.action === "navigate") {
          return await runNavigate(
            chatSessionId,
            inputData.url,
            context?.abortSignal
          )
        }

        if (inputData.action === "read") {
          return await runRead(chatSessionId)
        }

        if (inputData.action === "screenshot") {
          return await runScreenshot(chatSessionId)
        }
        return await runBrowserInteraction(
          chatSessionId,
          inputData,
          context?.abortSignal
        )
      } catch (error) {
        if (isBrowserViewDisposedError(error)) {
          throw new Error(
            "The browser view for this chat session was closed before the action finished.",
            { cause: error }
          )
        }

        throw error
      }
    },
    inputSchema: BrowserInputSchema,
    toModelOutput: async ({ output }): Promise<ToolResultOutput> => {
      if (output.action !== "screenshot" || !supportsToolResultImages) {
        const value: JSONValue =
          output.action === "read"
            ? {
                ...output,
                elements: output.elements.map(browserElementToModelJson)
              }
            : output
        return { type: "json", value }
      }

      const bytes = await readScreenshotBytes(output.imageUrl)

      if (!bytes) {
        return { type: "json", value: output }
      }

      return {
        type: "content",
        value: [
          {
            text: `Screenshot of ${output.url} (${output.width}x${output.height}).`,
            type: "text"
          },
          {
            data: { data: bytes.toString("base64"), type: "data" },
            mediaType: SCREENSHOT_MEDIA_TYPE,
            type: "file"
          }
        ]
      }
    }
  })

/**
 * Call-site approval policy for the browser tool (v7 `toolApproval`). Unlike
 * bash there is no remembered-command escape hatch — every navigate/read/
 * screenshot is gated outside bypass mode (see `needsBrowserApproval`).
 */
export const buildBrowserToolApproval =
  (permissionMode: AgentPermissionMode) => (): ToolApprovalStatus =>
    needsBrowserApproval(permissionMode) ? "user-approval" : undefined
