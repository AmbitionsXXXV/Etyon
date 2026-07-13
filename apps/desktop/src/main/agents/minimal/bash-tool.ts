import { spawn } from "node:child_process"
import fsSync from "node:fs"
import path from "node:path"

import type { AgentCommandApprovalRule, AgentSettings } from "@etyon/rpc"
import { tool } from "ai"
import { z } from "zod"

import { captureBashCheckpoint } from "@/main/agents/checkpoints"
import {
  isRtkAvailable,
  rewriteCommandForRtk
} from "@/main/agents/minimal/rtk-rewrite"
import { getShellSpawnEnv } from "@/main/agents/minimal/spawn-env"
import type { WorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { needsShellApproval } from "@/shared/agents/permission-mode"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"

export const BASH_TOOL_NAME = "bash"
export const DEFAULT_TIMEOUT_SECONDS = 120
const MAX_TIMEOUT_SECONDS = 600
const STDOUT_TAIL_MAX_CHARS = 9000
const STDERR_TAIL_MAX_CHARS = 3000
// Prefer bash for consistent `-c` semantics; fall back to POSIX sh when a
// packaged runtime ships without /bin/bash.
const shell = fsSync.existsSync("/bin/bash") ? "/bin/bash" : "sh"

export const BashInputSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .describe("Shell command to execute from the project root."),
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_TIMEOUT_SECONDS)
      .optional()
      .describe("Kill the command after this many seconds (default 120).")
  })
  .strict()

export type BashCommandStatus = "aborted" | "completed" | "timeout"

export interface BashCommandResult {
  durationMs: number
  exitCode: number | null
  status: BashCommandStatus
  stderrPreview: string
  stdoutPreview: string
  truncated: boolean
}

export interface BashToolResult extends BashCommandResult {
  details: {
    command: string
    executedCommand: string
    rtkApplied: boolean
  }
}

/**
 * Whether a remembered approval covers this exact command. Matching is
 * deliberately exact (no prefix/pattern matching) to keep the permission
 * surface trivial: an entry counts only when the tool, resolved project path,
 * and trimmed command all match and the approval has not aged out.
 */
export const matchesCommandAllowlist = ({
  allowlist,
  approvalTtlMs,
  command,
  nowMs,
  projectPath,
  toolName
}: {
  allowlist: readonly AgentCommandApprovalRule[]
  approvalTtlMs: number
  command: string
  nowMs: number
  projectPath: string
  toolName: string
}): boolean => {
  const resolvedProjectPath = path.resolve(projectPath)
  const trimmedCommand = command.trim()

  return allowlist.some((rule) => {
    if (rule.toolName !== toolName) {
      return false
    }

    if (path.resolve(rule.projectPath) !== resolvedProjectPath) {
      return false
    }

    if (rule.command.trim() !== trimmedCommand) {
      return false
    }

    const createdAtMs = Date.parse(rule.createdAt)

    if (Number.isNaN(createdAtMs)) {
      return false
    }

    return createdAtMs + approvalTtlMs > nowMs
  })
}

const appendTail = ({
  budget,
  chunk,
  tail
}: {
  budget: number
  chunk: string
  tail: string
}): { tail: string; truncated: boolean } => {
  const combined = tail + chunk

  if (combined.length > budget) {
    return { tail: combined.slice(-budget), truncated: true }
  }

  return { tail: combined, truncated: false }
}

/**
 * Runs a shell command from `cwd`, capturing bounded stdout/stderr tails.
 * Exported so a writable delegated child reuses the exact spawn/timeout/abort
 * behavior of the parent's bash tool (the child gates approval in its own
 * execute rather than via the AI SDK `needsApproval` path).
 */
export const runShellCommand = ({
  command,
  cwd,
  signal,
  timeoutSeconds
}: {
  command: string
  cwd: string
  signal: AbortSignal | undefined
  timeoutSeconds: number
}): Promise<BashCommandResult> => {
  if (signal?.aborted) {
    return Promise.resolve({
      durationMs: 0,
      exitCode: null,
      status: "aborted",
      stderrPreview: "",
      stdoutPreview: "",
      truncated: false
    })
  }

  const startedAtMs = Date.now()
  const { promise, reject, resolve } =
    Promise.withResolvers<BashCommandResult>()
  const child = spawn(shell, ["-c", command], {
    cwd,
    detached: process.platform !== "win32",
    env: getShellSpawnEnv(),
    stdio: ["ignore", "pipe", "pipe"]
  })

  let stdoutTail = ""
  let stderrTail = ""
  let truncated = false
  let status: BashCommandStatus = "completed"
  let settled = false

  // Detached ⇒ the child leads its own process group, so a negative pid
  // signals the whole tree; fall back to a direct kill if that fails.
  const killProcessTree = (): void => {
    if (process.platform !== "win32" && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL")

        return
      } catch (error) {
        void error
      }
    }

    try {
      child.kill("SIGKILL")
    } catch (error) {
      void error
    }
  }

  const onAbort = (): void => {
    status = "aborted"
    killProcessTree()
  }

  const timeoutHandle = setTimeout(() => {
    status = "timeout"
    killProcessTree()
  }, timeoutSeconds * 1000)

  signal?.addEventListener("abort", onAbort)

  const cleanup = (): void => {
    clearTimeout(timeoutHandle)
    signal?.removeEventListener("abort", onAbort)
  }

  child.stdout?.setEncoding("utf-8")
  child.stdout?.on("data", (chunk: string) => {
    const next = appendTail({
      budget: STDOUT_TAIL_MAX_CHARS,
      chunk,
      tail: stdoutTail
    })
    stdoutTail = next.tail
    truncated ||= next.truncated
  })

  child.stderr?.setEncoding("utf-8")
  child.stderr?.on("data", (chunk: string) => {
    const next = appendTail({
      budget: STDERR_TAIL_MAX_CHARS,
      chunk,
      tail: stderrTail
    })
    stderrTail = next.tail
    truncated ||= next.truncated
  })

  // Only spawn failures reach here; a command that exits non-zero is a normal
  // `close`. This is the sole throwing path.
  child.on("error", (error) => {
    if (settled) {
      return
    }

    settled = true
    cleanup()
    reject(error instanceof Error ? error : new Error(String(error)))
  })

  // Wait for `close` (not `exit`) so both pipes have drained.
  child.on("close", (code) => {
    if (settled) {
      return
    }

    settled = true
    cleanup()
    resolve({
      durationMs: Date.now() - startedAtMs,
      exitCode: status === "completed" ? code : null,
      status,
      stderrPreview: stderrTail,
      stdoutPreview: stdoutTail,
      truncated
    })
  })

  return promise
}

/**
 * Runs an arbitrary shell command from the project root. Every call is
 * approval-gated (see needsApproval) unless the exact command was remembered
 * for this project. Non-zero exit codes, timeouts, and aborts all resolve with
 * a structured result — only a spawn failure throws.
 */
export const buildBashTool = (
  workspace: WorkspaceCore,
  permissionMode: AgentPermissionMode,
  settings: Pick<AgentSettings, "approvals" | "rtk">,
  checkpointRunId?: string
) =>
  tool({
    description:
      "Run a shell command from the project root. Returns stdout and stderr tails, the exit code, and duration. Each command requires user approval unless the exact command was previously remembered for this project. Prefer read/ls/grep/edit/write for file content work.",
    execute: async (inputData, context): Promise<BashToolResult> => {
      const rewrite =
        settings.rtk.autoRewrite && (await isRtkAvailable())
          ? rewriteCommandForRtk(inputData.command)
          : { executedCommand: inputData.command, rtkApplied: false }

      if (checkpointRunId && context?.toolCallId) {
        await captureBashCheckpoint({
          projectPath: workspace.projectPath,
          runId: checkpointRunId,
          toolCallId: context.toolCallId
        })
      }

      const result = await runShellCommand({
        command: rewrite.executedCommand,
        cwd: workspace.projectPath,
        signal: context?.abortSignal,
        timeoutSeconds: inputData.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS
      })

      return {
        ...result,
        details: {
          command: inputData.command,
          executedCommand: rewrite.executedCommand,
          rtkApplied: rewrite.rtkApplied
        }
      }
    },
    inputSchema: BashInputSchema,
    needsApproval: (inputData) => {
      const isRemembered = matchesCommandAllowlist({
        allowlist: settings.approvals.commandAllowlist,
        approvalTtlMs: settings.approvals.approvalTtlMs,
        command: inputData.command,
        nowMs: Date.now(),
        projectPath: workspace.projectPath,
        toolName: BASH_TOOL_NAME
      })

      return needsShellApproval({
        command: inputData.command,
        isRemembered,
        mode: permissionMode
      })
    }
  })
