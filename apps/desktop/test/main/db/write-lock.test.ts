import { describe, expect, it } from "vite-plus/test"

import { runExclusiveDbWrite } from "@/main/db/write-lock"

describe("runExclusiveDbWrite", () => {
  it("serializes overlapping tasks", async () => {
    const order: string[] = []
    const deferredA = Promise.withResolvers<null>()

    const taskA = runExclusiveDbWrite(async () => {
      order.push("a:start")
      await deferredA.promise
      order.push("a:end")
    })

    const taskB = runExclusiveDbWrite(() => {
      order.push("b:start", "b:end")
      return Promise.resolve()
    })

    deferredA.resolve(null)

    await Promise.all([taskA, taskB])

    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"])
  })

  it("releases the queue after a rejected task", async () => {
    const taskAError = new Error("task a failed")

    const taskA = runExclusiveDbWrite(() => {
      throw taskAError
    })
    const taskB = runExclusiveDbWrite(() => Promise.resolve("b-result"))

    await expect(taskB).resolves.toBe("b-result")
    await expect(taskA).rejects.toThrow(taskAError)
  })
})
