import fs from "node:fs"

import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/message-port"
import type { RouterClient } from "@orpc/server"
import { RPCHandler } from "@orpc/server/message-port"
import { afterAll, describe, expect, it, vi } from "vitest"

import { createMessagePortRpcContext } from "./context"
import type { AppRouter } from "./router"
import { router } from "./router"

const { mockedHomeDir } = vi.hoisted(() => ({
  mockedHomeDir: `/tmp/etyon-rpc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: {
    dev: true
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  },
  platform: {
    isLinux: true,
    isMacOS: false,
    isWindows: false
  }
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => []
  },
  app: {
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: {
    on: vi.fn()
  }
}))

describe("message-port rpc", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("keeps ping working over the message-port adapter", async () => {
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.ping({ message: "hello" })

    expect(result.echo).toBe("hello")
    expect(typeof result.pid).toBe("number")
    expect(result.timestamp).toBeTruthy()

    port1.close()
    port2.close()
  })

  it("keeps settings.get working over the message-port adapter", async () => {
    const { port1, port2 } = new MessageChannel()
    const client: RouterClient<AppRouter> = createORPCClient(
      new RPCLink({ port: port2 })
    )
    const handler = new RPCHandler(router)

    handler.upgrade(port1, {
      context: createMessagePortRpcContext()
    })
    port1.start()
    port2.start()

    const result = await client.settings.get()

    expect(result.autoStart).toBe(false)
    expect(result.locale).toBe("system")

    port1.close()
    port2.close()
  })
})
