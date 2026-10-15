import { describe, expect, it } from "vite-plus/test"

import {
  requestVideoEdit,
  takeVideoEditRequest
} from "@/renderer/lib/chat/video-edit-request"

const request = {
  edit: {
    mode: "edit" as const,
    sourceTitle: "Boat",
    sourceToolCallId: "videogen-1"
  },
  prompt: "Make it night",
  sessionId: "session-1"
}

describe("video edit request", () => {
  it("hands the request only to its own session, once", () => {
    requestVideoEdit(request)

    expect(takeVideoEditRequest("session-2")).toBeNull()
    expect(takeVideoEditRequest("session-1")).toEqual(request)
    expect(takeVideoEditRequest("session-1")).toBeNull()
  })
})
