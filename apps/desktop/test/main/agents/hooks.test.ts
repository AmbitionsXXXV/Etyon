import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { tool } from "ai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"
import { z } from "zod"

import { listHookConfigs } from "@/main/agents/hooks/config"
import { createHookRunner } from "@/main/agents/hooks/runner"
import type { HookAudit } from "@/main/agents/hooks/runner"
import { wrapToolsWithHooks } from "@/main/agents/hooks/tool-wrapper"

let root: string
let globalConfigPath: string
beforeEach(async () => {
  root = await mkdtemp("/private/tmp/etyon-hooks-")
  await mkdir(path.join(root, ".etyon"))
  globalConfigPath = path.join(root, "global-hooks.json")
})
afterEach(async () => {
  await rm(root, { force: true, recursive: true })
})

const config = async (hooks: unknown[]): Promise<void> => {
  await writeFile(
    path.join(root, ".etyon", "hooks.json"),
    JSON.stringify({ hooks })
  )
}

describe("file-based lifecycle hooks", { timeout: 30_000 }, () => {
  it("sends structured stdin after approval and blocks exit 2 without invoking the tool", async () => {
    await config([
      {
        command: "cat > payload.json; printf 'policy rejected' >&2; exit 2",
        event: "PreToolUse",
        matcher: "^write$"
      }
    ])
    const audit: HookAudit[] = []
    const runner = createHookRunner({
      enabled: true,
      globalConfigPath,
      onAudit: (event) => {
        audit.push(event)
      },
      projectPath: root
    })
    const execute = vi.fn(() => Promise.resolve("written"))
    await expect(
      runner.invoke({
        execute,
        input: { path: "notes.txt" },
        runId: "run",
        sessionId: "session",
        toolCallId: "call",
        toolName: "write"
      })
    ).rejects.toThrow("policy rejected")
    expect(execute).not.toHaveBeenCalled()
    const payload = JSON.parse(
      await readFile(path.join(root, "payload.json"), "utf-8")
    )
    expect(payload).toMatchObject({
      event: "PreToolUse",
      input: { path: "notes.txt" },
      runId: "run",
      sessionId: "session",
      toolCallId: "call",
      toolName: "write"
    })
    expect(audit.map(({ phase }) => phase)).toEqual(["started", "finished"])
    expect(audit[1]?.exitCode).toBe(2)
  })

  it("combines global and project hooks, matches names and adds bounded post context", async () => {
    await writeFile(
      globalConfigPath,
      JSON.stringify({
        hooks: [
          {
            command: "printf 'global'",
            event: "PostToolUse",
            matcher: "^read$"
          }
        ]
      })
    )
    await config([
      { command: "printf 'project'", event: "PostToolUse", matcher: "^read$" },
      { command: "exit 2", event: "PreToolUse", matcher: "^write$" }
    ])
    const runner = createHookRunner({
      enabled: true,
      globalConfigPath,
      projectPath: root
    })
    expect(
      await runner.invoke({
        execute: () => Promise.resolve("file"),
        runId: null,
        sessionId: null,
        toolName: "read"
      })
    ).toBe("file\n\nHook context:\nglobal\nproject")
  })

  it("allows timeout with an audit warning and kills background descendants", async () => {
    await config([
      {
        command: "(sleep 0.2; printf bad > leaked.txt) & wait",
        event: "PreToolUse",
        timeoutMs: 30
      }
    ])
    const audit: HookAudit[] = []
    const runner = createHookRunner({
      enabled: true,
      globalConfigPath,
      onAudit: (event) => {
        audit.push(event)
      },
      projectPath: root
    })
    const result = await runner.run("PreToolUse", {
      runId: "run",
      sessionId: "session",
      toolName: "read"
    })
    expect(result.blocked).toBe(false)
    expect(result.warnings[0]).toContain("timeout")
    expect(audit.at(-1)?.status).toBe("timeout")
    // A second real process supplies the elapsed-time boundary for the child.
    await config([{ command: "sleep 0.3", event: "Stop" }])
    await runner.run("Stop", { runId: "run", sessionId: "session" })
    await expect(readFile(path.join(root, "leaked.txt"))).rejects.toThrow()
  })

  it("settles cancellation, disables all commands and rejects invalid configs with a warning", async () => {
    await config([{ command: "sleep 10", event: "PreToolUse" }])
    const controller = new AbortController()
    const audit: HookAudit[] = []
    const runner = createHookRunner({
      enabled: true,
      globalConfigPath,
      onAudit: (event) => {
        audit.push(event)
        if (event.phase === "started") {
          controller.abort()
        }
      },
      projectPath: root
    })
    await expect(
      runner.invoke({
        execute: () => Promise.resolve("read"),
        runId: null,
        sessionId: null,
        signal: controller.signal,
        toolName: "read"
      })
    ).rejects.toThrow("cancelled")
    expect(audit.at(-1)?.status).toBe("aborted")
    expect(
      await createHookRunner({
        enabled: false,
        globalConfigPath,
        projectPath: root
      }).invoke({
        execute: () => Promise.resolve("read"),
        runId: null,
        sessionId: null,
        toolName: "read"
      })
    ).toBe("read")
    await config([{ command: "exit 2", event: "PreToolUse", matcher: "[" }])
    const loadedConfigs = await listHookConfigs({
      globalConfigPath,
      projectPath: root
    })
    expect(loadedConfigs[1]?.error).toBeDefined()
    const result = await runner.run("PreToolUse", {
      runId: null,
      sessionId: null
    })
    expect(result.blocked).toBe(false)
    expect(result.warnings[0]).toContain("Invalid hooks")
  })

  it("caps output and executes Stop without requiring a tool matcher", async () => {
    await config([
      {
        command: "awk 'BEGIN { for (i=0; i<20000; i++) printf \"x\" }'",
        event: "PostToolUse"
      },
      {
        command: "printf done > stopped.txt",
        event: "Stop",
        matcher: "^impossible$"
      }
    ])
    const audit: HookAudit[] = []
    const runner = createHookRunner({
      enabled: true,
      globalConfigPath,
      onAudit: (event) => {
        audit.push(event)
      },
      projectPath: root
    })
    const result = await runner.run("PostToolUse", {
      result: "result",
      runId: null,
      sessionId: null,
      toolName: "read"
    })
    expect(result.context).toHaveLength(8192)
    expect(audit.at(-1)?.truncated).toBe(true)
    await runner.run("Stop", { runId: "run", sessionId: "session" })
    expect(await readFile(path.join(root, "stopped.txt"), "utf-8")).toBe("done")
  })

  it("preserves object fields and reports failed tool executions to PostToolUse", async () => {
    await config([
      { command: "cat > post.json; printf evidence", event: "PostToolUse" }
    ])
    const runner = createHookRunner({
      enabled: true,
      globalConfigPath,
      projectPath: root
    })
    const result = await runner.invoke({
      execute: () => Promise.resolve({ todos: [{ id: "task" }], ok: true }),
      runId: "run",
      sessionId: "session",
      toolName: "task_list"
    })
    expect(result).toEqual({
      hookContext: "evidence",
      ok: true,
      todos: [{ id: "task" }]
    })
    await expect(
      runner.invoke({
        execute: () => Promise.reject(new Error("tool failure")),
        runId: "run",
        sessionId: "session",
        toolName: "write"
      })
    ).rejects.toThrow("tool failure")
    expect(
      JSON.parse(await readFile(path.join(root, "post.json"), "utf-8"))
    ).toMatchObject({
      event: "PostToolUse",
      result: { error: "tool failure", status: "failed" }
    })
  })

  it("carries PostToolUse context through an existing custom model-output projection", async () => {
    await config([
      { command: "printf 'validation facts'", event: "PostToolUse" }
    ])
    const runner = createHookRunner({
      enabled: true,
      globalConfigPath,
      projectPath: root
    })
    const tools = wrapToolsWithHooks(
      {
        task: tool({
          execute: () => Promise.resolve({ ok: true, todos: [] }),
          inputSchema: z.object({}),
          toModelOutput: ({ output }) => ({
            type: "json",
            value: { ok: output.ok }
          })
        })
      },
      { runner, runId: "run", sessionId: "session" }
    )
    const { task } = tools
    if (!task?.execute || !task.toModelOutput) {
      throw new Error("Expected an executable task tool.")
    }
    const output = await task.execute(
      {},
      { context: {}, messages: [], toolCallId: "call" }
    )
    if (Symbol.asyncIterator in output) {
      throw new Error("Expected a completed JSON result.")
    }
    const projected = await task.toModelOutput({
      input: {},
      output,
      toolCallId: "call"
    })
    expect(projected).toEqual({
      type: "json",
      value: { hookContext: "validation facts", ok: true }
    })
  })

  it("refuses pathological matcher repetition and keeps valid tool alternatives", async () => {
    await config([
      { command: "exit 2", event: "PreToolUse", matcher: "^(a+)+$" }
    ])
    const invalid = await listHookConfigs({
      globalConfigPath,
      projectPath: root
    })
    expect(invalid[1]?.error).toContain("simple tool-name alternatives")
    await config([
      { command: "exit 0", event: "PreToolUse", matcher: "^(read|write|edit)$" }
    ])
    const valid = await listHookConfigs({ globalConfigPath, projectPath: root })
    expect(valid[1]?.error).toBeUndefined()
    expect(valid[1]?.hooks).toHaveLength(1)
  })
})
