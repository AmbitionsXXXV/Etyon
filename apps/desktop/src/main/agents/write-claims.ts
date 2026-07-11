import path from "node:path"

/**
 * File-write ownership claims, scoped to a top-level agent run.
 *
 * When a writable parent fans work out to several writable children in parallel,
 * two children (or a child and the parent) editing the same file would clobber
 * each other. This registers, per top-level run, which holder owns each path so a
 * second holder's write is rejected with a structured, model-recoverable error
 * instead of silently overwriting.
 *
 * This is ownership coordination, NOT a serialization lock. `withWorkspaceWriteLock`
 * (workspace-core) still serializes concurrent writes to one path so a file is
 * never physically corrupted mid-write; claims sit above that and stop two agents
 * from *logically* overwriting each other's intended changes. The two layers
 * stack and neither replaces the other.
 *
 * DB-free and process-local (a run's writers all live in one main process), so it
 * is unit testable in node.
 */

// topRunId -> (normalized project-relative path -> holder label)
const claimsByRun = new Map<string, Map<string, string>>()

/** Holder label the top-level (parent) agent claims writes under. */
export const PARENT_WRITE_HOLDER = "parent"

export type WriteClaimResult = { holder: string; ok: false } | { ok: true }

/** Normalizes a project-relative path so `./a/b`, `a/b`, and `a\\b` coincide. */
const normalizeClaimPath = (requestedPath: string): string => {
  const normalized = path.posix.normalize(
    requestedPath.replaceAll("\\", "/").replace(/^\.\//u, "")
  )

  return normalized.replace(/\/+$/u, "") || "."
}

/** Stable holder label for a delegated child: short run id + profile. */
export const childWriteHolder = (
  childRunId: string,
  profileId: string
): string => `${childRunId.slice(0, 8)}:${profileId}`

/**
 * Claims a path for a holder within a top-level run. Idempotent for the same
 * holder (re-claiming a path it already owns is `ok`); a different holder gets a
 * `conflict` carrying the current owner so the tool can report it.
 */
export const claimWrite = ({
  holder,
  path: requestedPath,
  topRunId
}: {
  holder: string
  path: string
  topRunId: string
}): WriteClaimResult => {
  const normalizedPath = normalizeClaimPath(requestedPath)
  let runClaims = claimsByRun.get(topRunId)

  if (!runClaims) {
    runClaims = new Map<string, string>()
    claimsByRun.set(topRunId, runClaims)
  }

  const existingHolder = runClaims.get(normalizedPath)

  if (existingHolder !== undefined && existingHolder !== holder) {
    return { holder: existingHolder, ok: false }
  }

  runClaims.set(normalizedPath, holder)

  return { ok: true }
}

/** Drops every claim for a finished top-level run. */
export const releaseRun = (topRunId: string): void => {
  claimsByRun.delete(topRunId)
}

/**
 * Model-facing structured-error message for a rejected claim. Not user chat copy
 * (it is tool output the sub-agent reads and recovers from), so it stays plain
 * English like the workspace tool errors.
 */
export const writeClaimConflictMessage = (
  requestedPath: string,
  holder: string
): string =>
  `Write to ${requestedPath} was skipped: another sub-task (${holder}) is already modifying it. Coordinate the division of files with the other sub-agents, or leave this file for the parent agent to consolidate.`
