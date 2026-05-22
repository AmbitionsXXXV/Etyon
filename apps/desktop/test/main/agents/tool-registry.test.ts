import fs from "node:fs"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  buildAgentTools,
  executeAgentTool
} from "@/main/agents/tool-registry"
import type { AppDatabase } from "@/main/db"

const testProjectPath = `/tmp/etyon-agent-tool-registry-test-${Date.now()}`

const writeProjectFile = (relativePath: string, content: string): void => {
  const filePath = path.join(testProjectPath, relativePath)

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

describe("agent tool registry", () => {
  afterAll(() => {
    fs.rmSync(testProjectPath, { force: true, recursive: true })
  })

  it("does not expose tools while managed agents are disabled", () => {
    const settings = AppSettingsSchema.parse({}).agents
    const tools = buildAgentTools({
      projectPath: testProjectPath,
      settings
    })

    expect(Object.keys(tools)).toEqual([])
  })

  it("exposes only read-only tools for the default profile", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: testProjectPath,
      settings
    })

    expect(Object.keys(tools).toSorted()).toEqual([
      "gitDiff",
      "readFile",
      "searchFiles"
    ])
    expect(tools).not.toHaveProperty("applyPatch")
    expect(tools).not.toHaveProperty("runCheck")
    expect(tools).not.toHaveProperty("rtkCommand")
  })

  it("exposes permissioned write and check tools for the coder profile", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: testProjectPath,
      settings
    })

    expect(Object.keys(tools).toSorted()).toEqual([
      "applyPatch",
      "gitDiff",
      "readFile",
      "runCheck",
      "searchFiles"
    ])
    expect(tools.applyPatch?.needsApproval).toBe(true)
    expect(typeof tools.runCheck?.needsApproval).toBe("function")
  })

  it("exposes delegated agent tools only when delegation is enabled", async () => {
    const executeDelegation = vi.fn(() =>
      Promise.resolve({
        profileId: "explore",
        runId: "child-run-1",
        status: "succeeded" as const,
        summary: "Found the relevant files.",
        truncated: false
      })
    )
    const settings = AppSettingsSchema.parse({
      agents: {
        allowSubagentDelegation: true,
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      executeDelegation,
      projectPath: testProjectPath,
      settings
    })

    expect(Object.keys(tools).toSorted()).toEqual([
      "agentExplore",
      "agentReview",
      "applyPatch",
      "gitDiff",
      "readFile",
      "runCheck",
      "searchFiles"
    ])

    const result = await tools.agentExplore?.execute?.(
      {
        task: "Find settings code."
      },
      {
        messages: [],
        toolCallId: "delegate-call-1"
      }
    )

    expect(result).toEqual({
      profileId: "explore",
      runId: "child-run-1",
      status: "succeeded",
      summary: "Found the relevant files.",
      truncated: false
    })
    expect(executeDelegation).toHaveBeenCalledWith({
      abortSignal: undefined,
      input: {
        context: "",
        expectedOutput: "",
        task: "Find settings code."
      },
      messages: [],
      parentToolCallId: "delegate-call-1",
      profileId: "explore"
    })
  })

  it("removes approval tools from child agent tool scopes", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "review",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      includeApprovalTools: false,
      projectPath: testProjectPath,
      settings
    })

    expect(Object.keys(tools).toSorted()).toEqual([
      "gitDiff",
      "readFile",
      "searchFiles"
    ])
  })

  it("exposes harness inspection tools for the operator profile", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "harness-operator",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      db: {} as AppDatabase,
      projectPath: testProjectPath,
      settings
    })

    expect(Object.keys(tools).toSorted()).toEqual([
      "agentEventsSearch",
      "agentRunInspect",
      "gitDiff"
    ])
  })

  it("executes readFile with a bounded preview", async () => {
    const largeContent = "x".repeat(AGENT_TOOL_OUTPUT_MAX_CHARS + 64)

    writeProjectFile("src/large.ts", largeContent)

    const result = await executeAgentTool({
      input: {
        path: "src/large.ts"
      },
      name: "readFile",
      projectPath: testProjectPath
    })

    expect(result).toMatchObject({
      language: "typescript",
      path: "src/large.ts",
      truncated: true
    })

    if (!("content" in result)) {
      throw new Error("Expected readFile output.")
    }

    expect(result.content).toHaveLength(AGENT_TOOL_OUTPUT_MAX_CHARS)
  })

  it("searches project snapshot paths with limits", async () => {
    writeProjectFile("src/app.ts", "export const app = true\n")
    writeProjectFile("src/server.ts", "export const server = true\n")

    const result = await executeAgentTool({
      input: {
        limit: 1,
        query: "src/"
      },
      name: "searchFiles",
      projectPath: testProjectPath
    })

    if (!("files" in result)) {
      throw new Error("Expected searchFiles output.")
    }

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.relativePath).toContain("src/")
  })
})
