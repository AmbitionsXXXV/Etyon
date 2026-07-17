import type { ToolApprovalStatus } from "ai"
import { tool } from "ai"
import { z } from "zod"

import {
  recordDelegatedRunOutcome,
  startAgentRun
} from "@/main/agents/agent-event-store"
import { runDelegatedAgent } from "@/main/agents/minimal/delegation"
import type { DelegateToolContext } from "@/main/agents/minimal/delegation"
import { clampText } from "@/main/agents/minimal/text-clamp"
import { runWorkflow } from "@/main/agents/minimal/workflow/engine"
import type {
  WorkflowRunAgent,
  WorkflowRunResult
} from "@/main/agents/minimal/workflow/engine"
import { getDb } from "@/main/db"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import { logger } from "@/main/logger"
import { getSettings } from "@/main/settings"
import { needsWorkflowApproval } from "@/shared/agents/permission-mode"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"
import { resolveProfileById } from "@/shared/agents/profiles"
import { WORKFLOW_CHILD_PROFILE_ID } from "@/shared/agents/subagent-tools"

/**
 * `workflow` tool: deterministic multi-agent orchestration over READ-ONLY
 * investigator sub-agents. The model authors a small JS script; each `agent()`
 * call spawns an event-sourced read-only child run under the parent (reusing the
 * delegation machinery), so the run inspector renders the whole tree — that is
 * the v1 progress surface. v1 agents cannot modify files: writes stay with the
 * parent's own edit/write tools.
 */

// The read-only built-in every workflow agent runs as (WORKFLOW_CHILD_PROFILE_ID
// is the shared `explore` id). Read-only is guaranteed structurally by
// runDelegatedAgent's read/ls/grep-only tool set regardless of this profile's
// flag, so it only sets the child's identity and instructions.
const WORKFLOW_LOG_LIMIT = 30
const RESULT_MAX_CHARS = 8000
const SUMMARY_MAX_CHARS = 8000

const WORKFLOW_TOOL_DESCRIPTION = `Run a deterministic multi-agent workflow: a small JavaScript script that fans many READ-ONLY investigator sub-agents out across the project for broad research, review, or understanding, then synthesizes their findings. Use it only when a task genuinely spans many files or areas; for a single investigation use delegate, and to change files use edit/write directly — workflow agents CANNOT modify anything.

The script must open with a literal meta export, then orchestrate agents:
- export const meta = { name, description, phases?: [{ title }] } — the first statement, plain literals only (no calls, spreads, or template interpolation).
- agent(prompt, { label?, phase?, schema?, model? }) -> Promise<string|object>: schema is a JSON Schema object and makes the child return a validated object; model is an optional model id override for that agent.
- parallel([() => agent(a), () => agent(b)]) -> runs the thunks concurrently, preserving order.
- pipeline(items, stage1, stage2, ...) -> threads each item through the stages.
- phase(title), log(message), args (your input args), budget — progress and inputs.
- return the synthesized result (any JSON-serializable value).

Rules: the script must be deterministic — Date.now(), Math.random(), and new Date() are unavailable. A failed sub-agent resolves to null, so null-check results before synthesizing. Concurrency is bounded automatically; require/fs/network/process are not exposed. The script requires user approval before it runs (except in bypass permission mode), like bash.`

const clampJson = (value: unknown): string => {
  try {
    return clampText(JSON.stringify(value ?? null), RESULT_MAX_CHARS)
  } catch {
    return clampText(String(value), RESULT_MAX_CHARS)
  }
}

const buildWorkflowSummary = (result: WorkflowRunResult): string => {
  const phasePart =
    result.phases.length > 0 ? `; phases: ${result.phases.join(", ")}` : ""

  return clampText(
    `${result.meta.description} (${result.agentCount} read-only agents${phasePart})`,
    SUMMARY_MAX_CHARS
  )
}

export const buildWorkflowTool = ({
  chatSessionId,
  parentModelId,
  parentRunId,
  projectPath,
  writer
}: DelegateToolContext) =>
  tool({
    description: WORKFLOW_TOOL_DESCRIPTION,
    execute: async (inputData, context) => {
      const settings = getSettings().agents
      const childProfile = resolveProfileById(
        settings,
        WORKFLOW_CHILD_PROFILE_ID
      )
      // Intentional divergence: workflow does not consult
      // parentProfile.allowedDelegateProfileIds. Its safety boundary is the
      // structural read-only tool set in runDelegatedAgent; the allow-list is
      // for writable specialists exposed through delegate.

      if (!childProfile) {
        // Workflow errors stay model-recoverable tool output by design.
        return {
          error: `Workflow unavailable: the '${WORKFLOW_CHILD_PROFILE_ID}' read-only profile is not enabled.`
        }
      }

      const childModelId = childProfile.preferredModel || parentModelId
      const db = getDb()

      let agentsStarted = 0
      let agentsDone = 0
      const emitProgress = (phase: string | undefined): void => {
        writer?.write({
          type: "data-workflow-progress",
          id: context?.toolCallId ?? "workflow",
          data: {
            agentCount: agentsStarted,
            agentsDone,
            agentsStarted,
            phase
          },
          transient: true
        })
      }
      const runAgent: WorkflowRunAgent = async ({
        model,
        prompt,
        schema,
        signal
      }) => {
        const effectiveModelId = model || childModelId
        // Serialize child run-lifecycle writes: with a high workflow concurrency
        // many children settle at once on the single libsql connection, and
        // unsynchronized transactions race to SQLITE_BUSY and orphan a child at
        // "running". The parent turn does not write while this tool is blocked
        // running the workflow, so serializing the children alone is sufficient.
        const childRunId = await runExclusiveDbWrite(() =>
          startAgentRun({
            chatSessionId,
            db,
            modelId: effectiveModelId,
            parentRunId,
            profileId: childProfile.id,
            ...(context?.toolCallId
              ? { parentToolCallId: context.toolCallId }
              : {})
          })
        )

        try {
          // Read-only by construction: workflow deliberately does NOT forward
          // `permissionMode` or `parentRunId` to runDelegatedAgent, so no write
          // tools are ever built for a workflow investigator regardless of the
          // child profile's flag. `maxSubagentSteps` (a safety cap) applies to
          // read-only children too — widening it is harmless. Do not add write
          // context here; F2 keeps the workflow engine structurally read-only.
          const run = await runDelegatedAgent({
            childProfile,
            childRunId,
            maxSteps: settings.maxSubagentSteps,
            modelId: effectiveModelId,
            projectPath,
            ...(context?.toolCallId
              ? { parentToolCallId: context.toolCallId }
              : {}),
            ...(writer ? { writer } : {}),
            ...(schema === undefined ? {} : { schema }),
            task: prompt,
            ...(signal ? { abortSignal: signal } : {})
          })

          await runExclusiveDbWrite(() =>
            recordDelegatedRunOutcome({
              db,
              runId: childRunId,
              status: "succeeded",
              toolCalls: run.toolCalls
            })
          )

          return run.structured ?? run.text
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)

          await runExclusiveDbWrite(() =>
            recordDelegatedRunOutcome({
              db,
              errorMessage: message,
              runId: childRunId,
              status: "failed",
              toolCalls: []
            })
          ).catch((recordError) => {
            logger.error("workflow_child_run_record_failed", {
              error: recordError
            })
          })

          throw error
        }
      }

      try {
        const result = await runWorkflow(inputData.script, {
          args: inputData.args,
          concurrency: settings.maxWorkflowConcurrency,
          onAgentEnd: ({ phase }) => {
            agentsDone += 1
            emitProgress(phase)
          },
          onAgentStart: ({ phase }) => {
            agentsStarted += 1
            emitProgress(phase)
          },
          onPhase: emitProgress,
          runAgent,
          startedAtMs: Date.now(),
          ...(context?.abortSignal ? { signal: context.abortSignal } : {})
        })

        if (result.agentCount === 0) {
          // Workflow errors are model-recoverable tool output by design.
          return {
            error:
              "Workflow ran no agents. A workflow must call agent() at least once — for a single investigation use delegate, and to change files use edit/write."
          }
        }

        return {
          agentCount: result.agentCount,
          durationMs: result.durationMs,
          logs: result.logs.slice(-WORKFLOW_LOG_LIMIT),
          phases: result.phases,
          result: clampJson(result.result),
          summary: buildWorkflowSummary(result)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        return { error: `Workflow failed: ${message}` }
      }
    },
    inputSchema: z
      .object({
        args: z.unknown().optional(),
        script: z.string().min(1)
      })
      .strict()
  })

/**
 * Call-site approval policy for the workflow tool (v7 `toolApproval`),
 * replacing the deprecated tool-level `needsApproval` with identical semantics.
 */
export const buildWorkflowToolApproval =
  (permissionMode: AgentPermissionMode) => (): ToolApprovalStatus =>
    needsWorkflowApproval(permissionMode) ? "user-approval" : undefined
