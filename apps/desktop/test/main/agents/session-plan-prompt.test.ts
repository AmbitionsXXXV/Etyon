import { describe, expect, it } from "vite-plus/test"

import { buildSessionPlanSystemPrompt } from "@/main/agents/session-plan-prompt"

const plan = {
  planMarkdown: "1. step one\n2. step two",
  status: "proposed" as const,
  title: "Refactor auth"
}

describe("buildSessionPlanSystemPrompt", () => {
  it("returns null in chat mode (agents off)", () => {
    expect(buildSessionPlanSystemPrompt({ agentMode: "chat", plan })).toBeNull()
  })

  it("returns null when no mode is set", () => {
    expect(
      buildSessionPlanSystemPrompt({ agentMode: undefined, plan })
    ).toBeNull()
  })

  it("returns null for a done plan", () => {
    expect(
      buildSessionPlanSystemPrompt({
        agentMode: "agent",
        plan: { ...plan, status: "done" }
      })
    ).toBeNull()
  })

  it("returns null for a dismissed plan", () => {
    expect(
      buildSessionPlanSystemPrompt({
        agentMode: "agent",
        plan: { ...plan, status: "dismissed" }
      })
    ).toBeNull()
  })

  it("tells agent mode a proposed plan is not started and can be implemented", () => {
    const block = buildSessionPlanSystemPrompt({ agentMode: "agent", plan })

    expect(block).toContain("has not been started yet")
    expect(block).toContain("Refactor auth")
    expect(block).toContain("todo_write")
    expect(block).toContain(plan.planMarkdown)
  })

  it("keeps plan mode read-only for a proposed plan", () => {
    const block = buildSessionPlanSystemPrompt({ agentMode: "plan", plan })

    expect(block).toContain("read-only")
    expect(block).toContain("press Implement")
  })

  it("tells agent mode to keep executing an implementing plan", () => {
    const block = buildSessionPlanSystemPrompt({
      agentMode: "agent",
      plan: { ...plan, status: "implementing" }
    })

    expect(block).toContain("executing the saved plan")
    expect(block).toContain("keep the todo list in sync")
  })

  it("reuses the read-only block for an implementing plan in plan mode", () => {
    const block = buildSessionPlanSystemPrompt({
      agentMode: "plan",
      plan: { ...plan, status: "implementing" }
    })

    expect(block).toContain("read-only")
    expect(block).toContain("already exists")
  })

  it("clamps a huge plan and marks it truncated", () => {
    const bigPlan = "x".repeat(20_000)
    const block = buildSessionPlanSystemPrompt({
      agentMode: "agent",
      plan: { ...plan, planMarkdown: bigPlan }
    })

    expect(block).toContain("[plan truncated]")
    expect(block?.includes("x".repeat(16_000))).toBe(true)
    expect(block?.includes("x".repeat(16_001))).toBe(false)
  })

  it("does not truncate a plan within the limit", () => {
    const block = buildSessionPlanSystemPrompt({ agentMode: "agent", plan })

    expect(block).not.toContain("[plan truncated]")
  })
})
