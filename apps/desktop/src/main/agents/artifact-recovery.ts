import fs from "node:fs"

import type {
  ArtifactReadErrorReason,
  ReadArtifactFileOutput
} from "@etyon/rpc"
import { and, desc, eq } from "drizzle-orm"

import { restoreSingleFileFromCheckpoints } from "@/main/agents/checkpoints"
import { ARTIFACT_MAX_BYTES } from "@/main/agents/minimal/artifact-tool"
import { invalidateWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { getChatSessionById } from "@/main/chat-sessions"
import type { AppDatabase } from "@/main/db"
import { agentArtifacts, agentRuns } from "@/main/db/schema"
import { logger } from "@/main/logger"
import type { ReadProjectFileResult } from "@/main/project-snapshot"
import { readProjectFileResult } from "@/main/project-snapshot"

/**
 * Auto-recovering read behind the artifact panel's `artifacts.read` endpoint.
 * The workspace binding is `chat_sessions.project_path`, an absolute path fixed
 * at session creation and never revalidated. This ladder makes reads resilient:
 * it recreates a deleted project directory, re-resolves stale transcript paths
 * through the durable `agent_artifacts` record, and restores lost file content
 * from the newest checkpoint (write/edit pre-image blob or bash git snapshot).
 *
 * Failures are RETURNED as a discriminated union (never thrown, except an
 * unknown session) so react-query caches the outcome instead of retry-storming
 * the whole recovery ladder on every render.
 */

const buildErrorOutput = (
  reason: ArtifactReadErrorReason,
  workspaceRecreated: boolean
): ReadArtifactFileOutput => ({
  reason,
  status: "error",
  workspaceRecreated
})

const buildOkOutput = ({
  restoredFromSnapshot,
  value,
  workspaceRecreated
}: {
  restoredFromSnapshot: boolean
  value: { content: string; language: string | null; relativePath: string }
  workspaceRecreated: boolean
}): ReadArtifactFileOutput => ({
  content: value.content,
  language: value.language,
  relativePath: value.relativePath,
  restoredFromSnapshot,
  status: "ok",
  workspaceRecreated
})

const toReadOutput = ({
  restoredFromSnapshot,
  result,
  workspaceRecreated
}: {
  restoredFromSnapshot: boolean
  result: ReadProjectFileResult
  workspaceRecreated: boolean
}): ReadArtifactFileOutput =>
  result.ok
    ? buildOkOutput({
        restoredFromSnapshot,
        value: result.value,
        workspaceRecreated
      })
    : buildErrorOutput(result.reason, workspaceRecreated)

/**
 * Newest `agent_artifacts` row for this session, preferring a tool-call match
 * then falling back to a path match. Used to re-resolve a stale transcript path
 * (the panel may reference the artifact by an old relative path).
 */
const findDurableArtifactPath = async ({
  db,
  filePath,
  sessionId,
  toolCallId
}: {
  db: AppDatabase
  filePath: string
  sessionId: string
  toolCallId?: string
}): Promise<string | null> => {
  if (toolCallId !== undefined) {
    const [byToolCall] = await db
      .select({ path: agentArtifacts.path })
      .from(agentArtifacts)
      .innerJoin(agentRuns, eq(agentArtifacts.runId, agentRuns.id))
      .where(
        and(
          eq(agentRuns.chatSessionId, sessionId),
          eq(agentArtifacts.toolCallId, toolCallId)
        )
      )
      .orderBy(desc(agentArtifacts.createdAt))
      .limit(1)

    if (byToolCall) {
      return byToolCall.path
    }
  }

  const [byPath] = await db
    .select({ path: agentArtifacts.path })
    .from(agentArtifacts)
    .innerJoin(agentRuns, eq(agentArtifacts.runId, agentRuns.id))
    .where(
      and(
        eq(agentRuns.chatSessionId, sessionId),
        eq(agentArtifacts.path, filePath)
      )
    )
    .orderBy(desc(agentArtifacts.createdAt))
    .limit(1)

  return byPath?.path ?? null
}

const recoverMissingArtifact = async ({
  db,
  filePath,
  projectPath,
  sessionId,
  toolCallId,
  workspaceRecreated
}: {
  db: AppDatabase
  filePath: string
  projectPath: string
  sessionId: string
  toolCallId?: string
  workspaceRecreated: boolean
}): Promise<ReadArtifactFileOutput> => {
  const durablePath = await findDurableArtifactPath({
    db,
    filePath,
    sessionId,
    toolCallId
  })
  let targetPath = filePath

  if (durablePath !== null && durablePath !== filePath) {
    const durableRead = readProjectFileResult({
      filePath: durablePath,
      projectPath
    })

    if (durableRead.ok) {
      return toReadOutput({
        restoredFromSnapshot: false,
        result: durableRead,
        workspaceRecreated
      })
    }

    targetPath = durablePath
  }

  const restore = await restoreSingleFileFromCheckpoints({
    maxBytes: ARTIFACT_MAX_BYTES,
    projectPath,
    relativePath: targetPath
  })

  if (restore.ok) {
    const restoredRead = readProjectFileResult({
      filePath: targetPath,
      projectPath
    })

    if (restoredRead.ok) {
      logger.info("artifact_restored_from_snapshot", {
        checkpoint_id: restore.checkpointId,
        path: targetPath,
        source: restore.source
      })
    }

    return toReadOutput({
      restoredFromSnapshot: restoredRead.ok,
      result: restoredRead,
      workspaceRecreated
    })
  }

  if (restore.reason === "file-exists") {
    return toReadOutput({
      restoredFromSnapshot: false,
      result: readProjectFileResult({ filePath: targetPath, projectPath }),
      workspaceRecreated
    })
  }

  if (restore.reason === "too-large") {
    return buildErrorOutput("too-large", workspaceRecreated)
  }

  // invalid-path | no-source: nothing recoverable — a terminal missing file.
  return buildErrorOutput("file-missing", workspaceRecreated)
}

export const readArtifactFileWithRecovery = async ({
  db,
  filePath,
  sessionId,
  toolCallId
}: {
  db: AppDatabase
  filePath: string
  sessionId: string
  toolCallId?: string
}): Promise<ReadArtifactFileOutput> => {
  const session = await getChatSessionById(db, sessionId)

  if (!session) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  const { projectPath } = session
  let workspaceRecreated = false

  try {
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true })
      invalidateWorkspaceCore(projectPath)
      workspaceRecreated = true
      logger.info("artifact_workspace_recreated", {
        project_path: projectPath,
        session_id: sessionId
      })
    }

    const initialRead = readProjectFileResult({ filePath, projectPath })

    if (initialRead.ok) {
      return buildOkOutput({
        restoredFromSnapshot: false,
        value: initialRead.value,
        workspaceRecreated
      })
    }

    if (initialRead.reason !== "file-missing") {
      return buildErrorOutput(initialRead.reason, workspaceRecreated)
    }

    return await recoverMissingArtifact({
      db,
      filePath,
      projectPath,
      sessionId,
      toolCallId,
      workspaceRecreated
    })
  } catch (error) {
    logger.error("artifact_recovery_failed", {
      error,
      file_path: filePath,
      project_path: projectPath,
      session_id: sessionId
    })

    return buildErrorOutput("io-error", workspaceRecreated)
  }
}
