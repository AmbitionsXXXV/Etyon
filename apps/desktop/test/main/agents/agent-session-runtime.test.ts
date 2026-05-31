import { describe, expect, it, vi } from "vite-plus/test"

import type { Agent } from "@/main/agents/agent"
import type { AgentSessionRuntimeEvent } from "@/main/agents/agent-session-runtime"
import { createAgentSessionRuntime } from "@/main/agents/agent-session-runtime"

const createAgentStub = () => {
  const abort = vi.fn()
  const waitForIdle = vi.fn(() => Promise.resolve())
  const agent = {
    abort,
    waitForIdle
  } as unknown as Agent

  return {
    abort,
    agent,
    waitForIdle
  }
}

describe("agent session runtime", () => {
  it("rebuilds sessions by disposing the previous agent first", async () => {
    const events: AgentSessionRuntimeEvent[] = []
    const runtime = createAgentSessionRuntime()
    const firstAgent = createAgentStub()
    const secondAgent = createAgentStub()

    runtime.subscribe((event) => {
      events.push(event)
    })

    const firstSession = await runtime.start({
      createAgent: () => firstAgent.agent,
      mode: "new",
      projectPath: "/repo",
      runId: "run-a",
      sessionId: "session-a"
    })
    const secondSession = await runtime.start({
      createAgent: () => secondAgent.agent,
      mode: "resume",
      projectPath: "/repo",
      runId: "run-b",
      sessionId: "session-b"
    })

    expect(firstSession.generation).toBe(1)
    expect(secondSession.generation).toBe(2)
    expect(runtime.getCurrent()).toBe(secondSession)
    expect(firstAgent.abort).toHaveBeenCalledOnce()
    expect(firstAgent.waitForIdle).toHaveBeenCalledOnce()
    expect(secondAgent.abort).not.toHaveBeenCalled()
    expect(events).toEqual([
      expect.objectContaining({
        generation: 1,
        mode: "new",
        runId: "run-a",
        sessionId: "session-a",
        type: "agent_session_runtime_started"
      }),
      expect.objectContaining({
        generation: 1,
        mode: "new",
        runId: "run-a",
        sessionId: "session-a",
        type: "agent_session_runtime_disposed"
      }),
      expect.objectContaining({
        generation: 2,
        mode: "resume",
        runId: "run-b",
        sessionId: "session-b",
        type: "agent_session_runtime_started"
      })
    ])
  })

  it("serializes concurrent session rebuilds", async () => {
    const runtime = createAgentSessionRuntime()
    const slowAgent = createAgentStub()
    const fastAgent = createAgentStub()
    const { promise, resolve } = Promise.withResolvers<Agent>()

    const slowStart = runtime.start({
      createAgent: () => promise,
      mode: "fork",
      projectPath: "/repo",
      runId: "slow-run",
      sessionId: "slow-session"
    })
    const fastStart = runtime.start({
      createAgent: () => fastAgent.agent,
      mode: "import",
      projectPath: "/repo",
      runId: "fast-run",
      sessionId: "fast-session"
    })

    resolve(slowAgent.agent)

    const [slowSession, fastSession] = await Promise.all([slowStart, fastStart])

    expect(slowSession.generation).toBe(1)
    expect(fastSession.generation).toBe(2)
    expect(runtime.getCurrent()).toBe(fastSession)
    expect(slowAgent.abort).toHaveBeenCalledOnce()
    expect(slowAgent.waitForIdle).toHaveBeenCalledOnce()
  })

  it("clears the current session when agent creation fails after teardown", async () => {
    const runtime = createAgentSessionRuntime()
    const currentAgent = createAgentStub()

    await runtime.start({
      createAgent: () => currentAgent.agent,
      mode: "new",
      projectPath: "/repo",
      runId: "current-run",
      sessionId: "current-session"
    })

    await expect(
      runtime.start({
        createAgent: () => {
          throw new Error("factory failed")
        },
        mode: "fork",
        projectPath: "/repo",
        runId: "next-run",
        sessionId: "next-session"
      })
    ).rejects.toMatchObject({
      code: "session",
      message: "Failed to create agent session runtime for next-session."
    })
    expect(runtime.getCurrent()).toBeNull()
    expect(currentAgent.abort).toHaveBeenCalledOnce()
    expect(currentAgent.waitForIdle).toHaveBeenCalledOnce()
  })

  it("disposes the current session idempotently", async () => {
    const events: AgentSessionRuntimeEvent[] = []
    const runtime = createAgentSessionRuntime()
    const agent = createAgentStub()

    runtime.subscribe((event) => {
      events.push(event)
    })

    await runtime.start({
      createAgent: () => agent.agent,
      mode: "new",
      projectPath: "/repo",
      runId: "run-a",
      sessionId: "session-a"
    })
    await runtime.dispose()
    await runtime.dispose()

    expect(runtime.getCurrent()).toBeNull()
    expect(agent.abort).toHaveBeenCalledOnce()
    expect(agent.waitForIdle).toHaveBeenCalledOnce()
    expect(events.map((event) => event.type)).toEqual([
      "agent_session_runtime_started",
      "agent_session_runtime_disposed"
    ])
  })
})
