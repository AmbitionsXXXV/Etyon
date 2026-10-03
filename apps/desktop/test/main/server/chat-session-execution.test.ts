import { describe, expect, it } from "vite-plus/test"

import { runWithChatSessionExecution } from "@/main/server/routes/chat-session-execution"

const closedResponse = (): Promise<Response> =>
  Promise.resolve(new Response(null, { status: 204 }))
const consume = async (response: Response | null): Promise<void> => {
  await response?.arrayBuffer()
}

describe("chat session execution", () => {
  it("holds a session through stream settlement but permits other sessions", async () => {
    const stream =
      Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
    const first = await runWithChatSessionExecution("stream-session", () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              stream.resolve(controller)
            }
          })
        )
      )
    )
    await expect(
      runWithChatSessionExecution("stream-session", closedResponse)
    ).resolves.toBeNull()
    await expect(
      runWithChatSessionExecution("other-session", closedResponse)
    ).resolves.toMatchObject({ status: 204 })
    const consumption = consume(first)
    const controller = await stream.promise
    controller.enqueue(new Uint8Array([1]))
    await expect(
      runWithChatSessionExecution("stream-session", closedResponse)
    ).resolves.toBeNull()
    controller.close()
    await consumption
    await expect(
      runWithChatSessionExecution("stream-session", closedResponse)
    ).resolves.toMatchObject({ status: 204 })
  })

  it("does not release on client cancellation before the upstream run settles", async () => {
    const stream =
      Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
    const first = await runWithChatSessionExecution("cancel-session", () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              stream.resolve(controller)
            }
          })
        )
      )
    )
    const reader = first?.body?.getReader()
    const cancelled = reader?.cancel()
    await expect(
      runWithChatSessionExecution("cancel-session", closedResponse)
    ).resolves.toBeNull()
    const controller = await stream.promise
    controller.enqueue(new Uint8Array([1]))
    await expect(
      runWithChatSessionExecution("cancel-session", closedResponse)
    ).resolves.toBeNull()
    controller.close()
    await cancelled
    await expect(
      runWithChatSessionExecution("cancel-session", closedResponse)
    ).resolves.toMatchObject({ status: 204 })
  })

  it("releases failed construction and upstream stream errors", async () => {
    await expect(
      runWithChatSessionExecution("error-session", () =>
        Promise.reject(new Error("construction failed"))
      )
    ).rejects.toThrow("construction failed")
    await expect(
      runWithChatSessionExecution("error-session", closedResponse)
    ).resolves.toMatchObject({ status: 204 })
    const failed = await runWithChatSessionExecution("error-session", () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("stream failed"))
            }
          })
        )
      )
    )
    await expect(consume(failed)).rejects.toThrow("stream failed")
    await expect(
      runWithChatSessionExecution("error-session", closedResponse)
    ).resolves.toMatchObject({ status: 204 })
    await expect(
      runWithChatSessionExecution("error-session", () =>
        Promise.resolve(new Response("failure", { status: 500 }))
      )
    ).resolves.toMatchObject({ status: 500 })
    await expect(
      runWithChatSessionExecution("error-session", closedResponse)
    ).resolves.toMatchObject({ status: 204 })
  })
})
