import type { AgentCheckpoint } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  clearCheckpointRestore,
  clearSessionCheckpoints,
  getCheckpointIndexSnapshot,
  getPendingCheckpointRestoreSnapshot,
  requestCheckpointRestore,
  setSessionCheckpoints
} from "@/renderer/lib/chat/checkpoint-restore-store"

const checkpoint: AgentCheckpoint = {
  createdAt: "2026-07-13T00:00:00.000Z",
  files: [{ path: "src/index.ts", preSha: "a".repeat(64) }],
  gitSnapshotRef: null,
  id: "checkpoint-1",
  origin: "write",
  parentId: null,
  projectHash: "0123456789abcdef",
  runId: "run-1",
  toolCallId: "call-1"
}

describe("checkpoint restore store", () => {
  it("publishes and clears the session checkpoint index", () => {
    setSessionCheckpoints("session-1", [checkpoint])
    expect(getCheckpointIndexSnapshot()).toEqual({
      checkpoints: [checkpoint],
      sessionId: "session-1"
    })

    // A clear for a different session is ignored.
    clearSessionCheckpoints("other-session")
    expect(getCheckpointIndexSnapshot().sessionId).toBe("session-1")

    clearSessionCheckpoints("session-1")
    expect(getCheckpointIndexSnapshot()).toEqual({
      checkpoints: [],
      sessionId: null
    })
  })

  it("tracks a pending restore request until it is cleared", () => {
    expect(getPendingCheckpointRestoreSnapshot()).toBeNull()

    requestCheckpointRestore(checkpoint)
    expect(getPendingCheckpointRestoreSnapshot()).toBe(checkpoint)

    clearCheckpointRestore()
    expect(getPendingCheckpointRestoreSnapshot()).toBeNull()
  })
})
