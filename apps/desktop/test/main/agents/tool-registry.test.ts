import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  buildAgentTools,
  executeAgentTool
} from "@/main/agents/tool-registry"
import type { AppDatabase } from "@/main/db"

const testProjectPath = `/tmp/etyon-agent-tool-registry-test-${Date.now()}`

const runGit = (cwd: string, args: string[]): void => {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore"
  })
}

const writeProjectFile = (relativePath: string, content: string): void => {
  const filePath = path.join(testProjectPath, relativePath)

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

const createApprovedToolMessages = (
  toolCallId = "tool-call-1"
): ModelMessage[] =>
  [
    {
      content: [
        {
          approvalId: "approval-1",
          toolCallId,
          type: "tool-approval-request"
        }
      ],
      role: "assistant"
    },
    {
      content: [
        {
          approvalId: "approval-1",
          approved: true,
          type: "tool-approval-response"
        }
      ],
      role: "tool"
    }
  ] as ModelMessage[]

const createApprovedToolContext = (toolCallId = "tool-call-1") => ({
  messages: createApprovedToolMessages(toolCallId),
  toolCallId
})

const resolveNeedsApproval = (
  needsApproval: ReturnType<typeof buildAgentTools>[string]["needsApproval"],
  input: unknown
) =>
  typeof needsApproval === "function"
    ? needsApproval(input, {
        messages: [],
        toolCallId: "approval-check-1"
      })
    : needsApproval

describe("agent tool registry", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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
      "fileInfo",
      "findFiles",
      "gitDiff",
      "readFile",
      "searchFiles"
    ])
    expect(tools).not.toHaveProperty("applyPatch")
    expect(tools).not.toHaveProperty("runCheck")
    expect(tools).not.toHaveProperty("rtkCommand")
  })

  it("narrows profile tools with selected skill capabilities", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: testProjectPath,
      settings,
      skillCapabilities: ["write-fs"]
    })

    expect(Object.keys(tools).toSorted()).toEqual([
      "applyPatch",
      "editFile",
      "writeFile"
    ])
  })

  it("exposes memorySearch for read-only profiles when memory retrieval is enabled", () => {
    const appSettings = AppSettingsSchema.parse({
      agents: {
        enabled: true
      }
    })
    const tools = buildAgentTools({
      db: {} as AppDatabase,
      memorySettings: appSettings.memory,
      projectPath: testProjectPath,
      settings: appSettings.agents
    })

    expect(Object.keys(tools).toSorted()).toEqual([
      "fileInfo",
      "findFiles",
      "gitDiff",
      "memorySearch",
      "readFile",
      "searchFiles"
    ])
  })

  it("hides memorySearch when memory retrieval is disabled", () => {
    const appSettings = AppSettingsSchema.parse({
      agents: {
        enabled: true
      },
      memory: {
        autoRetrieve: false
      }
    })
    const tools = buildAgentTools({
      db: {} as AppDatabase,
      memorySettings: appSettings.memory,
      projectPath: testProjectPath,
      settings: appSettings.agents
    })

    expect(tools).not.toHaveProperty("memorySearch")
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
      "editFile",
      "fileInfo",
      "findFiles",
      "gitDiff",
      "listDirectory",
      "readFile",
      "runCheck",
      "searchFiles",
      "webSearch",
      "writeFile"
    ])
    expect(
      resolveNeedsApproval(tools.applyPatch?.needsApproval, {
        patch: "diff --git a/src/value.ts b/src/value.ts\n"
      })
    ).toBe(true)
    expect(
      resolveNeedsApproval(tools.editFile?.needsApproval, {
        edits: [
          {
            newText: "new",
            oldText: "old"
          }
        ],
        path: "src/value.ts"
      })
    ).toBe(true)
    expect(typeof tools.runCheck?.needsApproval).toBe("function")
    expect(typeof tools.webSearch?.needsApproval).toBe("function")
    expect(
      resolveNeedsApproval(tools.writeFile?.needsApproval, {
        content: "export {}\n",
        path: "src/value.ts"
      })
    ).toBe(true)
  })

  it("fails closed when a permission predicate throws", () => {
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
    const throwingInput = new Proxy(
      {},
      {
        get: () => {
          throw new Error("permission input failed")
        },
        has: () => true
      }
    )

    expect(
      typeof tools.runCheck?.needsApproval === "function"
        ? tools.runCheck.needsApproval(throwingInput, {
            messages: [],
            toolCallId: "approval-check-1"
          })
        : tools.runCheck?.needsApproval
    ).toBe(true)
  })

  it("requires write approval even when the legacy write setting is disabled", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true,
        requireApprovalForWrites: false
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: testProjectPath,
      settings
    })

    expect(
      resolveNeedsApproval(tools.applyPatch?.needsApproval, {
        patch: "diff --git a/src/value.ts b/src/value.ts\n"
      })
    ).toBe(true)
    expect(
      resolveNeedsApproval(tools.editFile?.needsApproval, {
        edits: [
          {
            newText: "new",
            oldText: "old"
          }
        ],
        path: "src/value.ts"
      })
    ).toBe(true)
    expect(
      resolveNeedsApproval(tools.writeFile?.needsApproval, {
        content: "export {}\n",
        path: "src/value.ts"
      })
    ).toBe(true)
  })

  it("exposes delegated agent tools only when delegation is enabled", async () => {
    const executeDelegation = vi.fn(() =>
      Promise.resolve({
        profileId: "explore",
        runId: "child-run-1",
        status: "succeeded" as const,
        subRunId: "child-run-1",
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
      "agentPlan",
      "agentReview",
      "applyPatch",
      "editFile",
      "fileInfo",
      "findFiles",
      "gitDiff",
      "listDirectory",
      "readFile",
      "runCheck",
      "searchFiles",
      "webSearch",
      "writeFile"
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
      subRunId: "child-run-1",
      summary: "Found the relevant files.",
      truncated: false
    })
    expect(executeDelegation).toHaveBeenCalledWith({
      abortSignal: undefined,
      includeApprovalTools: false,
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

  it("exposes plan delegation for coder planning step", async () => {
    const executeDelegation = vi.fn(() =>
      Promise.resolve({
        profileId: "plan",
        runId: "plan-run-1",
        status: "succeeded" as const,
        subRunId: "plan-run-1",
        summary: "1. Update tests\n2. Implement the change",
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

    expect(tools).toHaveProperty("agentPlan")

    const result = await tools.agentPlan?.execute?.(
      {
        context: "User asked for a safe implementation plan.",
        expectedOutput: "A numbered plan with files and risks.",
        task: "Plan the implementation."
      },
      {
        messages: [],
        toolCallId: "plan-call-1"
      }
    )

    expect(result).toMatchObject({
      profileId: "plan",
      subRunId: "plan-run-1"
    })
    expect(executeDelegation).toHaveBeenCalledWith({
      abortSignal: undefined,
      includeApprovalTools: false,
      input: {
        context: "User asked for a safe implementation plan.",
        expectedOutput: "A numbered plan with files and risks.",
        task: "Plan the implementation."
      },
      messages: [],
      parentToolCallId: "plan-call-1",
      profileId: "plan"
    })
  })

  it("exposes approval-gated coder delegation for plan execute handoff", async () => {
    const executeDelegation = vi.fn(() =>
      Promise.resolve({
        profileId: "coder",
        runId: "coder-run-1",
        status: "succeeded" as const,
        subRunId: "coder-run-1",
        summary: "Implemented the confirmed plan.",
        truncated: false
      })
    )
    const settings = AppSettingsSchema.parse({
      agents: {
        allowSubagentDelegation: true,
        defaultProfileId: "plan",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      executeDelegation,
      projectPath: testProjectPath,
      settings
    })
    const input = {
      context: "Plan:\n1. Update tests\n2. Implement the change",
      expectedOutput: "A patch and validation summary.",
      task: "Execute the confirmed plan."
    }

    expect(tools).toHaveProperty("agentCoder")
    expect(resolveNeedsApproval(tools.agentCoder?.needsApproval, input)).toBe(
      true
    )
    await expect(
      tools.agentCoder?.execute?.(input, {
        messages: [],
        toolCallId: "coder-call-1"
      })
    ).rejects.toThrow("agentCoder requires approval before execution.")
    expect(executeDelegation).not.toHaveBeenCalled()

    const result = await tools.agentCoder?.execute?.(input, {
      messages: createApprovedToolMessages("coder-call-1"),
      toolCallId: "coder-call-1"
    })

    expect(result).toMatchObject({
      profileId: "coder",
      subRunId: "coder-run-1"
    })
    expect(executeDelegation).toHaveBeenCalledWith({
      abortSignal: undefined,
      includeApprovalTools: true,
      input,
      messages: createApprovedToolMessages("coder-call-1"),
      parentToolCallId: "coder-call-1",
      profileId: "coder"
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
      "fileInfo",
      "findFiles",
      "gitDiff",
      "listDirectory",
      "readFile",
      "searchFiles"
    ])
  })

  it("removes delegation tools from child agent tool scopes", () => {
    const executeDelegation = vi.fn()
    const settings = AppSettingsSchema.parse({
      agents: {
        allowSubagentDelegation: true,
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      executeDelegation,
      includeApprovalTools: false,
      projectPath: testProjectPath,
      settings
    })

    expect(Object.keys(tools).toSorted()).toEqual([
      "fileInfo",
      "findFiles",
      "gitDiff",
      "listDirectory",
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

  it("executes readFile with an inclusive line range and total line count", async () => {
    writeProjectFile(
      "src/ranged.ts",
      [
        "export const first = 1",
        "export const second = 2",
        "export const third = 3",
        "export const fourth = 4",
        ""
      ].join("\n")
    )

    const result = await executeAgentTool({
      input: {
        endLine: 3,
        path: "src/ranged.ts",
        startLine: 2
      },
      name: "readFile",
      projectPath: testProjectPath
    })

    expect(result).toMatchObject({
      content: ["export const second = 2", "export const third = 3"].join("\n"),
      endLine: 3,
      lineCount: 4,
      path: "src/ranged.ts",
      startLine: 2,
      truncated: false
    })
  })

  it("executes findFiles with a path query and cwd filter", async () => {
    writeProjectFile("src/components/settings-panel.tsx", "export {}\n")
    writeProjectFile("test/settings-panel.test.ts", "export {}\n")
    writeProjectFile("src/components/profile-card.tsx", "export {}\n")

    const result = await executeAgentTool({
      input: {
        cwd: "src",
        limit: 10,
        query: "settings"
      },
      name: "findFiles",
      projectPath: testProjectPath
    })

    if (!("files" in result)) {
      throw new Error("Expected findFiles output.")
    }

    expect(result).toMatchObject({
      cwd: "src",
      query: "settings",
      truncated: false
    })
    expect(result.files.map((file) => file.relativePath)).toEqual([
      "src/components/settings-panel.tsx"
    ])
  })

  it("executes listDirectory without exposing secret-like entries", async () => {
    writeProjectFile("src/list-target/visible.ts", "export {}\n")
    writeProjectFile("src/list-target/.env.local", "SECRET=value\n")
    fs.mkdirSync(path.join(testProjectPath, "src/list-target/nested"), {
      recursive: true
    })

    const result = await executeAgentTool({
      input: {
        limit: 10,
        path: "src/list-target"
      },
      name: "listDirectory",
      projectPath: testProjectPath
    })

    if (!("entries" in result)) {
      throw new Error("Expected listDirectory output.")
    }

    expect(result).toMatchObject({
      path: "src/list-target",
      truncated: false
    })
    expect(result.entries).toEqual([
      {
        kind: "folder",
        name: "nested",
        relativePath: "src/list-target/nested"
      },
      {
        kind: "file",
        name: "visible.ts",
        relativePath: "src/list-target/visible.ts",
        size: 10
      }
    ])
  })

  it("denies listDirectory for symlinked directories instead of following the target", async () => {
    fs.mkdirSync(path.join(testProjectPath, "src/list-real-target"), {
      recursive: true
    })
    fs.symlinkSync(
      path.join(testProjectPath, "src/list-real-target"),
      path.join(testProjectPath, "src/list-symlink-target")
    )

    await expect(
      executeAgentTool({
        input: {
          path: "src/list-symlink-target"
        },
        name: "listDirectory",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("not a directory")
  })

  it("executes fileInfo for a regular project file", async () => {
    writeProjectFile("src/info-target.ts", "export const info = true\n")

    const result = await executeAgentTool({
      input: {
        path: "src/info-target.ts"
      },
      name: "fileInfo",
      projectPath: testProjectPath
    })

    expect(result).toMatchObject({
      isSymlink: false,
      kind: "file",
      language: "typescript",
      path: "src/info-target.ts",
      size: 25
    })

    if (!("mtimeMs" in result)) {
      throw new Error("Expected fileInfo output.")
    }

    expect(result.mtimeMs).toBeGreaterThan(0)
  })

  it("executes fileInfo for symlinks without following the target", async () => {
    const outsideFilePath = `${testProjectPath}-outside-file-info.ts`

    fs.writeFileSync(outsideFilePath, "export const outside = true\n")
    fs.symlinkSync(
      outsideFilePath,
      path.join(testProjectPath, "src/file-info-link.ts")
    )

    const result = await executeAgentTool({
      input: {
        path: "src/file-info-link.ts"
      },
      name: "fileInfo",
      projectPath: testProjectPath
    })

    expect(result).toMatchObject({
      isSymlink: true,
      kind: "symlink",
      language: "typescript",
      path: "src/file-info-link.ts"
    })
    expect(result).not.toHaveProperty("realPath")
    fs.rmSync(outsideFilePath, { force: true })
  })

  it("denies readFile for secret-like project files", async () => {
    writeProjectFile(".env.local", "OPENAI_API_KEY=secret\n")

    await expect(
      executeAgentTool({
        input: {
          path: ".env.local"
        },
        name: "readFile",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("secret or credential")
  })

  it("denies readFile for project symlinks that resolve outside the workspace", async () => {
    const outsideFilePath = `${testProjectPath}-outside-read.ts`

    fs.writeFileSync(outsideFilePath, "export const outside = true\n")
    writeProjectFile("src/.keep", "")
    fs.symlinkSync(
      outsideFilePath,
      path.join(testProjectPath, "src/outside-link.ts")
    )

    await expect(
      executeAgentTool({
        input: {
          path: "src/outside-link.ts"
        },
        name: "readFile",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("outside the active workspace")

    fs.rmSync(outsideFilePath, { force: true })
  })

  it("denies readFile for project symlinks that resolve to secret-like paths", async () => {
    writeProjectFile(".env.local", "OPENAI_API_KEY=secret\n")
    fs.symlinkSync(
      path.join(testProjectPath, ".env.local"),
      path.join(testProjectPath, "src/safe-looking-link.txt")
    )

    await expect(
      executeAgentTool({
        input: {
          path: "src/safe-looking-link.txt"
        },
        name: "readFile",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("secret or credential")
  })

  it("denies readFile when the target path is a symlink", async () => {
    writeProjectFile("src/read-real-target.ts", "export const value = 1\n")
    fs.symlinkSync(
      path.join(testProjectPath, "src/read-real-target.ts"),
      path.join(testProjectPath, "src/read-symlink-target.ts")
    )

    await expect(
      executeAgentTool({
        input: {
          path: "src/read-symlink-target.ts"
        },
        name: "readFile",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("not a file")
  })

  it("denies applyPatch for secret-like project files", async () => {
    writeProjectFile(".env.local", "OPENAI_API_KEY=old\n")

    await expect(
      executeAgentTool({
        approvalContext: createApprovedToolContext(),
        input: {
          patch: [
            "diff --git a/.env.local b/.env.local",
            "--- a/.env.local",
            "+++ b/.env.local",
            "@@ -1 +1 @@",
            "-OPENAI_API_KEY=old",
            "+OPENAI_API_KEY=new",
            ""
          ].join("\n")
        },
        name: "applyPatch",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("secret or credential")
    expect(
      fs.readFileSync(path.join(testProjectPath, ".env.local"), "utf-8")
    ).toBe("OPENAI_API_KEY=old\n")
  })

  it("rejects direct execution of approval-required tools without approval evidence", async () => {
    await expect(
      executeAgentTool({
        input: {
          content: "export const bypassed = true\n",
          path: "src/direct-bypass.ts"
        },
        name: "writeFile",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("requires approval")

    expect(
      fs.existsSync(path.join(testProjectPath, "src/direct-bypass.ts"))
    ).toBe(false)
  })

  it("executes editFile with exact replacements and a diff summary", async () => {
    writeProjectFile(
      "src/edit-target.ts",
      ["export const value = 1", "export const label = 'old'", ""].join("\n")
    )

    const result = await executeAgentTool({
      approvalContext: createApprovedToolContext(),
      input: {
        edits: [
          {
            newText: "export const value = 2",
            oldText: "export const value = 1"
          },
          {
            newText: "export const label = 'new'",
            oldText: "export const label = 'old'"
          }
        ],
        path: "src/edit-target.ts"
      },
      name: "editFile",
      projectPath: testProjectPath
    })

    expect(
      fs.readFileSync(path.join(testProjectPath, "src/edit-target.ts"), "utf-8")
    ).toBe(
      ["export const value = 2", "export const label = 'new'", ""].join("\n")
    )
    expect(result).toMatchObject({
      applied: true,
      path: "src/edit-target.ts",
      replacements: 2
    })

    if (!("diff" in result)) {
      throw new Error("Expected editFile output.")
    }

    expect(result.diff).toContain("-export const value = 1")
    expect(result.diff).toContain("+export const value = 2")
  })

  it("executes writeFile by creating parent directories and writing content", async () => {
    const result = await executeAgentTool({
      approvalContext: createApprovedToolContext(),
      input: {
        content: "export const generated = true\n",
        path: "src/generated/new-file.ts"
      },
      name: "writeFile",
      projectPath: testProjectPath
    })

    expect(
      fs.readFileSync(
        path.join(testProjectPath, "src/generated/new-file.ts"),
        "utf-8"
      )
    ).toBe("export const generated = true\n")
    expect(result).toEqual({
      bytesWritten: 30,
      path: "src/generated/new-file.ts",
      written: true
    })
  })

  it("rejects writeFile through symlink parents before creating outside directories", async () => {
    const outsidePath = `${testProjectPath}-outside-write`

    fs.mkdirSync(outsidePath, { recursive: true })
    fs.symlinkSync(
      outsidePath,
      path.join(testProjectPath, "src/write-outside-link")
    )

    await expect(
      executeAgentTool({
        approvalContext: createApprovedToolContext(),
        input: {
          content: "export const leaked = true\n",
          path: "src/write-outside-link/nested/generated.ts"
        },
        name: "writeFile",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("outside the active workspace")

    expect(fs.existsSync(path.join(outsidePath, "nested"))).toBe(false)
    fs.rmSync(outsidePath, { force: true, recursive: true })
  })

  it("rejects writeFile when the target path is a symlink", async () => {
    writeProjectFile("src/write-real-target.ts", "export const value = 1\n")
    fs.symlinkSync(
      path.join(testProjectPath, "src/write-real-target.ts"),
      path.join(testProjectPath, "src/write-symlink-target.ts")
    )

    await expect(
      executeAgentTool({
        approvalContext: createApprovedToolContext(),
        input: {
          content: "export const value = 2\n",
          path: "src/write-symlink-target.ts"
        },
        name: "writeFile",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("not a file")
    expect(
      fs.readFileSync(
        path.join(testProjectPath, "src/write-real-target.ts"),
        "utf-8"
      )
    ).toBe("export const value = 1\n")
  })

  it("denies editFile for project symlinks that resolve outside the workspace", async () => {
    const outsideFilePath = `${testProjectPath}-outside-edit.ts`

    fs.writeFileSync(outsideFilePath, "export const outside = 1\n")
    fs.symlinkSync(
      outsideFilePath,
      path.join(testProjectPath, "src/edit-outside-link.ts")
    )

    await expect(
      executeAgentTool({
        approvalContext: createApprovedToolContext(),
        input: {
          edits: [
            {
              newText: "export const outside = 2",
              oldText: "export const outside = 1"
            }
          ],
          path: "src/edit-outside-link.ts"
        },
        name: "editFile",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("outside the active workspace")

    expect(fs.readFileSync(outsideFilePath, "utf-8")).toBe(
      "export const outside = 1\n"
    )
    fs.rmSync(outsideFilePath, { force: true })
  })

  it("denies editFile when the target path is a symlink", async () => {
    writeProjectFile("src/edit-real-target.ts", "export const value = 1\n")
    fs.symlinkSync(
      path.join(testProjectPath, "src/edit-real-target.ts"),
      path.join(testProjectPath, "src/edit-symlink-target.ts")
    )

    await expect(
      executeAgentTool({
        approvalContext: createApprovedToolContext(),
        input: {
          edits: [
            {
              newText: "export const value = 2",
              oldText: "export const value = 1"
            }
          ],
          path: "src/edit-symlink-target.ts"
        },
        name: "editFile",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("not a file")
    expect(
      fs.readFileSync(
        path.join(testProjectPath, "src/edit-real-target.ts"),
        "utf-8"
      )
    ).toBe("export const value = 1\n")
  })

  it("truncates large editFile diff summaries", async () => {
    const oldText = `export const large = "${"a".repeat(20_000)}"`
    const newText = `export const large = "${"b".repeat(20_000)}"`

    writeProjectFile("src/large-edit.ts", `${oldText}\n`)

    const result = await executeAgentTool({
      approvalContext: createApprovedToolContext(),
      input: {
        edits: [
          {
            newText,
            oldText
          }
        ],
        path: "src/large-edit.ts"
      },
      name: "editFile",
      projectPath: testProjectPath
    })

    expect(result).toMatchObject({
      truncated: true
    })

    if (!("diff" in result)) {
      throw new Error("Expected editFile output.")
    }

    expect(result.diff).toHaveLength(AGENT_TOOL_OUTPUT_MAX_CHARS)
  })

  it("searches file contents with ripgrep and maxResults", async () => {
    writeProjectFile("src/search-one.ts", "export const needle = true\n")
    writeProjectFile("src/search-two.ts", "export const needle = false\n")
    writeProjectFile("src/search-miss.ts", "export const value = false\n")

    const result = await executeAgentTool({
      input: {
        maxResults: 1,
        query: "needle"
      },
      name: "searchFiles",
      projectPath: testProjectPath
    })

    if (!("matches" in result)) {
      throw new Error("Expected searchFiles output.")
    }

    expect(result.matches).toEqual([
      {
        column: 14,
        lineNumber: 1,
        path: "src/search-one.ts",
        preview: "export const needle = true"
      }
    ])
    expect(result.truncated).toBe(true)
  })

  it("executes webSearch with bounded network results", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            AbstractText: "Etyon is a local desktop agent workbench.",
            AbstractURL: "https://example.com/etyon",
            Heading: "Etyon",
            RelatedTopics: [
              {
                FirstURL: "https://example.com/agents",
                Text: "Agents - Managed agent runtime"
              },
              {
                FirstURL: "https://example.com/tools",
                Text: "Tools - Tool registry"
              }
            ]
          }),
        ok: true,
        status: 200
      })
    )

    vi.stubGlobal("fetch", fetchMock)

    const result = await executeAgentTool({
      approvalContext: createApprovedToolContext(),
      input: {
        maxResults: 2,
        query: "Etyon agents"
      },
      name: "webSearch",
      projectPath: testProjectPath
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.duckduckgo.com/?q=Etyon+agents&format=json&no_redirect=1&no_html=1",
      expect.objectContaining({
        headers: {
          accept: "application/json",
          "user-agent": "Etyon Agent Web Search"
        }
      })
    )
    expect(result).toEqual({
      query: "Etyon agents",
      results: [
        {
          snippet: "Etyon is a local desktop agent workbench.",
          title: "Etyon",
          url: "https://example.com/etyon"
        },
        {
          snippet: "Agents - Managed agent runtime",
          title: "Agents",
          url: "https://example.com/agents"
        }
      ],
      truncated: true
    })
  })

  it("omits secret-like project paths from searchFiles results", async () => {
    writeProjectFile("secrets/token.txt", "AGENT_VISIBLE_TOKEN=secret\n")
    writeProjectFile(
      "src/public-token.ts",
      "export const AGENT_VISIBLE_TOKEN = 'public'\n"
    )

    const result = await executeAgentTool({
      input: {
        maxResults: 10,
        query: "AGENT_VISIBLE_TOKEN"
      },
      name: "searchFiles",
      projectPath: testProjectPath
    })

    if (!("matches" in result)) {
      throw new Error("Expected searchFiles output.")
    }

    expect(result.matches.map((match) => match.path)).toEqual([
      "src/public-token.ts"
    ])
  })

  it("executes gitDiff for requested paths only", async () => {
    const projectPath = `${testProjectPath}-git-diff-paths`

    fs.mkdirSync(path.join(projectPath, "src"), { recursive: true })

    try {
      runGit(projectPath, ["init"])
      runGit(projectPath, ["config", "user.email", "test@example.com"])
      runGit(projectPath, ["config", "user.name", "Etyon Test"])
      fs.writeFileSync(path.join(projectPath, "src/one.ts"), "one\n")
      fs.writeFileSync(path.join(projectPath, "src/two.ts"), "two\n")
      runGit(projectPath, ["add", "."])
      runGit(projectPath, ["commit", "-m", "initial"])
      fs.writeFileSync(path.join(projectPath, "src/one.ts"), "one changed\n")
      fs.writeFileSync(path.join(projectPath, "src/two.ts"), "two changed\n")

      const result = await executeAgentTool({
        input: {
          paths: ["src/one.ts"]
        },
        name: "gitDiff",
        projectPath
      })

      if (!("patch" in result)) {
        throw new Error("Expected gitDiff output.")
      }

      expect(result.hasPatch).toBe(true)
      expect(result.patch).toContain("src/one.ts")
      expect(result.patch).not.toContain("src/two.ts")
    } finally {
      fs.rmSync(projectPath, {
        force: true,
        recursive: true
      })
    }
  })

  it("denies gitDiff for explicit secret-like paths", async () => {
    const projectPath = `${testProjectPath}-git-diff-secret`

    fs.mkdirSync(path.join(projectPath, "secrets"), { recursive: true })

    try {
      runGit(projectPath, ["init"])
      runGit(projectPath, ["config", "user.email", "test@example.com"])
      runGit(projectPath, ["config", "user.name", "Etyon Test"])
      fs.writeFileSync(path.join(projectPath, "secrets/token.txt"), "old\n")
      runGit(projectPath, ["add", "."])
      runGit(projectPath, ["commit", "-m", "initial"])
      fs.writeFileSync(path.join(projectPath, "secrets/token.txt"), "new\n")

      await expect(
        executeAgentTool({
          input: {
            paths: ["secrets/token.txt"]
          },
          name: "gitDiff",
          projectPath
        })
      ).rejects.toThrow("secret or credential")
    } finally {
      fs.rmSync(projectPath, {
        force: true,
        recursive: true
      })
    }
  })
})
