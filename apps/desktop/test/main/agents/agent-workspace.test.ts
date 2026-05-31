import fs from "node:fs"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"

import {
  cleanupAgentWorkspaceResources,
  createAgentWorkspace
} from "@/main/agents/agent-workspace"

const testProjectPath = `/tmp/etyon-agent-workspace-test-${Date.now()}`

const createAgentSettings = () =>
  AppSettingsSchema.parse({
    agents: {
      enabled: true,
      lsp: {
        enabled: true
      },
      sandbox: {
        enabled: true
      }
    }
  }).agents

describe("agent workspace", () => {
  beforeAll(() => {
    fs.mkdirSync(path.join(testProjectPath, "src"), { recursive: true })
  })

  afterAll(async () => {
    await cleanupAgentWorkspaceResources()
    fs.rmSync(testProjectPath, { force: true, recursive: true })
  })

  it("cleans cached LSP managers and background processes", async () => {
    const settings = createAgentSettings()
    const workspace = createAgentWorkspace({
      chatSessionId: "chat-cleanup",
      projectPath: testProjectPath,
      settings
    })
    const started = await workspace.executionEnv.backgroundProcesses.start(
      `${process.execPath} -e "setInterval(() => {}, 1000)"`
    )

    if (!started.ok) {
      throw new Error(started.error.message)
    }

    expect(workspace.lsp).not.toBeNull()
    expect(
      workspace.executionEnv.backgroundProcesses.get(started.value.id)
    ).toMatchObject({
      status: "running"
    })

    await cleanupAgentWorkspaceResources()

    expect(
      workspace.executionEnv.backgroundProcesses.get(started.value.id)
    ).toMatchObject({
      status: "stopped"
    })

    const nextWorkspace = createAgentWorkspace({
      chatSessionId: "chat-cleanup",
      projectPath: testProjectPath,
      settings
    })

    expect(nextWorkspace.lsp).not.toBe(workspace.lsp)

    await cleanupAgentWorkspaceResources()
  })

  it("reuses the LSP manager for the same chat workspace", () => {
    const settings = createAgentSettings()
    const firstWorkspace = createAgentWorkspace({
      chatSessionId: "chat-a",
      projectPath: testProjectPath,
      settings
    })
    const secondWorkspace = createAgentWorkspace({
      chatSessionId: "chat-a",
      projectPath: testProjectPath,
      settings
    })
    const otherChatWorkspace = createAgentWorkspace({
      chatSessionId: "chat-b",
      projectPath: testProjectPath,
      settings
    })

    expect(firstWorkspace.lsp).toBe(secondWorkspace.lsp)
    expect(firstWorkspace.lsp).not.toBeNull()
    expect(firstWorkspace.lsp).not.toBe(otherChatWorkspace.lsp)
  })

  it("keeps LSP disabled workspaces cheap", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true,
        lsp: {
          enabled: false
        },
        sandbox: {
          enabled: true
        }
      }
    }).agents
    const workspace = createAgentWorkspace({
      chatSessionId: "chat-disabled",
      projectPath: testProjectPath,
      settings
    })

    expect(workspace.lsp).toBeNull()
  })
})
