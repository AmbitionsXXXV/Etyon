import { describe, expect, it } from "vite-plus/test"

import {
  CHAT_REQUEST_PHASE_DATA_TYPE,
  CHAT_SUBAGENT_CHUNK_DATA_TYPE,
  CHAT_SUBAGENT_END_DATA_TYPE,
  CHAT_SUBAGENT_START_DATA_TYPE,
  CHAT_TODO_DATA_TYPE,
  countTodosByStatus,
  isChatRequestPhaseDataPart,
  isChatSubagentChunkDataPart,
  isChatSubagentEndDataPart,
  isChatSubagentStartDataPart,
  isChatTodoDataPart
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

describe("todo data-part guard and counts", () => {
  it("matches a todo part by type, run id, and a todos array", () => {
    expect(
      isChatTodoDataPart({
        data: { runId: "run-1", todos: [] },
        type: CHAT_TODO_DATA_TYPE
      })
    ).toBe(true)
  })

  it("rejects a mismatched type or a missing todos array", () => {
    expect(
      isChatTodoDataPart({
        data: { runId: "run-1", todos: [] },
        type: "data-other"
      })
    ).toBe(false)
    expect(
      isChatTodoDataPart({
        data: { runId: "run-1" },
        type: CHAT_TODO_DATA_TYPE
      })
    ).toBe(false)
  })

  it("tallies todos by status", () => {
    expect(
      countTodosByStatus([
        { content: "a", status: "completed" },
        { content: "b", status: "in_progress" },
        { content: "c", status: "pending" },
        { content: "d", status: "completed" }
      ])
    ).toEqual({ completed: 2, inProgress: 1, pending: 1 })
  })
})
