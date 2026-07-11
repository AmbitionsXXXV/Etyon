import { describe, expect, it } from "vite-plus/test"

import {
  CHAT_REQUEST_PHASE_DATA_TYPE,
  CHAT_SUBAGENT_CHUNK_DATA_TYPE,
  CHAT_SUBAGENT_END_DATA_TYPE,
  CHAT_SUBAGENT_START_DATA_TYPE,
  isChatRequestPhaseDataPart,
  isChatSubagentChunkDataPart,
  isChatSubagentEndDataPart,
  isChatSubagentStartDataPart
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

describe("subagent data-part guards", () => {
  it("matches start/chunk/end parts by type and child run id", () => {
    expect(
      isChatSubagentStartDataPart({
        data: { childRunId: "c1", profileId: "explore", task: "t" },
        type: CHAT_SUBAGENT_START_DATA_TYPE
      })
    ).toBe(true)
    expect(
      isChatSubagentChunkDataPart({
        data: { childRunId: "c1", chunk: { type: "text-delta" } },
        type: CHAT_SUBAGENT_CHUNK_DATA_TYPE
      })
    ).toBe(true)
    expect(
      isChatSubagentEndDataPart({
        data: { childRunId: "c1", durationMs: 5, state: "succeeded" },
        type: CHAT_SUBAGENT_END_DATA_TYPE
      })
    ).toBe(true)
  })

  it("rejects mismatched types and malformed payloads", () => {
    expect(
      isChatSubagentStartDataPart({
        data: { childRunId: "c1", profileId: "explore", task: "t" },
        type: "data-other"
      })
    ).toBe(false)
    expect(
      isChatSubagentChunkDataPart({
        data: { chunk: {} },
        type: CHAT_SUBAGENT_CHUNK_DATA_TYPE
      })
    ).toBe(false)
    expect(
      isChatSubagentEndDataPart({
        data: null,
        type: CHAT_SUBAGENT_END_DATA_TYPE
      })
    ).toBe(false)
  })
})
