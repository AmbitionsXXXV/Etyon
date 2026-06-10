import { afterEach, describe, expect, it, vi } from "vite-plus/test"

const { defaultChatTransportMock, getUrlMock, transportOptions } = vi.hoisted(
  () => {
    const capturedTransportOptions: unknown[] = []

    // Must be constructible: the transport is created with `new`.
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- arrow mocks are not constructible and the autofixer rewrites function expressions
    class MockDefaultChatTransport {
      constructor(options: unknown) {
        capturedTransportOptions.push(options)
      }
    }

    return {
      defaultChatTransportMock: MockDefaultChatTransport,
      getUrlMock: vi.fn(() =>
        Promise.resolve({
          token: "local-token",
          url: "http://127.0.0.1:60222"
        })
      ),
      transportOptions: capturedTransportOptions
    }
  }
)

vi.mock("@/renderer/lib/rpc", () => ({
  rpcClient: {
    server: {
      getUrl: getUrlMock
    }
  }
}))

vi.mock("ai", () => ({
  DefaultChatTransport: defaultChatTransportMock
}))

describe("chat transport", () => {
  afterEach(async () => {
    const { resetChatTransport } = await import("@/renderer/lib/ai/transport")

    resetChatTransport()
    transportOptions.length = 0
    vi.clearAllMocks()
  })

  it("adds the local connection bearer token to chat requests", async () => {
    const { getChatTransport } = await import("@/renderer/lib/ai/transport")

    await getChatTransport()

    expect(getUrlMock).toHaveBeenCalledTimes(1)
    expect(transportOptions[0]).toEqual({
      api: "http://127.0.0.1:60222/api/chat",
      headers: {
        authorization: "Bearer local-token"
      }
    })
  })
})
