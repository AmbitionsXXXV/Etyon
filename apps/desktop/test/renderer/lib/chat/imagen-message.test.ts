import { describe, expect, it } from "vite-plus/test"

import {
  getImageFileName,
  getImagenErrorMessage,
  getImagenPartState,
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  isImagenToolPart,
  parseImageAspectRatio,
  stepImageZoom
} from "@/renderer/lib/chat/imagen-message"
import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"

describe("imagen tool parts", () => {
  it("recognizes static and dynamic imagen tool parts", () => {
    expect(isImagenToolPart({ type: "tool-imagen" })).toBe(true)
    expect(isImagenToolPart({ toolName: "imagen", type: "dynamic-tool" })).toBe(
      true
    )
    expect(isImagenToolPart({ type: "tool-artifact" })).toBe(false)
    expect(isImagenToolPart({ type: "text" })).toBe(false)
    expect(isImagenToolPart(null)).toBe(false)
  })

  it("parses image sizes into aspect ratios with a square fallback", () => {
    expect(parseImageAspectRatio("1024x1024")).toBe(1)
    expect(parseImageAspectRatio("1536x1024")).toBe(1.5)
    expect(parseImageAspectRatio("1024x1536")).toBeCloseTo(0.6667, 3)
    expect(parseImageAspectRatio()).toBe(1)
    expect(parseImageAspectRatio("weird")).toBe(1)
  })
})

describe("stepImageZoom", () => {
  it("steps between discrete zoom stops", () => {
    expect(stepImageZoom(1, "in")).toBe(1.5)
    expect(stepImageZoom(1.5, "in")).toBe(2)
    expect(stepImageZoom(1, "out")).toBe(0.75)
    expect(stepImageZoom(2, "out")).toBe(1.5)
  })

  it("clamps at the ends of the zoom range", () => {
    expect(stepImageZoom(IMAGE_ZOOM_MAX, "in")).toBe(IMAGE_ZOOM_MAX)
    expect(stepImageZoom(IMAGE_ZOOM_MIN, "out")).toBe(IMAGE_ZOOM_MIN)
  })

  it("snaps off-grid values to the adjacent stop", () => {
    expect(stepImageZoom(1.2, "in")).toBe(1.5)
    expect(stepImageZoom(1.2, "out")).toBe(1)
  })
})

describe("getImageFileName", () => {
  it("returns the path basename", () => {
    expect(getImageFileName("generated-images/shiba-1a2b3c4d.png")).toBe(
      "shiba-1a2b3c4d.png"
    )
    expect(getImageFileName("shiba.png")).toBe("shiba.png")
  })

  it("falls back to a default name for empty paths", () => {
    expect(getImageFileName("")).toBe("image.png")
    expect(getImageFileName("generated-images/")).toBe("image.png")
  })
})

describe("getImagenPartState", () => {
  it("returns null for non-imagen parts", () => {
    expect(
      getImagenPartState({ type: "tool-artifact" } as unknown as ChatToolPart)
    ).toBeNull()
  })

  it("reports a generating state from the input while in flight", () => {
    const state = getImagenPartState({
      input: { size: "1024x1536", title: "Shiba" },
      state: "input-available",
      toolCallId: "tc-img",
      type: "tool-imagen"
    } as unknown as ChatToolPart)

    expect(state?.phase).toBe("generating")
    expect(state?.path).toBe("")
    expect(state?.title).toBe("Shiba")
    expect(state?.aspectRatio).toBeCloseTo(0.6667, 3)
  })

  it("reports a published state with the file path once finished", () => {
    const state = getImagenPartState({
      output: {
        kind: "image",
        path: "generated-images/shiba-1a2b3c4d.png",
        size: "1536x1024",
        title: "Shiba"
      },
      state: "output-available",
      toolCallId: "tc-img",
      type: "tool-imagen"
    } as unknown as ChatToolPart)

    expect(state?.phase).toBe("published")
    expect(state?.path).toBe("generated-images/shiba-1a2b3c4d.png")
    expect(state?.aspectRatio).toBe(1.5)
  })

  it("reports an error state on failure with the gateway's reason", () => {
    const state = getImagenPartState({
      errorText: JSON.stringify({
        code: "TOOL_EXECUTION_FAILED",
        message:
          "Failed after 3 attempts. Last error: 分组 auto 下模型 gpt-image-2 的可用渠道不存在"
      }),
      input: { size: "1024x1024", title: "Shiba" },
      state: "output-error",
      toolCallId: "tc-img",
      type: "tool-imagen"
    } as unknown as ChatToolPart)

    expect(state?.phase).toBe("error")
    expect(state?.errorMessage).toContain("gpt-image-2 的可用渠道不存在")
  })
})

describe("getImagenErrorMessage", () => {
  it("extracts the message field from JSON error text", () => {
    expect(
      getImagenErrorMessage({
        errorText: '{"message":"Client connection prematurely closed."}',
        state: "output-error",
        type: "tool-imagen"
      } as unknown as ChatToolPart)
    ).toBe("Client connection prematurely closed.")
  })

  it("falls back to raw text and truncates long messages", () => {
    expect(
      getImagenErrorMessage({
        errorText: "plain failure",
        state: "output-error",
        type: "tool-imagen"
      } as unknown as ChatToolPart)
    ).toBe("plain failure")
    expect(
      getImagenErrorMessage({
        errorText: "x".repeat(500),
        state: "output-error",
        type: "tool-imagen"
      } as unknown as ChatToolPart)?.length
    ).toBe(200)
  })

  it("returns undefined when there is no error text", () => {
    expect(
      getImagenErrorMessage({
        state: "output-error",
        type: "tool-imagen"
      } as unknown as ChatToolPart)
    ).toBeUndefined()
  })
})
