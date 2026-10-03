import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"

import {
  startRuntimeHooks,
  stopRuntimeHooks
} from "@/main/agents/hooks/lifecycle"
import {
  createHookRunner,
  HookBlockedError,
  STOP_HOOK_TOTAL_TIMEOUT_MS
} from "@/main/agents/hooks/runner"
import type { HookAudit } from "@/main/agents/hooks/runner"

let root: string
beforeEach(async () => {
  startRuntimeHooks()
  root = await mkdtemp("/private/tmp/etyon-hooks-lifecycle-")
  await mkdir(path.join(root, ".etyon"))
})
afterEach(async () => {
  await stopRuntimeHooks()
  await rm(root, { force: true, recursive: true })
})
const runner = (audit: HookAudit[] = []) =>
  createHookRunner({
    enabled: true,
    globalConfigPath: path.join(root, "global.json"),
    onAudit: (event) => {
      audit.push(event)
    },
    projectPath: root
  })
const config = async (
  event: string,
  command: string,
  additional: unknown[] = []
): Promise<void> => {
  await writeFile(
    path.join(root, ".etyon", "hooks.json"),
    JSON.stringify({
      hooks: [{ command, event, timeoutMs: 120_000 }, ...additional]
    })
  )
}
const waitForStarted = async (): Promise<void> => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      if (
        (await readFile(path.join(root, "started.txt"), "utf-8")) === "started"
      ) {
        return
      }
    } catch {
      /* The script has not reached its marker yet. */
    }
    await delay(10)
  }
  throw new Error("Hook process did not start.")
}
const delayedWrite =
  "printf started > started.txt; (sleep 0.3; printf leaked > leaked.txt) & wait"

describe("Hook runtime lifecycle", { timeout: 15_000 }, () => {
  it("kills and settles active detached scripts before shutdown and does not spawn a later Stop", async () => {
    const audit: HookAudit[] = []
    await config("Stop", delayedWrite)
    const active = runner(audit).run("Stop", {
      runId: "run",
      sessionId: "session"
    })
    await waitForStarted()
    await stopRuntimeHooks()
    const ended = await active
    expect(ended.warnings).toContain("Stop hook execution was cancelled.")
    expect(audit.at(-1)?.status).toBe("aborted")
    await delay(400)
    await expect(readFile(path.join(root, "leaked.txt"))).rejects.toThrow()
    const afterShutdown = await runner(audit).run("Stop", {
      runId: "run",
      sessionId: "session"
    })
    expect(afterShutdown.warnings[0]).toContain("shutting down")
    expect(audit.at(-1)?.phase).toBe("warning")
    await expect(readFile(path.join(root, "leaked.txt"))).rejects.toThrow()
  })

  it("cancels a single invocation without leaving its script descendants or running the target", async () => {
    await config("PreToolUse", delayedWrite)
    const controller = new AbortController()
    let effects = 0
    const active = runner().invoke({
      execute: () => {
        effects += 1
        return Promise.resolve("target")
      },
      runId: "run",
      sessionId: "session",
      signal: controller.signal,
      toolName: "write"
    })
    const rejection = expect(active).rejects.toMatchObject({
      name: "AbortError"
    })
    await waitForStarted()
    controller.abort()
    await rejection
    await delay(400)
    expect(effects).toBe(0)
    await expect(readFile(path.join(root, "leaked.txt"))).rejects.toThrow()
  })

  it("bounds the whole Stop sequence and audits timeout without launching the next command", async () => {
    const audit: HookAudit[] = []
    await config("Stop", "sleep 30", [
      { command: "printf bad > second.txt", event: "Stop", timeoutMs: 120_000 }
    ])
    const started = Date.now()
    const result = await runner(audit).run("Stop", {
      runId: "run",
      sessionId: "session"
    })
    expect(Date.now() - started).toBeLessThan(STOP_HOOK_TOTAL_TIMEOUT_MS + 1500)
    expect(result.warnings.join(" ")).toContain("deadline")
    await delay(20)
    expect(
      audit.some(
        (event) => event.phase === "finished" && event.status === "timeout"
      )
    ).toBe(true)
    await expect(readFile(path.join(root, "second.txt"))).rejects.toThrow()
  })

  it("reports a typed PreToolUse rejection with stderr and a known unexecuted target", async () => {
    await config("PreToolUse", "printf 'blocked policy reason' >&2; exit 2")
    let effects = 0
    const active = runner().invoke({
      execute: () => {
        effects += 1
        return Promise.resolve("target")
      },
      runId: "run",
      sessionId: "session",
      toolName: "write"
    })
    await expect(active).rejects.toBeInstanceOf(HookBlockedError)
    await expect(active).rejects.toMatchObject({
      message: "blocked policy reason",
      targetExecuted: false
    })
    expect(effects).toBe(0)
  })
})
