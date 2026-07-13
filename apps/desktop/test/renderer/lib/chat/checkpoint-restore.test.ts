import type { AgentCheckpoint, CheckpointFile } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  canRestoreCheckpoint,
  findRestorableCheckpoint,
  getCheckpointFileDirection,
  isPartialRestore,
  isRestoreCandidateToolName,
  planCheckpointRestore,
  restorePlanHasBlockedFiles
} from "@/renderer/lib/chat/checkpoint-restore"

const makeCheckpoint = (
  overrides: Partial<AgentCheckpoint> & Pick<AgentCheckpoint, "id">
): AgentCheckpoint => ({
  createdAt: "2026-07-13T00:00:00.000Z",
  files: [{ path: "src/index.ts", preSha: "a".repeat(64) }],
  gitSnapshotRef: null,
  origin: "write",
  parentId: null,
  projectHash: "0123456789abcdef",
  runId: "run-1",
  toolCallId: "call-1",
  ...overrides
})

describe("isRestoreCandidateToolName", () => {
  it("accepts write and edit, rejects bash and read", () => {
    expect(isRestoreCandidateToolName("write")).toBe(true)
    expect(isRestoreCandidateToolName("edit")).toBe(true)
    expect(isRestoreCandidateToolName("bash")).toBe(false)
    expect(isRestoreCandidateToolName("read")).toBe(false)
  })
})

describe("canRestoreCheckpoint", () => {
  it("is true only when the checkpoint captured files", () => {
    expect(canRestoreCheckpoint(makeCheckpoint({ id: "c1" }))).toBe(true)
    expect(
      canRestoreCheckpoint(
        makeCheckpoint({ files: [], id: "c2", origin: "bash" })
      )
    ).toBe(false)
  })
})

describe("findRestorableCheckpoint", () => {
  it("returns the oldest capture when a tool call owns several checkpoints", () => {
    // Newest-first, as listCheckpoints returns them: the restore-safety
    // checkpoint (newer) reuses the original tool call id, and the original
    // pre-tool capture (older) is what the row must reach.
    const safety = makeCheckpoint({
      createdAt: "2026-07-13T10:00:00.000Z",
      files: [{ path: "src/index.ts", preSha: "b".repeat(64) }],
      id: "safety",
      toolCallId: "call-x"
    })
    const original = makeCheckpoint({
      createdAt: "2026-07-13T09:00:00.000Z",
      files: [{ path: "src/index.ts", preSha: "a".repeat(64) }],
      id: "original",
      toolCallId: "call-x"
    })

    expect(findRestorableCheckpoint([safety, original], "call-x")?.id).toBe(
      "original"
    )
    // Order-independent: same answer regardless of input ordering.
    expect(findRestorableCheckpoint([original, safety], "call-x")?.id).toBe(
      "original"
    )
  })

  it("returns null for an unknown tool call id", () => {
    expect(
      findRestorableCheckpoint([makeCheckpoint({ id: "c1" })], "missing")
    ).toBeNull()
  })

  it("ignores checkpoints that captured no files", () => {
    const bash = makeCheckpoint({
      files: [],
      id: "bash",
      origin: "bash",
      toolCallId: "call-bash"
    })

    expect(findRestorableCheckpoint([bash], "call-bash")).toBeNull()
  })
})

describe("getCheckpointFileDirection", () => {
  const cases: { direction: string; file: CheckpointFile }[] = [
    { direction: "restore", file: { path: "a.ts", preSha: "a".repeat(64) } },
    { direction: "delete", file: { path: "b.ts", preSha: null } },
    {
      direction: "blocked",
      file: { overCap: true, path: "big.bin", preSha: "c".repeat(64) }
    }
  ]

  for (const { direction, file } of cases) {
    it(`labels ${file.path} as ${direction}`, () => {
      expect(getCheckpointFileDirection(file)).toBe(direction)
    })
  }
})

describe("planCheckpointRestore", () => {
  it("maps each file to a directioned plan entry preserving order", () => {
    const plan = planCheckpointRestore([
      { path: "a.ts", preSha: "a".repeat(64) },
      { path: "b.ts", preSha: null },
      { overCap: true, path: "big.bin", preSha: "c".repeat(64) }
    ])

    expect(plan).toEqual([
      { direction: "restore", path: "a.ts" },
      { direction: "delete", path: "b.ts" },
      { direction: "blocked", path: "big.bin" }
    ])
    expect(restorePlanHasBlockedFiles(plan)).toBe(true)
    expect(
      restorePlanHasBlockedFiles([{ direction: "restore", path: "a.ts" }])
    ).toBe(false)
  })
})

describe("isPartialRestore", () => {
  it("is false only when nothing was skipped or missing", () => {
    expect(
      isPartialRestore({ missingBlobs: [], restored: ["a.ts"], skipped: [] })
    ).toBe(false)
    expect(
      isPartialRestore({ missingBlobs: [], restored: [], skipped: ["a.ts"] })
    ).toBe(true)
    expect(
      isPartialRestore({
        missingBlobs: ["b.ts"],
        restored: ["a.ts"],
        skipped: []
      })
    ).toBe(true)
  })
})
