import { spawn } from "node:child_process"

import { getShellSpawnEnv } from "@/main/agents/minimal/spawn-env"

const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024
const GIT_TIMEOUT_MS = 30_000

export const runWorktreeGit = (
  cwd: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv
    input?: string
    signal?: AbortSignal
  } = {}
): Promise<string> => {
  const { promise, reject, resolve } = Promise.withResolvers<string>()
  if (options.signal?.aborted) {
    reject(new Error("Git operation was cancelled."))
    return promise
  }
  const child = spawn(
    "git",
    ["--literal-pathspecs", "-c", "core.quotePath=false", ...args],
    {
      cwd,
      detached: process.platform !== "win32",
      env: {
        ...getShellSpawnEnv(),
        GIT_TERMINAL_PROMPT: "0",
        ...options.env
      },
      stdio: ["pipe", "pipe", "pipe"]
    }
  )
  let stdout = ""
  let stderr = ""
  let bytes = 0
  let failure: Error | undefined
  let settled = false
  const kill = (): void => {
    if (process.platform !== "win32" && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL")
        return
      } catch {
        /* Already exited. */
      }
    }
    child.kill("SIGKILL")
  }
  const abort = (): void => {
    failure = new Error("Git operation was cancelled.")
    kill()
  }
  const timeout = setTimeout(() => {
    failure = new Error("Git operation timed out.")
    kill()
  }, GIT_TIMEOUT_MS)
  const finish = (code: number | null): void => {
    if (settled) {
      return
    }
    settled = true
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abort)
    if (failure || code !== 0) {
      reject(failure ?? new Error(stderr.trim() || `Git exited with ${code}.`))
      return
    }
    resolve(stdout)
  }
  const collect = (chunk: string, isError: boolean): void => {
    bytes += Buffer.byteLength(chunk)
    if (bytes > MAX_GIT_OUTPUT_BYTES) {
      failure = new Error("Git output exceeds 8 MiB; narrow the change.")
      kill()
      return
    }
    if (isError) {
      stderr += chunk
    } else {
      stdout += chunk
    }
  }
  child.stdout.setEncoding("utf-8")
  child.stderr.setEncoding("utf-8")
  child.stdout.on("data", (chunk: string) => {
    collect(chunk, false)
  })
  child.stderr.on("data", (chunk: string) => {
    collect(chunk, true)
  })
  child.stdin.on("error", () => {
    /* Git may reject a patch before consuming it. */
  })
  child.on("error", (error) => {
    failure = error
    finish(null)
  })
  child.on("close", finish)
  options.signal?.addEventListener("abort", abort, { once: true })
  child.stdin.end(options.input)
  if (options.signal?.aborted) {
    abort()
  }
  return promise
}
