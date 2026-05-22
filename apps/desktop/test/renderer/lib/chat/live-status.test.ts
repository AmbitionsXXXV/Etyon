import { describe, expect, it } from "vite-plus/test"

import { resolveAssistantLiveStatus } from "@/renderer/lib/chat/live-status"

describe("resolveAssistantLiveStatus", () => {
  it("returns waiting while the request is submitted", () => {
    expect(
      resolveAssistantLiveStatus({
        status: "submitted"
      })
    ).toBe("waiting")
  })

  it("returns memory-loading when the stream reports memory retrieval", () => {
    expect(
      resolveAssistantLiveStatus({
        requestPhase: "memory-loading",
        status: "submitted"
      })
    ).toBe("memory-loading")
  })

  it("returns model-start when the stream reports model connection", () => {
    expect(
      resolveAssistantLiveStatus({
        requestPhase: "model-start",
        status: "submitted"
      })
    ).toBe("model-start")
  })

  it("detects streaming reasoning parts as thinking", () => {
    expect(
      resolveAssistantLiveStatus({
        latestMessage: {
          parts: [
            {
              state: "streaming",
              text: "Let me inspect the repo.",
              type: "reasoning"
            }
          ],
          role: "assistant"
        },
        status: "streaming"
      })
    ).toBe("thinking")
  })

  it("detects open antThinking tags as thinking", () => {
    expect(
      resolveAssistantLiveStatus({
        latestMessage: {
          parts: [
            {
              text: "Before\n<antThinking>\nStill thinking",
              type: "text"
            }
          ],
          role: "assistant"
        },
        status: "streaming"
      })
    ).toBe("thinking")
  })

  it("detects active terminal tools as tool-running", () => {
    expect(
      resolveAssistantLiveStatus({
        latestMessage: {
          parts: [
            {
              input: {
                command: "git status"
              },
              state: "input-available",
              toolCallId: "tool-1",
              type: "tool-bash"
            }
          ],
          role: "assistant"
        },
        status: "streaming"
      })
    ).toBe("tool-running")
  })
})
