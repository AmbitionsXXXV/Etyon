import { exploreProfile } from "./built-in/explore"

/**
 * Cross-process contract for the `delegate` / `workflow` sub-agent tools: the
 * child profile id workflows fan out as, the delegate tool's output shape, and
 * tolerant readers the renderer uses to pull fields out of persisted (possibly
 * partial or legacy) tool parts. Guards are hand-rolled in the style of
 * `shared/chat/stream-data.ts` so the shared layer never depends on zod.
 */

/**
 * The profile id every workflow investigator runs as. Imported from the explore
 * built-in so the constant can never drift from the profile it names; used as a
 * legacy fallback when matching a workflow call's child runs recorded before
 * `agent_runs.parentToolCallId` existed.
 */
export const WORKFLOW_CHILD_PROFILE_ID = exploreProfile.id

/** The exact object the delegate tool's `execute` returns to the model. */
export interface DelegateToolOutput {
  childRunId: string
  filesRead: string[]
  summary: string
}

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/**
 * Reads a persisted delegate tool output part, tolerating partial or legacy
 * shapes: only the fields the renderer needs are pulled out, and anything
 * missing or mistyped is simply omitted.
 */
export const parseDelegateToolOutput = (
  value: unknown
): { childRunId?: string; summary?: string } => {
  if (!isRecordValue(value)) {
    return {}
  }

  return {
    ...(typeof value.childRunId === "string"
      ? { childRunId: value.childRunId }
      : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {})
  }
}

/**
 * Reads a delegate tool input part, tolerating the partial shape a still-
 * streaming call carries before its arguments finish arriving.
 */
export const parseDelegateToolInput = (
  value: unknown
): { profileId?: string; task?: string } => {
  if (!isRecordValue(value)) {
    return {}
  }

  return {
    ...(typeof value.profileId === "string"
      ? { profileId: value.profileId }
      : {}),
    ...(typeof value.task === "string" ? { task: value.task } : {})
  }
}
