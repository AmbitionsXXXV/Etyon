import { describe, expect, it } from "vite-plus/test"

import { createReasoningTimingTap } from "@/main/agents/minimal/reasoning-timing-tap"

const streamOf = <T>(chunks: readonly T[]): ReadableStream<T> =>
  new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    }
  })

const drain = async <T>(stream: ReadableStream<T>): Promise<T[]> => {
  const reader = stream.getReader()
  const out: T[] = []

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    out.push(value)
  }

  return out
}

describe("createReasoningTimingTap", () => {
  it("measures each non-empty reasoning block in completion order", async () => {
    const stamps = [1000, 1200, 5000, 5500]
    let cursor = 0
    const tap = createReasoningTimingTap(() => {
      const stamp = stamps[cursor] ?? 0
      cursor += 1
      return stamp
    })

    const passed = await drain(
      tap.wrap(
        streamOf([
          { id: "r1", type: "reasoning-start" },
          { delta: "thinking", id: "r1", type: "reasoning-delta" },
          { id: "r1", type: "reasoning-end" },
          { delta: "hi", id: "t", type: "text-delta" },
          { id: "r2", type: "reasoning-start" },
          { delta: "more", id: "r2", type: "reasoning-delta" },
          { id: "r2", type: "reasoning-end" }
        ])
      )
    )

    expect(tap.getDurationsMs()).toEqual([200, 500])
    // The tap is a pass-through: every chunk is forwarded untouched.
    expect(passed).toHaveLength(7)
  })

  it("drops reasoning blocks with no textual content", async () => {
    const stamps = [0, 100, 300]
    let cursor = 0
    const tap = createReasoningTimingTap(() => {
      const stamp = stamps[cursor] ?? 0
      cursor += 1
      return stamp
    })

    await drain(
      tap.wrap(
        streamOf([
          { id: "empty", type: "reasoning-start" },
          { delta: "   ", id: "empty", type: "reasoning-delta" },
          { id: "empty", type: "reasoning-end" },
          { id: "real", type: "reasoning-start" },
          { delta: "x", id: "real", type: "reasoning-delta" },
          { id: "real", type: "reasoning-end" }
        ])
      )
    )

    expect(tap.getDurationsMs()).toEqual([200])
  })
})
