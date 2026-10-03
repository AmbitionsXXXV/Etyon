import { spawn } from "node:child_process"
import { createHash } from "node:crypto"

import type { HookEvent } from "@etyon/rpc/schemas/hooks"

import { listHookConfigs } from "@/main/agents/hooks/config"
import type { LoadedHook } from "@/main/agents/hooks/config"
import {
  getRuntimeHookSignal,
  registerHookProcess
} from "@/main/agents/hooks/lifecycle"
import { getShellSpawnEnv } from "@/main/agents/minimal/spawn-env"

const MAX_OUTPUT_CHARS = 8192
const MAX_INPUT_BYTES = 256 * 1024
const MAX_TOTAL_CONTEXT_CHARS = 16_384
export const STOP_HOOK_TOTAL_TIMEOUT_MS = 5000

export class HookBlockedError extends Error {
  readonly targetExecuted = false
  constructor(reason: string) {
    super(reason)
    this.name = "HookBlockedError"
  }
}

const NOOP_UNREGISTER = (): void => {
  /* Assigned after process registration. */
}

const matchesHook = (
  hook: Pick<LoadedHook, "event" | "matcher">,
  event: HookEvent,
  toolName?: string
): boolean =>
  hook.event === event &&
  (event === "Stop" ||
    new RegExp(hook.matcher, "u").test((toolName ?? "").slice(0, 128)))

const handleHookCancellation = (
  event: HookEvent,
  context: HookContext,
  result: HookRunResult
): boolean => {
  if (!context.signal?.aborted) {
    return false
  }
  if (event === "Stop") {
    result.warnings.push("Stop hooks skipped after cancellation or shutdown.")
    return true
  }
  throw new DOMException("Hook execution was cancelled.", "AbortError")
}

export interface HookContext {
  input?: unknown
  result?: unknown
  runId: string | null
  sessionId: string | null
  signal?: AbortSignal
  toolCallId?: string
  toolName?: string
}

export interface HookAudit {
  commandHash: string
  configPath: string
  durationMs: number
  event: HookEvent
  exitCode: number | null
  phase: "finished" | "started" | "warning"
  runId: string | null
  sessionId: string | null
  status: "aborted" | "completed" | "failed" | "timeout"
  toolCallId?: string
  toolName?: string
  truncated: boolean
  warning?: string
}

export interface HookRunResult {
  blocked: boolean
  context: string
  error?: string
  warnings: string[]
}

export interface HookRunner {
  invoke: <T>(
    options: HookContext & {
      execute: () => Promise<T>
      toolName: string
    }
  ) => Promise<T>
  run: (event: HookEvent, context: HookContext) => Promise<HookRunResult>
}

interface ProcessResult {
  durationMs: number
  exitCode: number | null
  status: HookAudit["status"]
  stderr: string
  stdout: string
  truncated: boolean
}

const collectHookResult = (
  event: HookEvent,
  hook: LoadedHook,
  output: ProcessResult,
  result: HookRunResult
): void => {
  if (output.status === "aborted") {
    if (event === "Stop") {
      result.warnings.push("Stop hook execution was cancelled.")
      return
    }
    throw new DOMException("Hook execution was cancelled.", "AbortError")
  }
  if (
    output.status !== "completed" ||
    (output.exitCode !== 0 &&
      !(event === "PreToolUse" && output.exitCode === 2))
  ) {
    result.warnings.push(
      `${event} hook ${hook.configPath}: ${output.status}, exit ${output.exitCode ?? "unknown"}. ${output.stderr}`
    )
  }
  if (
    event === "PreToolUse" &&
    output.status === "completed" &&
    output.exitCode === 2
  ) {
    result.blocked = true
    result.error = output.stderr.trim() || "Blocked by a PreToolUse hook."
  }
  if (
    event === "PostToolUse" &&
    output.status === "completed" &&
    output.exitCode === 0 &&
    output.stdout.trim()
  ) {
    result.context = `${result.context}\n${output.stdout.trim()}`
      .trim()
      .slice(0, MAX_TOTAL_CONTEXT_CHARS)
  }
}

const addHookContext = <T>(output: T, context: string): T => {
  if (!context) {
    return output
  }
  if (typeof output === "string") {
    return `${output}\n\nHook context:\n${context}` as T
  }
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return { ...output, hookContext: context }
  }
  return output
}

const runHookProcess = (
  hook: LoadedHook,
  cwd: string,
  payload: string,
  signal?: AbortSignal
): Promise<ProcessResult> => {
  if (signal?.aborted) {
    return Promise.resolve({
      durationMs: 0,
      exitCode: null,
      status: "aborted",
      stderr: "",
      stdout: "",
      truncated: false
    })
  }
  const { promise, resolve } = Promise.withResolvers<ProcessResult>()
  const start = Date.now()
  const child = spawn(process.env.SHELL ?? "/bin/sh", ["-c", hook.command], {
    cwd,
    detached: process.platform !== "win32",
    env: getShellSpawnEnv(),
    stdio: ["pipe", "pipe", "pipe"]
  })
  let stdout = ""
  let stderr = ""
  let truncated = false
  let status: ProcessResult["status"] = "completed"
  let settled = false
  let unregister = NOOP_UNREGISTER
  const killTree = (): void => {
    if (process.platform !== "win32" && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL")
        return
      } catch {
        /* Process may already have exited. */
      }
    }
    child.kill("SIGKILL")
  }
  const abort = (): void => {
    if (settled) {
      return
    }
    status =
      signal?.reason instanceof Error && signal.reason.name === "TimeoutError"
        ? "timeout"
        : "aborted"
    truncated = true
    killTree()
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
    finish(null)
  }
  const timeout = setTimeout(() => {
    status = "timeout"
    killTree()
  }, hook.timeoutMs)
  const finish = (exitCode: number | null): void => {
    if (settled) {
      return
    }
    settled = true
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abort)
    unregister()
    resolve({
      durationMs: Date.now() - start,
      exitCode,
      status,
      stderr,
      stdout,
      truncated
    })
  }
  signal?.addEventListener("abort", abort, { once: true })
  unregister = registerHookProcess({ cancel: abort, settled: promise })
  if (settled) {
    unregister()
  }
  // Close inherited pipes held by background grandchildren as well.
  child.on("exit", () => {
    killTree()
  })
  child.stdout.setEncoding("utf-8")
  child.stderr.setEncoding("utf-8")
  child.stdout.on("data", (chunk: string) => {
    truncated ||= stdout.length + chunk.length > MAX_OUTPUT_CHARS
    stdout = (stdout + chunk).slice(0, MAX_OUTPUT_CHARS)
  })
  child.stderr.on("data", (chunk: string) => {
    truncated ||= stderr.length + chunk.length > MAX_OUTPUT_CHARS
    stderr = (stderr + chunk).slice(0, MAX_OUTPUT_CHARS)
  })
  child.stdin.on("error", () => {
    /* A hook may exit without consuming stdin. */
  })
  child.on("error", (error) => {
    status = "failed"
    stderr = error.message
    finish(null)
  })
  child.on("close", finish)
  child.stdin.end(payload)
  if (signal?.aborted) {
    abort()
  }
  return promise
}

export const createHookRunner = ({
  configProjectPath,
  enabled,
  globalConfigPath,
  onAudit,
  projectPath
}: {
  configProjectPath?: string
  enabled: boolean
  globalConfigPath?: string
  onAudit?: (audit: HookAudit) => void | Promise<void>
  projectPath: string
}): HookRunner => {
  const runEvent = async (
    event: HookEvent,
    context: HookContext
  ): Promise<HookRunResult> => {
    const result: HookRunResult = { blocked: false, context: "", warnings: [] }
    if (!enabled) {
      return result
    }
    const configs = await listHookConfigs({
      globalConfigPath,
      projectPath: configProjectPath ?? projectPath
    })
    const payload = JSON.stringify({
      event,
      input: context.input,
      result: context.result,
      runId: context.runId,
      sessionId: context.sessionId,
      toolCallId: context.toolCallId,
      toolName: context.toolName
    })
    const inputOverLimit = Buffer.byteLength(payload) > MAX_INPUT_BYTES
    if (inputOverLimit) {
      result.warnings.push(
        "Hook input exceeds 256 KiB; payload values were omitted."
      )
    }
    const boundedPayload = inputOverLimit
      ? JSON.stringify({
          event,
          inputTruncated: true,
          runId: context.runId,
          sessionId: context.sessionId,
          toolCallId: context.toolCallId,
          toolName: context.toolName
        })
      : payload
    for (const config of configs) {
      if (config.error) {
        const warning = `Invalid hooks configuration ${config.path}: ${config.error}`
        result.warnings.push(warning)
        await onAudit?.({
          commandHash: "",
          configPath: config.path,
          durationMs: 0,
          event,
          exitCode: null,
          phase: "warning",
          runId: context.runId,
          sessionId: context.sessionId,
          status: "failed",
          truncated: false,
          warning
        })
      }
      for (const definition of config.hooks) {
        if (handleHookCancellation(event, context, result)) {
          return result
        }
        if (!matchesHook(definition, event, context.toolName)) {
          continue
        }
        const hook = { ...definition, configPath: config.path }
        const audit = {
          commandHash: createHash("sha256").update(hook.command).digest("hex"),
          configPath: hook.configPath,
          event,
          runId: context.runId,
          sessionId: context.sessionId,
          toolCallId: context.toolCallId,
          toolName: context.toolName
        }
        await onAudit?.({
          ...audit,
          durationMs: 0,
          exitCode: null,
          phase: "started",
          status: "completed",
          truncated: false
        })
        if (context.signal?.aborted) {
          await onAudit?.({
            ...audit,
            durationMs: 0,
            exitCode: null,
            phase: "finished",
            status: "aborted",
            truncated: false
          })
          if (handleHookCancellation(event, context, result)) {
            return result
          }
        }
        const output = await runHookProcess(
          hook,
          projectPath,
          boundedPayload,
          context.signal
        )
        await onAudit?.({
          ...audit,
          durationMs: output.durationMs,
          exitCode: output.exitCode,
          phase: "finished",
          status: output.status,
          truncated: output.truncated
        })
        collectHookResult(event, hook, output, result)
        if (result.blocked) {
          return result
        }
      }
    }
    return result
  }
  const run: HookRunner["run"] = async (event, context) => {
    const runtimeSignal = getRuntimeHookSignal()
    const signals = [runtimeSignal, ...(context.signal ? [context.signal] : [])]
    if (event !== "Stop") {
      return await runEvent(event, {
        ...context,
        signal: AbortSignal.any(signals)
      })
    }
    const controller = new AbortController()
    const { promise, resolve } = Promise.withResolvers<HookRunResult>()
    const timer = setTimeout(() => {
      controller.abort(
        new DOMException(
          "Stop hooks exceeded the total deadline.",
          "TimeoutError"
        )
      )
      resolve({
        blocked: false,
        context: "",
        warnings: ["Stop hooks exceeded the total 5 second deadline."]
      })
    }, STOP_HOOK_TOTAL_TIMEOUT_MS)
    const executeStop = async (): Promise<HookRunResult> => {
      if (runtimeSignal.aborted) {
        const warning =
          "Stop hooks skipped because Hook runtime is shutting down."
        await onAudit?.({
          commandHash: "",
          configPath: configProjectPath ?? projectPath,
          durationMs: 0,
          event,
          exitCode: null,
          phase: "warning",
          runId: context.runId,
          sessionId: context.sessionId,
          status: "aborted",
          truncated: false,
          warning
        })
        return { blocked: false, context: "", warnings: [warning] }
      }
      return await runEvent(event, {
        ...context,
        signal: AbortSignal.any([...signals, controller.signal])
      })
    }
    try {
      return await Promise.race([executeStop(), promise])
    } finally {
      clearTimeout(timer)
    }
  }
  const invoke: HookRunner["invoke"] = async ({ execute, ...context }) => {
    const pre = await run("PreToolUse", context)
    if (pre.blocked) {
      throw new HookBlockedError(pre.error ?? "Blocked by a PreToolUse hook.")
    }
    if (context.signal?.aborted || getRuntimeHookSignal().aborted) {
      throw new DOMException("Tool execution was cancelled.", "AbortError")
    }
    let output
    try {
      output = await execute()
    } catch (error) {
      if (!context.signal?.aborted) {
        await run("PostToolUse", {
          ...context,
          result: {
            error: error instanceof Error ? error.message : String(error),
            status: "failed"
          }
        })
      }
      throw error
    }
    const post = await run("PostToolUse", { ...context, result: output })
    return addHookContext(output, post.context)
  }
  return { invoke, run }
}
