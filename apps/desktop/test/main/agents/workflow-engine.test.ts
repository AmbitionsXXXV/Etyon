import { describe, expect, it } from "vite-plus/test"

import {
  parseWorkflowScript,
  runWorkflow
} from "@/main/agents/minimal/workflow/engine"
import type { WorkflowRunAgent } from "@/main/agents/minimal/workflow/engine"

const echoRunAgent: WorkflowRunAgent = ({ prompt }) =>
  Promise.resolve(`echo:${prompt}`)

const failingRunAgent: WorkflowRunAgent = () =>
  Promise.reject(new Error("boom"))

// A meta whose name uses a template placeholder. The `$` is produced via a real
// interpolation (code point 36) so the literal two-char `${` never appears in a
// quoted string (which no-template-curly-in-string would flag); the resulting
// script text is: export const meta = { name: `a${1}`, description: "b" }
const INTERPOLATED_META_SCRIPT = `export const meta = { name: \`a${String.fromCodePoint(36)}{1}\`, description: "b" }`

const META = `export const meta = { name: "t", description: "d" }\n`

const run = (body: string, runAgent: WorkflowRunAgent = echoRunAgent) =>
  runWorkflow(`${META}${body}`, { runAgent, startedAtMs: 0 })

describe("parseWorkflowScript", () => {
  it("splits a valid script into meta and body", () => {
    const { body, meta } = parseWorkflowScript(
      `export const meta = { name: "wf", description: "does x", phases: [{ title: "Scan" }] }\nreturn 1`
    )

    expect(meta.name).toBe("wf")
    expect(meta.phases?.[0]?.title).toBe("Scan")
    expect(body.includes("return 1")).toBe(true)
    expect(body.includes("export const meta")).toBe(false)
  })

  it("rejects a missing or non-first meta export", () => {
    expect(() => parseWorkflowScript(`const x = 1`)).toThrow(/first statement/u)
    expect(() =>
      parseWorkflowScript(
        `const x = 1\nexport const meta = { name: "a", description: "b" }`
      )
    ).toThrow(/first statement/u)
  })

  it("rejects non-const meta and extra declarators", () => {
    expect(() =>
      parseWorkflowScript(`export let meta = { name: "a", description: "b" }`)
    ).toThrow(/const/u)
    expect(() =>
      parseWorkflowScript(
        `export const meta = { name: "a", description: "b" }, other = 1`
      )
    ).toThrow(/only .meta./u)
  })

  it("rejects non-literal meta (spread, computed, method, interpolation, call)", () => {
    expect(() =>
      parseWorkflowScript(
        `export const meta = { ...x, name: "a", description: "b" }`
      )
    ).toThrow(/spread/u)
    expect(() =>
      parseWorkflowScript(
        `export const meta = { ["k"]: 1, name: "a", description: "b" }`
      )
    ).toThrow(/computed/u)
    expect(() =>
      parseWorkflowScript(
        `export const meta = { name: "a", description: "b", go() {} }`
      )
    ).toThrow(/methods/u)
    expect(() => parseWorkflowScript(INTERPOLATED_META_SCRIPT)).toThrow(
      /interpolation/u
    )
    expect(() =>
      parseWorkflowScript(
        `export const meta = { name: fn(), description: "b" }`
      )
    ).toThrow(/non-literal/u)
  })

  it("rejects meta missing required string fields", () => {
    expect(() =>
      parseWorkflowScript(`export const meta = { name: "a" }`)
    ).toThrow(/description/u)
    expect(() =>
      parseWorkflowScript(`export const meta = { name: "", description: "b" }`)
    ).toThrow(/name/u)
  })

  it("rejects non-deterministic constructs", () => {
    for (const construct of ["Date.now()", "Math.random()", "new Date()"]) {
      expect(() =>
        parseWorkflowScript(`${META}const t = ${construct}`)
      ).toThrow(/deterministic/u)
    }
  })

  it("accepts deterministic construct names inside prompts", async () => {
    const result = await run(
      `return await agent("Explain Date.now(), Math.random(), and new Date()")`
    )

    expect(result.result).toContain("Date.now()")
  })
})

describe("runWorkflow", () => {
  it("runs a single agent() and returns its value", async () => {
    const result = await run(`return await agent("hello")`)

    expect(result.result).toBe("echo:hello")
    expect(result.agentCount).toBe(1)
  })

  it("preserves order across parallel() fan-out", async () => {
    const result = await run(
      `return await parallel([() => agent("a"), () => agent("b"), () => agent("c")])`
    )

    expect(result.result).toEqual(["echo:a", "echo:b", "echo:c"])
    expect(result.agentCount).toBe(3)
  })

  it("threads pipeline() stages per item", async () => {
    const result = await run(
      `return await pipeline([1, 2], (n) => agent("n" + n), (r) => r + "!")`
    )

    expect(result.result).toEqual(["echo:n1!", "echo:n2!"])
  })

  it("records phases and logs", async () => {
    const result = await run(
      `phase("Scan"); log("started"); return await agent("x")`
    )

    expect(result.phases).toEqual(["Scan"])
    expect(result.logs).toContain("started")
  })

  it("is fail-soft: a throwing runAgent yields null, not a rejection", async () => {
    const result = await run(`return await agent("x")`, failingRunAgent)

    expect(result.result).toBeNull()
    expect(result.logs.some((line) => line.includes("failed"))).toBe(true)
  })

  it("passes args through to the script", async () => {
    const result = await runWorkflow(`${META}return args.n * 2`, {
      args: { n: 21 },
      runAgent: echoRunAgent,
      startedAtMs: 0
    })

    expect(result.result).toBe(42)
  })

  it("rejects when the abort signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      runWorkflow(`${META}return await agent("x")`, {
        runAgent: echoRunAgent,
        signal: controller.signal,
        startedAtMs: 0
      })
    ).rejects.toThrow(/aborted/u)
  })

  it("does not expose process or require to the script", async () => {
    const result = await run(`return typeof process + "/" + typeof require`)

    expect(result.result).toBe("undefined/undefined")
  })

  it("times out synchronous infinite loops", async () => {
    await expect(run(`while (true) {}`)).rejects.toThrow(/timed out/u)
  }, 7000)

  it("caps the total number of agents", async () => {
    await expect(run(`while (true) { await agent("x") }`)).rejects.toThrow(
      /exceeded 1000 agents/u
    )
  })
})
