import { describe, expect, it, vi } from "vite-plus/test"

import {
  AgentRuntimeError,
  createAgentRuntimeState
} from "@/main/agents/agent-state"

const createDeferred = <TValue>() => {
  const { promise, reject, resolve } = Promise.withResolvers<TValue>()

  return {
    promise,
    reject,
    resolve
  }
}

describe("agent runtime state", () => {
  it("guards structural phases from concurrent entry", () => {
    const runtimeState = createAgentRuntimeState()
    const turn = runtimeState.beginPhase("turn")

    expect(runtimeState.getSnapshot()).toEqual({
      phase: "turn"
    })
    expect(() => runtimeState.beginPhase("compaction")).toThrow(
      new AgentRuntimeError("busy", "Agent runtime is busy.")
    )

    turn.end()

    expect(runtimeState.getSnapshot()).toEqual({
      phase: "idle"
    })
  })

  it("notifies subscribers when phase changes", () => {
    const runtimeState = createAgentRuntimeState()
    const listener = vi.fn()
    const unsubscribe = runtimeState.subscribe(listener)
    const turn = runtimeState.beginPhase("turn")

    turn.end()
    unsubscribe()
    runtimeState.beginPhase("retry").end()

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenNthCalledWith(1, {
      phase: "turn"
    })
    expect(listener).toHaveBeenNthCalledWith(2, {
      phase: "idle"
    })
  })

  it("waits for the runtime to become idle", async () => {
    const runtimeState = createAgentRuntimeState()
    const turn = runtimeState.beginPhase("turn")
    const idlePromise = runtimeState.waitForIdle()
    let resolved = false

    idlePromise.then(() => {
      resolved = true
    })
    await Promise.resolve()

    expect(resolved).toBe(false)

    turn.end()
    await idlePromise

    expect(resolved).toBe(true)
  })

  it("waits for async subscribers to settle before resolving idle", async () => {
    const runtimeState = createAgentRuntimeState()
    const listenerDone = createDeferred<null>()
    let resolved = false

    runtimeState.subscribe(async () => {
      await listenerDone.promise
    })

    const turn = runtimeState.beginPhase("turn")
    const idlePromise = runtimeState.waitForIdle()

    idlePromise.then(() => {
      resolved = true
    })

    turn.end()
    await Promise.resolve()

    expect(resolved).toBe(false)

    listenerDone.resolve(null)
    await idlePromise

    expect(resolved).toBe(true)
  })
})
