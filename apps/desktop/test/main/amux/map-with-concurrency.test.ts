import { setTimeout as sleep } from "node:timers/promises"

import { describe, expect, it } from "vite-plus/test"

import { mapWithConcurrency } from "@/main/amux/map-with-concurrency"

describe("mapWithConcurrency", () => {
  it("keeps at most `limit` tasks in flight and results in order", async () => {
    let running = 0
    let peak = 0
    const results = await mapWithConcurrency(
      [30, 10, 20, 5, 15],
      2,
      async (ms) => {
        running += 1
        peak = Math.max(peak, running)
        await sleep(ms)
        running -= 1

        return ms * 2
      }
    )

    expect(peak).toBe(2)
    expect(
      results.map((result) => result.status === "fulfilled" && result.value)
    ).toEqual([60, 20, 40, 10, 30])
  })

  it("runs every task and reports failures per item", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 3, (value) =>
      value === 2 ? Promise.reject(new Error("boom")) : Promise.resolve(value)
    )

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
      "fulfilled"
    ])
  })
})
