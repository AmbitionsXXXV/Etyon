import { randomUUID } from "node:crypto"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import { BestOfNReviewSchema } from "@etyon/rpc/schemas/worktrees"
import type { BestOfNRun } from "@etyon/rpc/schemas/worktrees"
import type { UIMessage, UIMessageStreamWriter } from "ai"
import { eq, sql } from "drizzle-orm"
import { app, BrowserWindow } from "electron"

import {
  recordDelegatedRunOutcome,
  startAgentRun
} from "@/main/agents/agent-event-store"
import {
  releaseChildSlot,
  runDelegatedAgent,
  tryAcquireChildSlot
} from "@/main/agents/minimal/delegation"
import {
  saveToolResult,
  TOOL_RESULT_MAX_BYTES
} from "@/main/agents/tool-result-store"
import { createBestOfNService } from "@/main/agents/worktrees/best-of-n"
import type {
  BestOfNCandidateRequest,
  BestOfNReviewerRequest,
  BestOfNService
} from "@/main/agents/worktrees/best-of-n"
import {
  buildBestOfNReviewPrompt,
  buildBestOfNTool
} from "@/main/agents/worktrees/best-of-n-tool"
import { createWorktreeManager } from "@/main/agents/worktrees/manager"
import type { WorktreeManager } from "@/main/agents/worktrees/manager"
import { releaseRun } from "@/main/agents/write-claims"
import { getAppConfigDir } from "@/main/app-paths"
import { getDb } from "@/main/db"
import { agentEvents } from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import { logger } from "@/main/logger"
import { getSettings } from "@/main/settings"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"
import { resolveProfileById } from "@/shared/agents/profiles"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

const CHILD_DEADLINE_MS = 10 * 60_000
const SLOT_POLL_MS = 50
const SHUTDOWN_GRACE_MS = 5000
const activeRuns = new Map<string, { id: string; sessionId: string }>()
const activeCalls = new Set<Promise<unknown>>()
let runtimeManager: WorktreeManager | null = null

export interface RuntimeBestOfNContext {
  modelId: string | null
  parentProfile: ResolvedAgentProfile
  parentRunId: string
  parentToolCallId?: string
  permissionMode: AgentPermissionMode
  projectPath: string
  sessionId: string
  writer: UIMessageStreamWriter<UIMessage>
}

const appendRuntimeAudit = async (
  runId: string,
  type: string,
  payload: unknown
): Promise<void> => {
  try {
    await runExclusiveDbWrite(async () => {
      const db = getDb()
      const [row] = await db
        .select({
          sequence: sql<number>`coalesce(max(${agentEvents.sequence}), -1)`
        })
        .from(agentEvents)
        .where(eq(agentEvents.runId, runId))
      await db.insert(agentEvents).values({
        createdAt: new Date().toISOString(),
        id: randomUUID(),
        payloadJson: JSON.stringify(payload),
        runId,
        sequence: (row?.sequence ?? -1) + 1,
        type
      })
    })
  } catch (error) {
    logger.error("worktree_audit_failed", { error, runId, type })
  }
}

export const getRuntimeWorktreeManager = (): WorktreeManager => {
  runtimeManager ??= createWorktreeManager({
    onAudit: async (event) => {
      await appendRuntimeAudit(event.runId, "worktree.lifecycle", event)
    },
    storageRoot: path.join(getAppConfigDir(app.getPath("home")), "worktrees")
  })
  return runtimeManager
}

const broadcastBestOfNUpdate = async (run: BestOfNRun): Promise<void> => {
  if (run.state === "running") {
    activeRuns.set(run.id, { id: run.id, sessionId: run.sessionId })
  } else {
    activeRuns.delete(run.id)
  }
  const payload = {
    candidateStates: run.candidates.map(({ id, state }) => ({ id, state })),
    id: run.id,
    selectedCandidateId: run.selectedCandidateId,
    sessionId: run.sessionId,
    state: run.state
  }
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      window.webContents.send("best-of-n:updated", payload)
    } catch (error) {
      logger.error("best_of_n_broadcast_failed", { error })
    }
  }
  await appendRuntimeAudit(run.runId, "best_of_n.updated", payload)
}

const requireRuntimeContext = (
  context?: RuntimeBestOfNContext
): RuntimeBestOfNContext => {
  if (
    !context?.writer ||
    !context.parentProfile.allowDelegation ||
    context.parentProfile.readonly
  ) {
    throw new Error(
      "Start Best-of-N from an active writable Agent conversation with delegation enabled."
    )
  }
  return context
}

const selectChildProfile = (
  context: RuntimeBestOfNContext,
  readonly: boolean,
  requestedId?: string
): ResolvedAgentProfile => {
  const settings = getSettings().agents
  const ids = requestedId
    ? [requestedId]
    : [
        readonly ? "review" : "coder",
        ...context.parentProfile.allowedDelegateProfileIds
      ]
  for (const id of ids) {
    if (!context.parentProfile.allowedDelegateProfileIds.includes(id)) {
      continue
    }
    const profile = resolveProfileById(settings, id)
    if (profile && profile.readonly === readonly) {
      return {
        ...profile,
        allowDelegation: false,
        allowedDelegateProfileIds: [],
        preferredModel: ""
      }
    }
  }
  throw new Error(
    readonly
      ? "No available read-only reviewer profile is allowed by the parent."
      : "No available writable candidate profile is allowed by the parent."
  )
}

const waitForChildSlot = async (
  parentRunId: string,
  signal: AbortSignal
): Promise<void> => {
  const limit = getSettings().agents.maxConcurrentSubagents
  while (!tryAcquireChildSlot(parentRunId, limit)) {
    signal.throwIfAborted()
    await delay(SLOT_POLL_MS, undefined, { signal })
  }
  if (signal.aborted) {
    releaseChildSlot(parentRunId)
    signal.throwIfAborted()
  }
}

const executeDurableChild = async (
  context: RuntimeBestOfNContext,
  options: {
    modelId: string | null
    profile: ResolvedAgentProfile
    schema?: unknown
    signal: AbortSignal
    task: string
    workspacePath: string
    writable: boolean
  }
) => {
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(CHILD_DEADLINE_MS)
  ])
  await waitForChildSlot(context.parentRunId, signal)
  let childRunId: string | null = null
  const db = getDb()
  try {
    childRunId = await runExclusiveDbWrite(
      async () =>
        await startAgentRun({
          chatSessionId: context.sessionId,
          db,
          modelId: options.modelId,
          parentRunId: context.parentRunId,
          parentToolCallId: context.parentToolCallId,
          profileId: options.profile.id
        })
    )
    const result = await runDelegatedAgent({
      abortSignal: signal,
      allowPrivateWorkspaceRoot: options.writable,
      chatSessionId: context.sessionId,
      childProfile: options.profile,
      childRunId,
      hooksConfigProjectPath: context.projectPath,
      maxSteps: getSettings().agents.maxSubagentSteps,
      modelId: options.modelId,
      parentRunId: context.parentRunId,
      parentToolCallId: context.parentToolCallId,
      ...(options.writable
        ? {
            permissionMode: context.permissionMode
          }
        : {}),
      projectPath: options.workspacePath,
      schema: options.schema,
      task: options.task,
      writeClaimRunId: childRunId,
      writer: context.writer
    })
    const settledRunId = childRunId
    await runExclusiveDbWrite(
      async () =>
        await recordDelegatedRunOutcome({
          db,
          runId: settledRunId,
          status: "succeeded",
          toolCalls: result.toolCalls
        })
    )
    return result
  } catch (error) {
    if (childRunId) {
      const failedRunId = childRunId
      try {
        await runExclusiveDbWrite(
          async () =>
            await recordDelegatedRunOutcome({
              db,
              errorMessage:
                error instanceof Error ? error.message : String(error),
              runId: failedRunId,
              status: "failed",
              toolCalls: []
            })
        )
      } catch (recordError) {
        logger.error("best_of_n_child_record_failed", {
          error: recordError,
          runId: failedRunId
        })
      }
    }
    throw error
  } finally {
    if (childRunId) {
      releaseRun(childRunId)
    }
    releaseChildSlot(context.parentRunId)
  }
}

const trackRuntimeCall = async <T>(action: Promise<T>): Promise<T> => {
  activeCalls.add(action)
  try {
    return await action
  } finally {
    activeCalls.delete(action)
  }
}

export const createRuntimeBestOfNService = (
  context?: RuntimeBestOfNContext
): BestOfNService => {
  const runCandidate = async (
    request: BestOfNCandidateRequest
  ): Promise<{ summary: string }> => {
    const runtime = requireRuntimeContext(context)
    const profile = selectChildProfile(runtime, false, request.profileId)
    const result = await trackRuntimeCall(
      executeDurableChild(runtime, {
        modelId: request.modelId,
        profile,
        signal: request.signal,
        task: request.prompt,
        workspacePath: request.workspacePath,
        writable: true
      })
    )
    return { summary: result.text }
  }
  const runReviewer = async (request: BestOfNReviewerRequest) => {
    const runtime = requireRuntimeContext(context)
    const profile = selectChildProfile(runtime, true)
    const candidates = []
    for (const candidate of request.candidates) {
      request.signal.throwIfAborted()
      const diff = candidate.worktreeId
        ? await getRuntimeWorktreeManager().preview(
            candidate.worktreeId,
            request.sessionId
          )
        : null
      const fullPatch = diff?.patch ?? candidate.patch
      const fullEvidence = {
        ...candidate,
        patch: fullPatch,
        truncated: diff ? false : candidate.truncated
      }
      const withinLimit =
        Buffer.byteLength(
          JSON.stringify({ type: "json", value: fullEvidence })
        ) <= TOOL_RESULT_MAX_BYTES
      const evidence = withinLimit
        ? fullEvidence
        : {
            ...candidate,
            fullPatchByteLength: Buffer.byteLength(fullPatch),
            includedPatchByteLength: Buffer.byteLength(candidate.patch),
            truncated: true
          }
      const stored = await saveToolResult({
        output: { type: "json", value: evidence },
        sessionId: runtime.sessionId,
        storageRoot: path.join(
          getAppConfigDir(app.getPath("home")),
          "tool-results"
        )
      })
      candidates.push({
        id: candidate.id,
        modelId: candidate.modelId,
        patch: `[Stored review evidence: ${stored.ref}] Read with read_tool_result before recommending. ${evidence.truncated ? "Evidence is truncated; unreviewed changes require human inspection." : "Stored evidence includes the complete diff."}`,
        summary: candidate.summary.slice(0, 1200),
        truncated: evidence.truncated
      })
    }
    const result = await trackRuntimeCall(
      executeDurableChild(runtime, {
        modelId: runtime.modelId,
        profile,
        schema: {
          additionalProperties: false,
          properties: {
            recommendation: { type: "string" },
            recommendedCandidateId: {
              enum: [...request.candidates.map(({ id }) => id), null],
              type: ["string", "null"]
            }
          },
          required: ["recommendation", "recommendedCandidateId"],
          type: "object"
        },
        signal: request.signal,
        task: `${buildBestOfNReviewPrompt({ candidates, prompt: request.prompt })}\nRead the evidence references with read_tool_result; follow nextOffset for relevant pages. If any evidence is truncated, clearly state what was not reviewed and do not claim complete verification. Use submit_findings to submit the structured review.`,
        workspacePath: runtime.projectPath,
        writable: false
      })
    )
    return BestOfNReviewSchema.parse(result.structured)
  }
  const service = createBestOfNService({
    manager: getRuntimeWorktreeManager(),
    onUpdate: broadcastBestOfNUpdate,
    runCandidate,
    runReviewer
  })
  if (context) {
    return {
      ...service,
      start: async (request) => {
        const runtime = requireRuntimeContext(context)
        if (
          request.sessionId !== runtime.sessionId ||
          request.runId !== runtime.parentRunId ||
          path.resolve(request.projectPath) !==
            path.resolve(runtime.projectPath)
        ) {
          throw new Error(
            "Best-of-N execution context does not match the active session and project."
          )
        }
        return await service.start(request)
      }
    }
  }
  return {
    ...service,
    start: () =>
      Promise.reject(
        new Error("Start Best-of-N from an active Agent conversation.")
      )
  }
}

export const buildRuntimeBestOfNTool = (context: RuntimeBestOfNContext) =>
  buildBestOfNTool(
    (toolCallId) =>
      createRuntimeBestOfNService({ ...context, parentToolCallId: toolCallId }),
    {
      projectPath: context.projectPath,
      runId: context.parentRunId,
      sessionId: context.sessionId
    }
  )

export const recoverRuntimeWorktrees = async (): Promise<void> => {
  await getRuntimeWorktreeManager().recover()
  await createRuntimeBestOfNService().recover()
}

export const cancelRuntimeWorktrees = async (): Promise<void> => {
  const service = createRuntimeBestOfNService()
  await Promise.allSettled(
    [...activeRuns.values()].map(({ id, sessionId }) =>
      service.cancel(id, sessionId)
    )
  )
  const timeout = Promise.withResolvers<boolean>()
  const timer = setTimeout(() => {
    timeout.resolve(false)
  }, SHUTDOWN_GRACE_MS)
  try {
    await Promise.race([Promise.allSettled(activeCalls), timeout.promise])
  } finally {
    clearTimeout(timer)
  }
}
