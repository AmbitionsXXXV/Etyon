import { describe, expect, it } from "vite-plus/test"

import {
  CHAT_REQUEST_PHASE_DATA_TYPE,
  isChatRequestPhaseDataPart
} from "@/shared/chat/stream-data"

describe("isChatRequestPhaseDataPart", () => {
  it("matches chat request phase data parts", () => {
    expect(
      isChatRequestPhaseDataPart({
        data: {
          phase: "agent-turn"
        },
        type: CHAT_REQUEST_PHASE_DATA_TYPE
      })
    ).toBe(true)
  })

  it("rejects unrelated data parts", () => {
    expect(
      isChatRequestPhaseDataPart({
        data: {
          phase: "memory-loading"
        },
        type: "data-other"
      })
    ).toBe(false)
  })
})
