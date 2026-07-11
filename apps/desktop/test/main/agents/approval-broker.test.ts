import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  hasPendingApproval,
  registerApproval,
  resolveApproval
} from "@/main/agents/approval-broker"

let nextId = 0
const uniqueId = (): string => {
  nextId += 1

  return `run-${nextId}:tc`
}

afterEach(() => {
  vi.useRealTimers()
})

describe("approval broker", () => {
  it("resolves as responded/approved when the user approves", async () => {
    const approvalId = uniqueId()
    const pending = registerApproval({ approvalId })

    expect(hasPendingApproval(approvalId)).toBe(true)
    expect(resolveApproval(approvalId, true)).toBe(true)

    expect(await pending).toEqual({ approved: true, reason: "responded" })
    // The entry is cleared, so a second resolve is a no-op.
    expect(hasPendingApproval(approvalId)).toBe(false)
    expect(resolveApproval(approvalId, true)).toBe(false)
  })

  it("resolves as responded/denied when the user denies", async () => {
    const approvalId = uniqueId()
    const pending = registerApproval({ approvalId })

    expect(resolveApproval(approvalId, false)).toBe(true)
    expect(await pending).toEqual({ approved: false, reason: "responded" })
  })

  it("resolves as aborted when the abort signal fires", async () => {
    const approvalId = uniqueId()
    const controller = new AbortController()
    const pending = registerApproval({
      approvalId,
      signal: controller.signal
    })

    controller.abort()

    expect(await pending).toEqual({ approved: false, reason: "aborted" })
    expect(hasPendingApproval(approvalId)).toBe(false)
    // A late user response after abort can no longer reach the child.
    expect(resolveApproval(approvalId, true)).toBe(false)
  })

  it("resolves immediately as aborted when the signal is already aborted", async () => {
    const approvalId = uniqueId()
    const controller = new AbortController()

    controller.abort()

    const resolution = await registerApproval({
      approvalId,
      signal: controller.signal
    })

    expect(resolution).toEqual({ approved: false, reason: "aborted" })
    expect(hasPendingApproval(approvalId)).toBe(false)
  })

  it("resolves as expired when the TTL elapses", async () => {
    vi.useFakeTimers()
    const approvalId = uniqueId()
    const pending = registerApproval({ approvalId, timeoutMs: 1000 })

    await vi.advanceTimersByTimeAsync(1000)

    expect(await pending).toEqual({ approved: false, reason: "expired" })
    expect(hasPendingApproval(approvalId)).toBe(false)
  })

  it("lets a user response win a race against a not-yet-elapsed TTL", async () => {
    vi.useFakeTimers()
    const approvalId = uniqueId()
    const pending = registerApproval({ approvalId, timeoutMs: 10_000 })

    expect(resolveApproval(approvalId, true)).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await pending).toEqual({ approved: true, reason: "responded" })
  })

  it("settles a prior waiter as aborted when the same id re-registers", async () => {
    const approvalId = uniqueId()
    const first = registerApproval({ approvalId })
    const second = registerApproval({ approvalId })

    expect(await first).toEqual({ approved: false, reason: "aborted" })
    expect(resolveApproval(approvalId, true)).toBe(true)
    expect(await second).toEqual({ approved: true, reason: "responded" })
  })
})
