import { describe, expect, it } from "vite-plus/test"

import {
  getBrowserScreenshotView,
  getBrowserToolAction,
  getBrowserToolPreview,
  getBrowserToolTargetUrl,
  isBrowserToolPart
} from "@/renderer/lib/chat/browser-tool-ui"
import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"

const asPart = (part: unknown): ChatToolPart => part as ChatToolPart

const navigateApproval = asPart({
  input: { action: "navigate", url: "https://example.com/docs" },
  state: "approval-requested",
  toolCallId: "tc-1",
  type: "tool-browser"
})

const screenshotResult = asPart({
  input: { action: "screenshot" },
  output: {
    action: "screenshot",
    height: 800,
    imageUrl: "etyon-attachment://media/abc.png",
    path: "/home/u/.config/etyon/attachments/abc.png",
    title: "Example",
    url: "https://example.com/",
    width: 1280
  },
  state: "output-available",
  toolCallId: "tc-2",
  type: "tool-browser"
})

describe("isBrowserToolPart", () => {
  it("recognizes static and dynamic browser tool parts", () => {
    expect(isBrowserToolPart({ type: "tool-browser" })).toBe(true)
    expect(
      isBrowserToolPart({ toolName: "browser", type: "dynamic-tool" })
    ).toBe(true)
    expect(isBrowserToolPart({ type: "tool-bash" })).toBe(false)
    expect(isBrowserToolPart({ type: "text" })).toBe(false)
    expect(isBrowserToolPart(null)).toBe(false)
  })
})

describe("getBrowserToolAction", () => {
  it("reads the action from the input while approval is pending", () => {
    expect(getBrowserToolAction(navigateApproval)).toBe("navigate")
  })

  it("prefers the settled output action", () => {
    expect(getBrowserToolAction(screenshotResult)).toBe("screenshot")
  })

  it("returns null for a missing or unknown action", () => {
    expect(
      getBrowserToolAction(asPart({ input: {}, state: "input-available" }))
    ).toBeNull()
    expect(
      getBrowserToolAction(
        asPart({ input: { action: "click" }, state: "input-available" })
      )
    ).toBeNull()
  })
})

describe("getBrowserToolTargetUrl", () => {
  it("shows the requested url before the call settles", () => {
    expect(getBrowserToolTargetUrl(navigateApproval)).toBe(
      "https://example.com/docs"
    )
  })

  it("prefers the settled url once the page has loaded", () => {
    expect(
      getBrowserToolTargetUrl(
        asPart({
          input: { action: "navigate", url: "example.com" },
          output: {
            action: "navigate",
            status: "loaded",
            title: "Example",
            url: "https://example.com/"
          },
          state: "output-available"
        })
      )
    ).toBe("https://example.com/")
  })

  it("is empty for a read/screenshot that has not run yet", () => {
    expect(
      getBrowserToolTargetUrl(
        asPart({ input: { action: "read" }, state: "approval-requested" })
      )
    ).toBe("")
  })
})

describe("getBrowserToolPreview", () => {
  it("previews page text for read", () => {
    expect(
      getBrowserToolPreview(
        asPart({
          input: { action: "read" },
          output: { action: "read", text: "Hello page", truncated: false },
          state: "output-available"
        })
      )
    ).toBe("Hello page")
  })

  it("previews the stored size for a screenshot", () => {
    expect(getBrowserToolPreview(screenshotResult)).toBe("1280×800")
  })

  it("previews the page title for a navigation", () => {
    expect(
      getBrowserToolPreview(
        asPart({
          input: { action: "navigate", url: "example.com" },
          output: { action: "navigate", status: "loaded", title: "Example" },
          state: "output-available"
        })
      )
    ).toBe("Example")
  })

  it("is empty while the call is still pending", () => {
    expect(getBrowserToolPreview(navigateApproval)).toBe("")
  })
})

describe("getBrowserScreenshotView", () => {
  it("returns the attachment ref and stored size for a settled screenshot", () => {
    expect(getBrowserScreenshotView(screenshotResult)).toEqual({
      height: 800,
      imageUrl: "etyon-attachment://media/abc.png",
      pageUrl: "https://example.com/",
      width: 1280
    })
  })

  it("returns null for other browser actions and unsettled parts", () => {
    expect(getBrowserScreenshotView(navigateApproval)).toBeNull()
    expect(
      getBrowserScreenshotView(
        asPart({
          input: { action: "read" },
          output: { action: "read", text: "x" },
          state: "output-available",
          type: "tool-browser"
        })
      )
    ).toBeNull()
  })

  it("returns null for non-browser image-like parts", () => {
    expect(
      getBrowserScreenshotView(
        asPart({
          output: { imageUrl: "etyon-attachment://media/abc.png" },
          state: "output-available",
          type: "tool-imagen"
        })
      )
    ).toBeNull()
  })
})
