import { eq } from "drizzle-orm"

import {
  parseChildApprovalId,
  recordChildApprovalResponse
} from "@/main/agents/agent-event-store"
import {
  hasPendingApproval,
  resolveApproval
} from "@/main/agents/approval-broker"
import type { AppDatabase } from "@/main/db"
import { agentRuns, agentToolCalls, chatSessions } from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import { isRecord } from "@/renderer/lib/utils"
import { isDangerousShellCommand } from "@/shared/agents/permission-mode"

/**
 * Server side of a delegated child's approval prompt: unblocks the child waiting
 * in the broker and persists the durable decision. The oRPC handler owns the
 * (optional) command-remember settings write via `rememberableCommand`, keeping
 * this module free of the settings-broadcast machinery.
 */

export interface RememberableChildCommand {
  command: string
  projectPath: string
}

export interface RespondToChildApprovalResult {
  ok: boolean
  rememberableCommand?: RememberableChildCommand
}

const safeParse = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Resolves the exact bash command to remember for this approval — but only when
 * the gated call was `bash` and the command is NOT destructive. This is the
 * authoritative dangerous-command guard: the renderer hides "approve and
 * remember" for destructive commands, and this refuses it server-side even if a
 * client sends it anyway, so the allowlist can never learn a wipe.
 */
const resolveRememberableCommand = async ({
  db,
  runId,
  toolCallId
}: {
  db: AppDatabase
  runId: string
  toolCallId: string
}): Promise<RememberableChildCommand | null> => {
  const [toolCall] = await db
    .select()
    .from(agentToolCalls)
    .where(eq(agentToolCalls.id, `${runId}:${toolCallId}`))
    .limit(1)

  if (!toolCall || toolCall.toolName !== "bash") {
    return null
  }

  const input = safeParse(toolCall.inputJson)
  const command =
    isRecord(input) && typeof input.command === "string"
      ? input.command.trim()
      : ""

  if (command.length === 0 || isDangerousShellCommand(command)) {
    return null
  }

  const [run] = await db
    .select({ chatSessionId: agentRuns.chatSessionId })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1)

  if (!run) {
    return null
  }

  const [session] = await db
    .select({ projectPath: chatSessions.projectPath })
    .from(chatSessions)
    .where(eq(chatSessions.id, run.chatSessionId))
    .limit(1)

  return session ? { command, projectPath: session.projectPath } : null
}

/**
 * Applies a user's decision to a pending child approval. Resolves the in-memory
 * broker first (unblocking the child immediately and closing the abort/timeout
 * race), then persists the durable response. `ok: false` means the approval was
 * no longer pending (already answered, aborted, or expired) — the caller should
 * surface that rather than treat it as applied.
 */
export const respondToChildApproval = async ({
  approved,
  approvalId,
  db,
  rememberCommand
}: {
  approved: boolean
  approvalId: string
  db: AppDatabase
  rememberCommand: boolean
}): Promise<RespondToChildApprovalResult> => {
  const parsed = parseChildApprovalId(approvalId)

  if (!(parsed && hasPendingApproval(approvalId))) {
    return { ok: false }
  }

  // Synchronous resolve right after the pending check closes the window where an
  // abort/timeout could settle the broker between check and resolve.
  if (!resolveApproval(approvalId, approved)) {
    return { ok: false }
  }

  const { runId, toolCallId } = parsed

  await runExclusiveDbWrite(() =>
    recordChildApprovalResponse({
      approved,
      db,
      reason: "responded",
      runId,
      toolCallId
    })
  )

  if (!(approved && rememberCommand)) {
    return { ok: true }
  }

  const rememberableCommand = await resolveRememberableCommand({
    db,
    runId,
    toolCallId
  })

  return rememberableCommand ? { ok: true, rememberableCommand } : { ok: true }
}
