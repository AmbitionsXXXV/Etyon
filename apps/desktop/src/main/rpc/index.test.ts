import fs from "node:fs"

import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/message-port"
import type { RouterClient } from "@orpc/server"
import { RPCHandler } from "@orpc/server/message-port"
import { afterAll, describe, expect, it, vi } from "vitest"

import { ensureDatabaseReady } from "@/main/db/migrate"

import { createMessagePortRpcContext } from "./context"
import type { AppRouter } from "./router"
import { router } from "./router"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
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
    getAppPath: () => mockedAppPath,
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

  it("creates, lists, opens, and pins chat sessions over the message-port adapter", async () => {
    await ensureDatabaseReady()

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

    const createdSession = await client.chatSessions.create({})
    const sessionsAfterCreate = await client.chatSessions.list()
    const openedSession = await client.chatSessions.open({
      sessionId: createdSession.id
    })
    const pinnedSession = await client.chatSessions.setPinned({
      pinned: true,
      sessionId: createdSession.id
    })
    const unpinnedSession = await client.chatSessions.setPinned({
      pinned: false,
      sessionId: createdSession.id
    })

    expect(createdSession.projectPath).toBe(`${mockedHomeDir}/.config/etyon`)
    expect(
      sessionsAfterCreate.some((session) => session.id === createdSession.id)
    ).toBe(true)
    expect(openedSession.id).toBe(createdSession.id)
    expect(openedSession.lastOpenedAt >= createdSession.lastOpenedAt).toBe(true)
    expect(pinnedSession.pinnedAt).toBeTruthy()
    expect(unpinnedSession.pinnedAt).toBeNull()

    port1.close()
    port2.close()
  })

  it("persists collapsed project paths over the message-port adapter", async () => {
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

    const initialState = await client.sidebarState.get()
    const updatedState = await client.sidebarState.setCollapsedProjects({
      collapsedProjectPaths: [
        "/tmp/b-project",
        "/tmp/a-project",
        "/tmp/a-project"
      ]
    })
    const resizedState = await client.sidebarState.setWidth({
      sidebarWidthPx: 320
    })

    expect(initialState).toEqual({
      collapsedProjectPaths: [],
      sidebarWidthPx: 272
    })
    expect(updatedState).toEqual({
      collapsedProjectPaths: ["/tmp/a-project", "/tmp/b-project"],
      sidebarWidthPx: 272
    })
    expect(resizedState).toEqual({
      collapsedProjectPaths: ["/tmp/a-project", "/tmp/b-project"],
      sidebarWidthPx: 320
    })
    expect(await client.sidebarState.get()).toEqual(resizedState)

    port1.close()
    port2.close()
  })
})
