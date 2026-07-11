import type { AgentSettings } from "@etyon/rpc"
import type {
  ToolSet,
  UIMessage,
  UIMessageChunk,
  UIMessageStreamWriter
} from "ai"
import { jsonSchema, stepCountIs, streamText, tool } from "ai"
import { z } from "zod"

import {
  recordChildApprovalRequest,
  recordChildApprovalResponse,
  recordDelegatedRunOutcome,
  startAgentRun
} from "@/main/agents/agent-event-store"
import type { DelegatedToolCallRecord } from "@/main/agents/agent-event-store"
import { registerApproval } from "@/main/agents/approval-broker"
import {
  BASH_TOOL_NAME,
  BashInputSchema,
  DEFAULT_TIMEOUT_SECONDS,
  matchesCommandAllowlist,
  runShellCommand
} from "@/main/agents/minimal/bash-tool"
import {
  EditInputSchema,
  runWorkspaceEdit,
  runWorkspaceWrite,
  WriteInputSchema
} from "@/main/agents/minimal/file-tools"
import { clampText } from "@/main/agents/minimal/text-clamp"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import type { WorkspaceCore } from "@/main/agents/minimal/workspace-core"
import {
  childWriteHolder,
  claimWrite,
  writeClaimConflictMessage
} from "@/main/agents/write-claims"
import { getDb } from "@/main/db"
import type { AppDatabase } from "@/main/db"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import { logger } from "@/main/logger"
import { resolveModel } from "@/main/server/lib/providers"
import { getSettings } from "@/main/settings"
import {
  isDangerousShellCommand,
  needsFileEditApproval,
  needsShellApproval
} from "@/shared/agents/permission-mode"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"
import { resolveProfileById } from "@/shared/agents/profiles"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"
import type { ChatSubagentEndState } from "@/shared/chat/stream-data"

/**
 * Multi-agent delegation as an agent-as-tool. A write-capable parent profile
 * can hand a bounded, self-contained task to a read-only specialist child. The
 * child runs a headless AI SDK loop with read-only tools only — it cannot
 * write, cannot delegate further (nesting depth is capped at 1 by construction),
 * and never sees the parent transcript. The parent gets back a summary, the
 * files the child read, and the child run id; the full child trace lives in the
 * event store under its `parentRunId`.
 */

// Fallback step cap when a caller does not pass `settings.maxSubagentSteps`.
const CHILD_MAX_STEPS = 24
const CHILD_GREP_LIMIT = 100
const TOOL_OUTPUT_MAX_CHARS = 12_000
const SUMMARY_MAX_CHARS = 8000
const SUBAGENT_TASK_MAX_CHARS = 200
const CHILD_APPROVAL_PREVIEW_MAX_CHARS = 200
// Coalesce consecutive same-id text/reasoning deltas before forwarding them so a
// chatty child never floods the parent stream: flush at ~200 chars or ~80ms.
const SUBAGENT_DELTA_FLUSH_CHARS = 200
const SUBAGENT_DELTA_FLUSH_MS = 80

interface SubagentDeltaBuffer {
  delta: string
  id: unknown
  startedAtMs: number
  type: string
}

/**
 * Forwards a child's `toUIMessageStream()` chunks to the parent stream as
 * transient `data-subagent-chunk` parts (no `id`, so the SDK never reconciles
 * successive chunks into one). Text/reasoning deltas are merged in place to keep
 * the part volume bounded; every other chunk passes through untouched.
 */
const forwardSubagentStream = async ({
  childRunId,
  stream,
  writer
}: {
  childRunId: string
  stream: ReadableStream<UIMessageChunk>
  writer: UIMessageStreamWriter<UIMessage>
}): Promise<void> => {
  const reader = stream.getReader()
  let buffer: SubagentDeltaBuffer | null = null

  const emit = (chunk: unknown): void => {
    writer.write({
      data: { childRunId, chunk },
      transient: true,
      type: "data-subagent-chunk"
    })
  }

  const flush = (): void => {
    if (buffer) {
      emit({ delta: buffer.delta, id: buffer.id, type: buffer.type })
      buffer = null
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      const chunk = value as { delta?: unknown; id?: unknown; type?: unknown }
      const isDelta =
        (chunk.type === "text-delta" || chunk.type === "reasoning-delta") &&
        typeof chunk.delta === "string"

      if (isDelta) {
        if (buffer && (buffer.type !== chunk.type || buffer.id !== chunk.id)) {
          flush()
        }

        buffer ??= {
          delta: "",
          id: chunk.id,
          startedAtMs: Date.now(),
          type: chunk.type as string
        }
        buffer.delta += chunk.delta as string

        if (
          buffer.delta.length >= SUBAGENT_DELTA_FLUSH_CHARS ||
          Date.now() - buffer.startedAtMs >= SUBAGENT_DELTA_FLUSH_MS
        ) {
          flush()
        }

        continue
      }

      flush()
      emit(value)
    }
  } finally {
    flush()
    reader.releaseLock()
  }
}

// Per-parent counting semaphore so a parent never exceeds its configured
// concurrent-subagent budget even when the model fires delegate calls in
// parallel within one step.
const activeChildCounts = new Map<string, number>()

const tryAcquireChildSlot = (parentRunId: string, limit: number): boolean => {
  const active = activeChildCounts.get(parentRunId) ?? 0

  if (active >= limit) {
    return false
  }

  activeChildCounts.set(parentRunId, active + 1)

  return true
}

const releaseChildSlot = (parentRunId: string): void => {
  activeChildCounts.set(
    parentRunId,
    Math.max(0, (activeChildCounts.get(parentRunId) ?? 1) - 1)
  )
}

const childSystemPrompt = (
  profile: ResolvedAgentProfile,
  canWrite: boolean
): string => {
  if (!canWrite) {
    return `You are a read-only delegated sub-agent (profile: ${profile.name}). ${profile.instructions}

You can only read, list, and search files. You cannot modify anything. Investigate the task, then reply with a concise summary: what you found (with file:line references) and, if changes are needed, the exact edits you recommend so the parent agent can apply them under approval.`
  }

  return `You are a delegated sub-agent (profile: ${profile.name}). ${profile.instructions}

You can read, list, and search files, and — within the bounds of your assigned task — modify files with edit/write and run shell commands with bash. Each edit, write, and shell command is approved by the user one at a time: the call blocks until they approve or deny, so continue working after an approval, and if a call is denied, adapt your plan or hand that change back to the parent instead of retrying it. Only touch files your task covers; if a write is rejected because another sub-task already owns that file, stop and report it rather than forcing it. When you finish, reply with a concise summary of what you changed (with file:line references) and anything you could not complete.`
}

/**
 * Validates a delegation target: the parent profile must list it, and it must
 * resolve to an available profile. Pure so the policy is unit-testable.
 */
export const resolveDelegateTarget = (
  settings: AgentSettings,
  parentProfile: ResolvedAgentProfile,
  profileId: string
): ResolvedAgentProfile => {
  if (!parentProfile.allowedDelegateProfileIds.includes(profileId)) {
    throw new Error(
      `Delegation to '${profileId}' is not allowed for this profile.`
    )
  }

  const childProfile = resolveProfileById(settings, profileId)

  if (!childProfile) {
    throw new Error(`Unknown or unavailable delegate profile: ${profileId}`)
  }

  return childProfile
}

/** Read-only tool set the child runs with — never write/edit, so a child can
 * never execute an approval-gated action directly. */
export const buildChildTools = (
  workspace: WorkspaceCore,
  filesRead: Set<string>,
  toolCalls: DelegatedToolCallRecord[]
) => ({
  grep: tool({
    description: "Search file contents with ripgrep. Returns 'path:line:text'.",
    execute: async ({ glob, pattern }, { toolCallId }) => {
      const result = await workspace.searchContent({
        limit: CHILD_GREP_LIMIT,
        pattern,
        ...(glob ? { glob } : {})
      })
      const output = result.ok
        ? clampText(
            result.value.trimEnd() || "(no matches)",
            TOOL_OUTPUT_MAX_CHARS
          )
        : `error: ${result.error.message}`

      toolCalls.push({
        input: { glob, pattern },
        output,
        toolCallId,
        toolName: "grep"
      })

      return output
    },
    inputSchema: z.object({
      glob: z.string().optional(),
      pattern: z.string().min(1)
    })
  }),
  ls: tool({
    description: "List a project directory.",
    execute: async ({ path }, { toolCallId }) => {
      const result = await workspace.listDir(path ?? ".")
      const output = result.ok
        ? clampText(
            result.value
              .map((entry) => `${entry.kind}\t${entry.path}`)
              .join("\n"),
            TOOL_OUTPUT_MAX_CHARS
          )
        : `error: ${result.error.message}`

      toolCalls.push({
        input: { path: path ?? "." },
        output,
        toolCallId,
        toolName: "ls"
      })

      return output
    },
    inputSchema: z.object({ path: z.string().optional() })
  }),
  read: tool({
    description: "Read a text file (line-numbered).",
    execute: async ({ path }, { toolCallId }) => {
      const result = await workspace.view(path)

      if (result.ok) {
        filesRead.add(result.value.info.path)
      }

      const output = result.ok
        ? clampText(
            result.value.content
              .split("\n")
              .map((line, index) => `${index + 1}\t${line}`)
              .join("\n"),
            TOOL_OUTPUT_MAX_CHARS
          )
        : `error: ${result.error.message}`

      toolCalls.push({ input: { path }, output, toolCallId, toolName: "read" })

      return output
    },
    inputSchema: z.object({ path: z.string().min(1) })
  })
})

/**
 * Context a writable child's edit/write/bash tools need: the durable store, the
 * permission mode that decides gating, the top-level run that scopes write
 * claims, this child's holder label, and the parent stream the approval prompt
 * surfaces on.
 */
export interface ChildWriteContext {
  childRunId: string
  db: AppDatabase
  holder: string
  permissionMode: AgentPermissionMode
  topRunId: string
  writer: UIMessageStreamWriter<UIMessage>
}

interface ChildToolDenial {
  error: string
  status: "denied"
}

const deniedChildToolResult = (toolName: string): ChildToolDenial => ({
  error: `The user denied this ${toolName} call. Do not retry it; adjust your approach or leave this change for the parent agent.`,
  status: "denied"
})

/**
 * Blocks the child's tool execute until the gated call is approved. When no
 * approval is needed it returns immediately. Otherwise it opens a durable
 * pending approval, surfaces a `data-subagent-approval` prompt on the parent
 * stream, and awaits the broker; the abort/expiry paths settle the durable row
 * here (the oRPC responder settles the user-answered path), and either way a
 * follow-up `data-subagent-approval` with the same id reconciles the prompt into
 * its resolved state. Returns whether the call may proceed.
 */
const gateChildToolCall = async ({
  approvalNeeded,
  canRemember,
  childRunId,
  dangerous,
  db,
  input,
  preview,
  signal,
  toolCallId,
  toolName,
  writer
}: {
  approvalNeeded: boolean
  canRemember: boolean
  childRunId: string
  dangerous: boolean
  db: AppDatabase
  input: unknown
  preview: string
  signal: AbortSignal | undefined
  toolCallId: string
  toolName: string
  writer: UIMessageStreamWriter<UIMessage>
}): Promise<boolean> => {
  if (!approvalNeeded) {
    return true
  }

  const approvalId = await runExclusiveDbWrite(() =>
    recordChildApprovalRequest({
      db,
      input,
      runId: childRunId,
      toolCallId,
      toolName
    })
  )

  writer.write({
    data: {
      approvalId,
      canRemember,
      childRunId,
      commandOrPath: preview,
      dangerous,
      toolName
    },
    id: approvalId,
    transient: true,
    type: "data-subagent-approval"
  })

  const resolution = await registerApproval({
    approvalId,
    timeoutMs: getSettings().agents.approvals.approvalTtlMs,
    ...(signal ? { signal } : {})
  })

  if (resolution.reason !== "responded") {
    // abort / TTL: the oRPC responder never ran, so settle the durable row here.
    await runExclusiveDbWrite(() =>
      recordChildApprovalResponse({
        approved: false,
        db,
        reason: resolution.reason,
        runId: childRunId,
        toolCallId
      })
    ).catch((error) => {
      logger.error("child_approval_settle_failed", { error })
    })
  }

  writer.write({
    data: {
      approvalId,
      canRemember,
      childRunId,
      commandOrPath: preview,
      dangerous,
      resolved: resolution.approved ? "approved" : "denied",
      toolName
    },
    id: approvalId,
    transient: true,
    type: "data-subagent-approval"
  })

  return resolution.approved
}

/**
 * Write/edit/bash for a writable delegated child. Unlike the parent's tools these
 * do NOT use the AI SDK `needsApproval` suspend path (that would tear down
 * sibling children): each execute gates approval inline via {@link gateChildToolCall}
 * using the same pure predicates the parent uses, then edit/write place a write
 * claim so parallel children never clobber a shared file. Reuses the parent's
 * workspace edit/write/shell primitives so behavior stays identical.
 */
export const buildChildWriteTools = ({
  childRunId,
  db,
  holder,
  permissionMode,
  toolCalls,
  topRunId,
  workspace,
  writer
}: ChildWriteContext & {
  toolCalls: DelegatedToolCallRecord[]
  workspace: WorkspaceCore
}): ToolSet => ({
  bash: tool({
    description:
      "Run a shell command from the project root (each command needs user approval unless previously remembered for this project). Returns stdout/stderr tails, exit code, and duration.",
    execute: async (
      { command, timeoutSeconds },
      { abortSignal, toolCallId }
    ) => {
      const { approvals } = getSettings().agents
      const isRemembered = matchesCommandAllowlist({
        allowlist: approvals.commandAllowlist,
        approvalTtlMs: approvals.approvalTtlMs,
        command,
        nowMs: Date.now(),
        projectPath: workspace.projectPath,
        toolName: BASH_TOOL_NAME
      })
      const dangerous = isDangerousShellCommand(command)
      const approved = await gateChildToolCall({
        approvalNeeded: needsShellApproval({
          command,
          isRemembered,
          mode: permissionMode
        }),
        canRemember: !dangerous,
        childRunId,
        dangerous,
        db,
        input: { command, timeoutSeconds },
        preview: clampText(command, CHILD_APPROVAL_PREVIEW_MAX_CHARS),
        signal: abortSignal,
        toolCallId,
        toolName: BASH_TOOL_NAME,
        writer
      })

      if (!approved) {
        return deniedChildToolResult(BASH_TOOL_NAME)
      }

      // bash is exempt from write claims: shell writes cannot be identified from
      // the command statically. The claim system guards edit/write only.
      const output = await runShellCommand({
        command,
        cwd: workspace.projectPath,
        signal: abortSignal,
        timeoutSeconds: timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
      })

      toolCalls.push({
        input: { command, timeoutSeconds },
        output,
        toolCallId,
        toolName: BASH_TOOL_NAME
      })

      return output
    },
    inputSchema: BashInputSchema
  }),
  edit: tool({
    description:
      "Apply one or more exact text replacements to a file (requires user approval). Read the file first.",
    execute: async (inputData, { abortSignal, toolCallId }) => {
      const approved = await gateChildToolCall({
        approvalNeeded: needsFileEditApproval(permissionMode),
        canRemember: false,
        childRunId,
        dangerous: false,
        db,
        input: inputData,
        preview: clampText(inputData.path, CHILD_APPROVAL_PREVIEW_MAX_CHARS),
        signal: abortSignal,
        toolCallId,
        toolName: "edit",
        writer
      })

      if (!approved) {
        return deniedChildToolResult("edit")
      }

      const claim = claimWrite({ holder, path: inputData.path, topRunId })

      if (!claim.ok) {
        const conflict = {
          error: writeClaimConflictMessage(inputData.path, claim.holder),
          path: inputData.path,
          status: "conflict" as const
        }
        toolCalls.push({
          input: inputData,
          output: conflict,
          toolCallId,
          toolName: "edit"
        })

        return conflict
      }

      const output = await runWorkspaceEdit({
        edits: inputData.edits,
        requestedPath: inputData.path,
        workspace,
        ...(abortSignal ? { signal: abortSignal } : {})
      })

      toolCalls.push({
        input: inputData,
        output,
        toolCallId,
        toolName: "edit"
      })

      return output
    },
    inputSchema: EditInputSchema
  }),
  write: tool({
    description:
      "Create or overwrite a file with the given content (requires user approval). Overwriting requires reading the file first.",
    execute: async (inputData, { abortSignal, toolCallId }) => {
      const approved = await gateChildToolCall({
        approvalNeeded: needsFileEditApproval(permissionMode),
        canRemember: false,
        childRunId,
        dangerous: false,
        db,
        input: inputData,
        preview: clampText(inputData.path, CHILD_APPROVAL_PREVIEW_MAX_CHARS),
        signal: abortSignal,
        toolCallId,
        toolName: "write",
        writer
      })

      if (!approved) {
        return deniedChildToolResult("write")
      }

      const claim = claimWrite({ holder, path: inputData.path, topRunId })

      if (!claim.ok) {
        const conflict = {
          error: writeClaimConflictMessage(inputData.path, claim.holder),
          path: inputData.path,
          status: "conflict" as const
        }
        toolCalls.push({
          input: inputData,
          output: conflict,
          toolCallId,
          toolName: "write"
        })

        return conflict
      }

      const output = await runWorkspaceWrite({
        content: inputData.content,
        requestedPath: inputData.path,
        workspace,
        ...(abortSignal ? { signal: abortSignal } : {})
      })

      toolCalls.push({
        input: inputData,
        output,
        toolCallId,
        toolName: "write"
      })

      return output
    },
    inputSchema: WriteInputSchema
  })
})

export interface DelegatedRunResult {
  filesRead: string[]
  text: string
  toolCalls: DelegatedToolCallRecord[]
  structured?: unknown
}

/**
 * Headless read-only child run: a bounded AI SDK loop with read/ls/grep only.
 * Exported so the `workflow` tool can route each of its read-only agents through
 * the exact same investigator loop the `delegate` tool uses. Callers own the
 * event-store choreography (startAgentRun / recordDelegatedRunOutcome).
 *
 * When both a `writer` and a `childRunId` are supplied the child's UI stream is
 * forwarded to the parent stream (bracketed by `data-subagent-start` /
 * `data-subagent-end`) so the renderer can mount a nested live row. Without them
 * it stays fully headless; either way the run drives to completion and returns
 * the same collected text/tool-calls/structured/filesRead as before.
 */
export const runDelegatedAgent = async ({
  abortSignal,
  childRunId,
  context,
  childProfile,
  maxSteps,
  modelId,
  parentRunId,
  parentToolCallId,
  permissionMode,
  projectPath,
  schema,
  task,
  writer
}: {
  abortSignal?: AbortSignal
  childProfile: ResolvedAgentProfile
  childRunId?: string
  context?: string
  maxSteps?: number
  modelId: string | null
  /** Top-level run id that scopes write claims (the parent run). */
  parentRunId?: string
  parentToolCallId?: string
  /** Present only for a writable delegate; absent keeps the child read-only. */
  permissionMode?: AgentPermissionMode
  projectPath: string
  schema?: unknown
  task: string
  writer?: UIMessageStreamWriter<UIMessage>
}): Promise<DelegatedRunResult> => {
  const workspace = getWorkspaceCore(projectPath)
  const filesRead = new Set<string>()
  const toolCalls: DelegatedToolCallRecord[] = []
  const prompt = context
    ? `Task:\n${task}\n\nContext:\n${context}`
    : `Task:\n${task}`

  let structured: unknown
  const tools: ToolSet = buildChildTools(workspace, filesRead, toolCalls)
  // A writable delegate gets edit/write/bash only when the parent passed a
  // permission mode AND a top-level run to scope claims to, the child profile is
  // writable, and there is a live parent stream to surface approvals on. Workflow
  // never passes these, so its investigators stay structurally read-only.
  let canChildWrite = false
  if (
    permissionMode &&
    parentRunId &&
    writer &&
    childRunId &&
    !childProfile.readonly
  ) {
    canChildWrite = true
    Object.assign(
      tools,
      buildChildWriteTools({
        childRunId,
        db: getDb(),
        holder: childWriteHolder(childRunId, childProfile.id),
        permissionMode,
        toolCalls,
        topRunId: parentRunId,
        workspace,
        writer
      })
    )
  }
  if (schema) {
    tools.submit_findings = tool({
      description: "Submit the structured findings.",
      execute: (input: unknown, { toolCallId }) => {
        structured = input
        toolCalls.push({
          input,
          output: "ack",
          toolCallId,
          toolName: "submit_findings"
        })
        return "Findings submitted."
      },
      inputSchema: jsonSchema(schema as Parameters<typeof jsonSchema>[0])
    })
  }
  const result = streamText({
    model: resolveModel(modelId ?? undefined),
    prompt,
    stopWhen: stepCountIs(maxSteps ?? CHILD_MAX_STEPS),
    system: childSystemPrompt(childProfile, canChildWrite),
    tools,
    ...(abortSignal ? { abortSignal } : {})
  })

  if (!(writer && childRunId)) {
    // Headless: `result.text` self-consumes the stream to completion, so tool
    // executions run and errors reject exactly like the old generateText call.
    const text = await result.text

    return { filesRead: [...filesRead], structured, text, toolCalls }
  }

  const startedAtMs = Date.now()

  writer.write({
    data: {
      childRunId,
      ...(parentToolCallId ? { parentToolCallId } : {}),
      profileId: childProfile.id,
      task: clampText(task, SUBAGENT_TASK_MAX_CHARS)
    },
    id: childRunId,
    transient: true,
    type: "data-subagent-start"
  })

  let endState: ChatSubagentEndState = "succeeded"
  let errorMessage: string | undefined

  try {
    await forwardSubagentStream({
      childRunId,
      stream: result.toUIMessageStream({ sendReasoning: true }),
      writer
    })
    const text = await result.text

    return { filesRead: [...filesRead], structured, text, toolCalls }
  } catch (error) {
    endState = abortSignal?.aborted ? "aborted" : "failed"
    errorMessage = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    writer.write({
      data: {
        childRunId,
        durationMs: Date.now() - startedAtMs,
        ...(errorMessage ? { errorMessage } : {}),
        state: endState
      },
      id: `${childRunId}:end`,
      transient: true,
      type: "data-subagent-end"
    })
  }
}

export interface DelegateToolContext {
  chatSessionId: string
  parentModelId: string | null
  /** Parent's approval mode; a writable child inherits it to gate its tools. */
  permissionMode: AgentPermissionMode
  parentProfile: ResolvedAgentProfile
  parentRunId: string
  projectPath: string
  /** Parent UI stream; when present the child's progress is forwarded live. */
  writer?: UIMessageStreamWriter<UIMessage>
}

export const buildDelegateTool = ({
  chatSessionId,
  parentModelId,
  parentProfile,
  parentRunId,
  permissionMode,
  projectPath,
  writer
}: DelegateToolContext) =>
  tool({
    description: `Delegate a bounded, self-contained task to a specialist sub-agent. A writable specialist can modify files and run commands (you approve each change one at a time); a read-only specialist only investigates and reports. It returns a summary, the files it touched, and its run id. Run sub-agents in parallel only when their tasks cover DIFFERENT files or modules — a write to a file another sub-task already claimed is rejected. Allowed profiles: ${parentProfile.allowedDelegateProfileIds.join(", ")}.`,
    execute: async (inputData, context) => {
      const settings = getSettings().agents
      const childProfile = resolveDelegateTarget(
        settings,
        parentProfile,
        inputData.profileId
      )
      const modelId = childProfile.preferredModel || parentModelId

      if (!tryAcquireChildSlot(parentRunId, settings.maxConcurrentSubagents)) {
        throw new Error(
          `Concurrent sub-agent limit (${settings.maxConcurrentSubagents}) reached. Wait for an in-flight delegation to finish before delegating again.`
        )
      }

      const db = getDb()
      let childRunId: string | null = null

      try {
        childRunId = await startAgentRun({
          chatSessionId,
          db,
          modelId,
          parentRunId,
          profileId: childProfile.id
        })
        const run = await runDelegatedAgent({
          childProfile,
          childRunId,
          maxSteps: settings.maxSubagentSteps,
          modelId,
          // The parent run scopes write claims; the mode gates the child's tools.
          // A read-only child target ignores both (it never builds write tools).
          parentRunId,
          permissionMode,
          projectPath,
          task: inputData.task,
          ...(context?.toolCallId
            ? { parentToolCallId: context.toolCallId }
            : {}),
          ...(writer ? { writer } : {}),
          ...(inputData.context ? { context: inputData.context } : {}),
          ...(context?.abortSignal ? { abortSignal: context.abortSignal } : {})
        })

        // Serialize with the child's approval writes (recordChildApproval*, also
        // wrapped): a writable child can finish while the oRPC approval responder
        // is still persisting, and two unsynchronized libsql transactions race to
        // SQLITE_BUSY. Same guard the workflow tool applies to its children.
        const settledRunId = childRunId

        await runExclusiveDbWrite(() =>
          recordDelegatedRunOutcome({
            db,
            runId: settledRunId,
            status: "succeeded",
            toolCalls: run.toolCalls
          })
        )

        return {
          childRunId,
          filesRead: run.filesRead,
          summary: clampText(run.text, SUMMARY_MAX_CHARS)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        if (childRunId) {
          const failedRunId = childRunId

          await runExclusiveDbWrite(() =>
            recordDelegatedRunOutcome({
              db,
              errorMessage: message,
              runId: failedRunId,
              status: "failed",
              toolCalls: []
            })
          ).catch((recordError) => {
            logger.error("delegate_run_record_failed", { error: recordError })
          })
        }

        throw new Error(`Delegation failed: ${message}`, { cause: error })
      } finally {
        releaseChildSlot(parentRunId)
      }
    },
    inputSchema: z
      .object({
        context: z
          .string()
          .optional()
          .describe("Optional extra context the child should know."),
        profileId: z
          .string()
          .min(1)
          .describe("Specialist profile id to delegate to."),
        task: z
          .string()
          .min(1)
          .describe(
            "Self-contained task description; the child does not see this conversation."
          )
      })
      .strict()
  })
