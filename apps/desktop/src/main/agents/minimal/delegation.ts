import type { AgentSettings } from "@etyon/rpc"
import { createTool } from "@mastra/core/tools"
import { generateText, stepCountIs, tool } from "ai"
import { z } from "zod"

import {
  recordDelegatedRunOutcome,
  startAgentRun
} from "@/main/agents/agent-event-store"
import type { DelegatedToolCallRecord } from "@/main/agents/agent-event-store"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import type { WorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { getDb } from "@/main/db"
import { logger } from "@/main/logger"
import { resolveModel } from "@/main/server/lib/providers"
import { getSettings } from "@/main/settings"
import { resolveProfileById } from "@/shared/agents/profiles"
import type { ResolvedAgentProfile } from "@/shared/agents/profiles"

/**
 * Multi-agent delegation as an agent-as-tool. A write-capable parent profile
 * can hand a bounded, self-contained task to a read-only specialist child. The
 * child runs a headless AI SDK loop with read-only tools only — it cannot
 * write, cannot delegate further (nesting depth is capped at 1 by construction),
 * and never sees the parent transcript. The parent gets back a summary, the
 * files the child read, and the child run id; the full child trace lives in the
 * event store under its `parentRunId`.
 */

const CHILD_MAX_STEPS = 12
const CHILD_GREP_LIMIT = 100
const TOOL_OUTPUT_MAX_CHARS = 12_000
const SUMMARY_MAX_CHARS = 8000

const clampText = (text: string, max: number): string =>
  text.length <= max
    ? text
    : `${text.slice(0, max)}\n[... truncated at ${max} characters]`

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

const childSystemPrompt = (profile: ResolvedAgentProfile): string =>
  `You are a read-only delegated sub-agent (profile: ${profile.name}). ${profile.instructions}

You can only read, list, and search files. You cannot modify anything. Investigate the task, then reply with a concise summary: what you found (with file:line references) and, if changes are needed, the exact edits you recommend so the parent agent can apply them under approval.`

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

interface DelegatedRunResult {
  filesRead: string[]
  text: string
  toolCalls: DelegatedToolCallRecord[]
}

const runDelegatedAgent = async ({
  abortSignal,
  context,
  childProfile,
  modelId,
  projectPath,
  task
}: {
  abortSignal?: AbortSignal
  childProfile: ResolvedAgentProfile
  context?: string
  modelId: string | null
  projectPath: string
  task: string
}): Promise<DelegatedRunResult> => {
  const workspace = getWorkspaceCore(projectPath)
  const filesRead = new Set<string>()
  const toolCalls: DelegatedToolCallRecord[] = []
  const prompt = context
    ? `Task:\n${task}\n\nContext:\n${context}`
    : `Task:\n${task}`

  const result = await generateText({
    model: resolveModel(modelId ?? undefined),
    prompt,
    stopWhen: stepCountIs(CHILD_MAX_STEPS),
    system: childSystemPrompt(childProfile),
    tools: buildChildTools(workspace, filesRead, toolCalls),
    ...(abortSignal ? { abortSignal } : {})
  })

  return { filesRead: [...filesRead], text: result.text, toolCalls }
}

export interface DelegateToolContext {
  chatSessionId: string
  parentModelId: string | null
  parentProfile: ResolvedAgentProfile
  parentRunId: string
  projectPath: string
}

export const buildDelegateTool = ({
  chatSessionId,
  parentModelId,
  parentProfile,
  parentRunId,
  projectPath
}: DelegateToolContext) =>
  createTool({
    description: `Delegate a bounded, read-only investigation to a specialist sub-agent. The child cannot modify files; it returns a summary, the files it read, and recommended changes for you to apply under approval. Allowed profiles: ${parentProfile.allowedDelegateProfileIds.join(", ")}.`,
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
          modelId,
          projectPath,
          task: inputData.task,
          ...(inputData.context ? { context: inputData.context } : {}),
          ...(context?.abortSignal ? { abortSignal: context.abortSignal } : {})
        })

        await recordDelegatedRunOutcome({
          db,
          runId: childRunId,
          status: "succeeded",
          toolCalls: run.toolCalls
        })

        return {
          childRunId,
          filesRead: run.filesRead,
          summary: clampText(run.text, SUMMARY_MAX_CHARS)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        if (childRunId) {
          await recordDelegatedRunOutcome({
            db,
            errorMessage: message,
            runId: childRunId,
            status: "failed",
            toolCalls: []
          }).catch((recordError) => {
            logger.error("delegate_run_record_failed", { error: recordError })
          })
        }

        throw new Error(`Delegation failed: ${message}`, { cause: error })
      } finally {
        releaseChildSlot(parentRunId)
      }
    },
    id: "delegate",
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
