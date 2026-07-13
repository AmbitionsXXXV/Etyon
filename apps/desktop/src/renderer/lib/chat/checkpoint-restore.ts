import type {
  AgentCheckpoint,
  CheckpointFile,
  RestoreCheckpointOutput
} from "@etyon/rpc"

export type CheckpointFileDirection = "blocked" | "delete" | "restore"

export interface CheckpointRestorePlanEntry {
  direction: CheckpointFileDirection
  path: string
}

const RESTORE_CANDIDATE_TOOL_NAMES = new Set(["edit", "write"])

/**
 * Whether a tool row should be probed for a restorable checkpoint. Only the
 * file-mutating tools (`write`/`edit`) capture a file-level pre-image; `bash`
 * captures a git snapshot with no `files`, so it stays out of the file-restore
 * affordance.
 */
export const isRestoreCandidateToolName = (toolName: string): boolean =>
  RESTORE_CANDIDATE_TOOL_NAMES.has(toolName)

/**
 * A checkpoint only offers a file-level restore when it captured at least one
 * file. `origin: "bash"` checkpoints carry just a git snapshot (empty `files`).
 */
export const canRestoreCheckpoint = (checkpoint: AgentCheckpoint): boolean =>
  checkpoint.files.length > 0

/**
 * Resolves the checkpoint a "restore to before this" row targets: the OLDEST
 * restorable capture for the tool call. A restore reuses the original
 * checkpoint's `toolCallId` for its pre-restore safety checkpoint (see
 * `restoreFileCheckpoint` in the main process), so one tool call can own several
 * checkpoints. The oldest is the pre-tool image the row means to reach; the
 * newer ones are restore artifacts. `createdAt` is an ISO-8601 timestamp, so it
 * compares chronologically as a plain string. Returns `null` when the row has no
 * capture (reads, best-effort misses) or nothing to restore.
 */
export const findRestorableCheckpoint = (
  checkpoints: readonly AgentCheckpoint[],
  toolCallId: string
): AgentCheckpoint | null => {
  let match: AgentCheckpoint | null = null

  for (const checkpoint of checkpoints) {
    if (
      checkpoint.toolCallId !== toolCallId ||
      !canRestoreCheckpoint(checkpoint)
    ) {
      continue
    }

    if (!match || checkpoint.createdAt < match.createdAt) {
      match = checkpoint
    }
  }

  return match
}

/**
 * Classifies how restoring a captured file changes the workspace: `delete` for
 * files that did not exist before the tool ran (`preSha: null`), `blocked` for
 * over-cap files whose contents were never stored, and `restore` for files whose
 * pre-image blob can be written back.
 */
export const getCheckpointFileDirection = (
  file: CheckpointFile
): CheckpointFileDirection => {
  if (file.overCap) {
    return "blocked"
  }

  if (file.preSha === null) {
    return "delete"
  }

  return "restore"
}

export const planCheckpointRestore = (
  files: readonly CheckpointFile[]
): CheckpointRestorePlanEntry[] =>
  files.map((file) => ({
    direction: getCheckpointFileDirection(file),
    path: file.path
  }))

export const restorePlanHasBlockedFiles = (
  plan: readonly CheckpointRestorePlanEntry[]
): boolean => plan.some((entry) => entry.direction === "blocked")

/**
 * A restore is partial (and must not read as a silent success) when the backend
 * skipped files or could not find a stored pre-image blob for some of them.
 */
export const isPartialRestore = (result: RestoreCheckpointOutput): boolean =>
  result.skipped.length > 0 || result.missingBlobs.length > 0
