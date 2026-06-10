import fs from "node:fs"
import path from "node:path"

import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/message-port"
import type { RouterClient } from "@orpc/server"
import { RPCHandler } from "@orpc/server/message-port"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import { ensureDatabaseReady } from "@/main/db/migrate"
import { createMessagePortRpcContext } from "@/main/rpc/context"
import type { AppRouter } from "@/main/rpc/router"
import { router } from "@/main/rpc/router"

const { mockedAppPath, mockedHomeDir, mockedResolveModel } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-rpc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  mockedResolveModel: vi.fn()
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

vi.mock("electron-store", () => {
  class MockElectronStore {
    readonly store = new Map<string, unknown>()

    get(key: string): unknown {
      return this.store.get(key)
    }

    set(key: string, value: unknown): void {
      this.store.set(key, value)
    }
  }

  return {
    default: MockElectronStore
  }
})

vi.mock("electron", () => {
  const electronMock = {
    BrowserWindow: {
      getAllWindows: () => []
    },
    app: {
      getAppPath: () => mockedAppPath,
      getLocale: () => "en-US",
      getName: () => "Etyon Test",
      getPath: () => mockedHomeDir,
      getVersion: () => "0.1.0-test",
      name: "Etyon Test"
    },
    ipcMain: {
      on: vi.fn()
    }
  }

  return {
    ...electronMock,
    default: electronMock
  }
})

vi.mock("@/main/server/lib/providers", () => ({
  resolveModel: mockedResolveModel
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

  it("exposes memory stats and entries over the message-port adapter", async () => {
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

    const stats = await client.memory.stats()
    const entries = await client.memory.list({
      limit: 5
    })

    expect(stats.totalEntries).toBeGreaterThanOrEqual(0)
    expect(entries.entries).toEqual(expect.any(Array))

    port1.close()
    port2.close()
  })

  it("exposes parsed skills over the message-port adapter", async () => {
    const projectPath = path.join(mockedHomeDir, "skills-project")
    const skillDir = path.join(projectPath, ".agents", "skills", "rpc-skill")

    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: rpc-skill",
        "description: Use when testing RPC skill parsing.",
        "---",
        "",
        "Use RPC skill instructions."
      ].join("\n")
    )

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

    await client.chatSessions.create({
      projectPath
    })

    const result = await client.skills.list()

    expect(result.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "rpc-skill",
          projectPath,
          scope: "project"
        })
      ])
    )

    await client.projects.remove({
      projectPath
    })

    port1.close()
    port2.close()
  })

  it("exposes skill prompt templates over the message-port adapter", async () => {
    const projectPath = path.join(mockedHomeDir, "prompt-template-project")
    const promptDir = path.join(
      projectPath,
      ".agents",
      "skills",
      "rpc-template-skill",
      "prompts"
    )

    fs.mkdirSync(promptDir, { recursive: true })
    fs.writeFileSync(
      path.join(path.dirname(promptDir), "SKILL.md"),
      [
        "---",
        "name: rpc-template-skill",
        "description: Use when testing RPC prompt templates.",
        "---",
        "",
        "Use RPC prompt template instructions."
      ].join("\n")
    )
    fs.writeFileSync(
      path.join(promptDir, "review.md"),
      [
        "---",
        "name: review",
        "description: Review selected context",
        "---",
        "Review $1."
      ].join("\n")
    )

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

    await client.chatSessions.create({
      projectPath
    })

    const result = await client.skills.listPromptTemplates()

    expect(result.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: "Review $1.",
          description: "Review selected context",
          name: "review",
          path: path.join(promptDir, "review.md")
        })
      ])
    )

    await client.projects.remove({
      projectPath
    })

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

  it("creates a chat session for an explicit project path over the message-port adapter", async () => {
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

    const createdSession = await client.chatSessions.create({
      projectPath: "/tmp/etyon-rpc-explicit-project"
    })

    expect(createdSession.projectPath).toBe("/tmp/etyon-rpc-explicit-project")
    expect(fs.existsSync(createdSession.projectPath)).toBe(true)

    port1.close()
    port2.close()
  })

  it("archives chat sessions over the message-port adapter", async () => {
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
    const archivedSession = await (
      client.chatSessions as typeof client.chatSessions & {
        archive: (input: { sessionId: string }) => Promise<{
          archivedAt: string | null
          id: string
        }>
      }
    ).archive({
      sessionId: createdSession.id
    })
    const sessionsAfterArchive = await client.chatSessions.list()

    expect(archivedSession.id).toBe(createdSession.id)
    expect(archivedSession.archivedAt).toBeTruthy()
    expect(
      sessionsAfterArchive.some((session) => session.id === createdSession.id)
    ).toBe(false)

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
      projectDisplayNames: {},
      projectOrder: [],
      projectPins: {},
      sidebarWidthPx: 272
    })
    expect(updatedState).toEqual({
      collapsedProjectPaths: ["/tmp/a-project", "/tmp/b-project"],
      projectDisplayNames: {},
      projectOrder: [],
      projectPins: {},
      sidebarWidthPx: 272
    })
    expect(resizedState).toEqual({
      collapsedProjectPaths: ["/tmp/a-project", "/tmp/b-project"],
      projectDisplayNames: {},
      projectOrder: [],
      projectPins: {},
      sidebarWidthPx: 320
    })
    expect(await client.sidebarState.get()).toEqual(resizedState)

    port1.close()
    port2.close()
  })

  it("runs project sidebar actions over the message-port adapter", async () => {
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

    const projectPath = "/tmp/etyon-rpc-project-actions"
    const createdSession = await client.chatSessions.create({
      projectPath
    })
    const renamedState = await client.projects.rename({
      displayName: "Project Actions",
      projectPath
    })
    const pinnedState = await client.projects.setPinned({
      pinned: true,
      projectPath
    })
    const orderedState = await client.sidebarState.setProjectOrder({
      projectOrder: [projectPath]
    })
    const sessionsAfterArchive = await client.projects.archiveChats({
      projectPath
    })
    const recreatedSession = await client.chatSessions.create({
      projectPath
    })
    const sessionsAfterRemove = await client.projects.remove({
      projectPath
    })

    expect(renamedState.projectDisplayNames[projectPath]).toBe(
      "Project Actions"
    )
    expect(pinnedState.projectPins[projectPath]).toBeTruthy()
    expect(orderedState.projectOrder).toEqual([projectPath])
    expect(
      sessionsAfterArchive.some((session) => session.id === createdSession.id)
    ).toBe(false)
    expect(
      sessionsAfterRemove.some((session) => session.id === recreatedSession.id)
    ).toBe(false)
    expect(await client.sidebarState.get()).toMatchObject({
      projectDisplayNames: {},
      projectOrder: [],
      projectPins: {}
    })

    port1.close()
    port2.close()
  })

  it("updates the session model and exposes project snapshot procedures over the message-port adapter", async () => {
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
    const sourceFilePath = path.join(
      createdSession.projectPath,
      "src",
      "rpc.ts"
    )

    fs.mkdirSync(path.dirname(sourceFilePath), { recursive: true })
    fs.writeFileSync(sourceFilePath, "export const rpcValue = 1\n")

    const updatedSession = await client.chatSessions.setModel({
      modelId: "openai/gpt-4o-mini",
      sessionId: createdSession.id
    })
    const snapshotState = await client.projectSnapshots.ensure({
      sessionId: createdSession.id
    })
    const listFilesResult = await client.projectSnapshots.listFiles({
      query: "rpc",
      sessionId: createdSession.id
    })

    expect(updatedSession.modelId).toBe("openai/gpt-4o-mini")
    expect(snapshotState.projectPath).toBe(createdSession.projectPath)
    expect(snapshotState.snapshotId).toBeTruthy()
    expect(listFilesResult.snapshotId).toBe(snapshotState.snapshotId)
    expect(listFilesResult.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: "src/rpc.ts",
          snapshotId: snapshotState.snapshotId
        })
      ])
    )

    port1.close()
    port2.close()
  })
})
