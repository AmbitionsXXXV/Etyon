import { describe, expect, it } from "vite-plus/test"

import {
  AgentCheckpointSchema,
  ListCheckpointsInputSchema,
  ListCheckpointsOutputSchema,
  RestoreCheckpointInputSchema,
  RestoreCheckpointOutputSchema
} from "../../src/schemas/checkpoints"

describe("checkpoint schemas", () => {
  it("parses a write checkpoint with restored, deleted, and over-cap files", () => {
    const checkpoint = AgentCheckpointSchema.parse({
      createdAt: "2026-07-13T00:00:00.000Z",
      files: [
        { mode: 420, path: "src/index.ts", preSha: "a".repeat(64) },
        { path: "src/created.ts", preSha: null },
        { overCap: true, path: "assets/big.bin", preSha: "b".repeat(64) }
      ],
      gitSnapshotRef: null,
      id: "checkpoint-1",
      origin: "write",
      parentId: null,
      projectHash: "0123456789abcdef",
      runId: "run-1",
      toolCallId: "call-1"
    })

    expect(checkpoint.files).toHaveLength(3)
    expect(checkpoint.files[1]?.preSha).toBeNull()
    expect(checkpoint.files[2]?.overCap).toBe(true)
    expect(checkpoint.origin).toBe("write")
  })

  it("accepts a bash checkpoint with a git snapshot and no files", () => {
    const checkpoint = AgentCheckpointSchema.parse({
      createdAt: "2026-07-13T00:00:00.000Z",
      files: [],
      gitSnapshotRef: "deadbeef",
      id: "checkpoint-2",
      origin: "bash",
      parentId: "checkpoint-1",
      projectHash: "0123456789abcdef",
      runId: "run-1",
      toolCallId: "call-2"
    })

    expect(checkpoint.files).toEqual([])
    expect(checkpoint.gitSnapshotRef).toBe("deadbeef")
  })

  it("rejects an unknown origin and a non-true overCap flag", () => {
    expect(() =>
      AgentCheckpointSchema.parse({
        createdAt: "2026-07-13T00:00:00.000Z",
        files: [],
        gitSnapshotRef: null,
        id: "checkpoint-3",
        origin: "delete",
        parentId: null,
        projectHash: "0123456789abcdef",
        runId: "run-1",
        toolCallId: "call-3"
      })
    ).toThrow()

    expect(() =>
      AgentCheckpointSchema.parse({
        createdAt: "2026-07-13T00:00:00.000Z",
        files: [{ overCap: false, path: "a.ts", preSha: null }],
        gitSnapshotRef: null,
        id: "checkpoint-4",
        origin: "edit",
        parentId: null,
        projectHash: "0123456789abcdef",
        runId: "run-1",
        toolCallId: "call-4"
      })
    ).toThrow()
  })

  it("requires a session id and accepts an optional limit for list input", () => {
    expect(
      ListCheckpointsInputSchema.parse({ sessionId: "session-1" })
    ).toEqual({ sessionId: "session-1" })
    expect(
      ListCheckpointsInputSchema.parse({ limit: 25, sessionId: "session-1" })
    ).toEqual({ limit: 25, sessionId: "session-1" })
    expect(() => ListCheckpointsInputSchema.parse({ sessionId: "" })).toThrow()
    expect(() =>
      ListCheckpointsInputSchema.parse({ limit: 0, sessionId: "session-1" })
    ).toThrow()
  })

  it("wraps the checkpoint list output in a checkpoints array", () => {
    expect(ListCheckpointsOutputSchema.parse({ checkpoints: [] })).toEqual({
      checkpoints: []
    })
  })

  it("validates restore input and output shapes", () => {
    expect(
      RestoreCheckpointInputSchema.parse({
        checkpointId: "checkpoint-1",
        sessionId: "session-1"
      })
    ).toEqual({ checkpointId: "checkpoint-1", sessionId: "session-1" })

    expect(
      RestoreCheckpointOutputSchema.parse({
        missingBlobs: ["assets/big.bin"],
        restored: ["src/index.ts"],
        skipped: []
      })
    ).toEqual({
      missingBlobs: ["assets/big.bin"],
      restored: ["src/index.ts"],
      skipped: []
    })
  })
})
