import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test"
import * as z from "zod"

import { createAgentExtensionRunner } from "@/main/agents/agent-extensions"
import type {
  AgentWorkspace,
  AgentWorkspaceEvent
} from "@/main/agents/agent-workspace"
import {
  CODE_AGENT_LSP_TOOL_ALIASES,
  CODE_AGENT_TOOL_ALIASES,
  ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES
} from "@/main/agents/code-agent-tool-aliases"
import {
  createAgentBackgroundProcessStore,
  createAgentExecutionEnv
} from "@/main/agents/execution-env"
import type { AgentBackgroundProcessStore } from "@/main/agents/execution-env"
import type { AgentLspManager } from "@/main/agents/lsp-manager"
import {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  buildAgentTools,
  executeAgentTool
} from "@/main/agents/tool-registry"
import type { WorkspaceSandbox } from "@/main/agents/workspace-sandbox"
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

const createFakeSandboxedWorkspace = ({
  backgroundProcessStore,
  events
}: {
  backgroundProcessStore?: AgentBackgroundProcessStore
  events: AgentWorkspaceEvent[]
}): AgentWorkspace => {
  const sandbox: WorkspaceSandbox = {
    cleanup: () => Promise.resolve(),
    enabled: true,
    prepareShellCommand: (input) =>
      Promise.resolve({
        ok: true,
        value: {
          args: ["-fc", input.command],
          cleanup: () => Promise.resolve(),
          command: "/bin/zsh",
          cwd: input.cwd,
          env: input.env,
          sandboxed: true
        }
      })
  }
  const executionEnv = createAgentExecutionEnv({
    ...(backgroundProcessStore ? { backgroundProcessStore } : {}),
    projectPath: testProjectPath,
    sandbox
  })

  return {
    eventSink: (event) => {
      events.push(event)
    },
    executionEnv,
    fileSystem: executionEnv.fileSystem,
    lsp: null,
    projectPath: executionEnv.projectPath,
    sandbox
  }
}

const createFakeWorkspaceCommandOutput = ({
  commands,
  getStdout
}: {
  commands: string[]
  getStdout: (command: string) => string
}): AgentWorkspace => {
  const sandbox: WorkspaceSandbox = {
    cleanup: () => Promise.resolve(),
    enabled: true,
    prepareShellCommand: (input) => {
      commands.push(input.command)

      return Promise.resolve({
        ok: true,
        value: {
          args: [
            "-e",
            `process.stdout.write(${JSON.stringify(getStdout(input.command))})`
          ],
          cleanup: () => Promise.resolve(),
          command: process.execPath,
          cwd: input.cwd,
          env: input.env,
          sandboxed: true
        }
      })
    }
  }
  const executionEnv = createAgentExecutionEnv({
    projectPath: testProjectPath,
    sandbox
  })

  return {
    executionEnv,
    fileSystem: executionEnv.fileSystem,
    lsp: null,
    projectPath: executionEnv.projectPath,
    sandbox
  }
}

const createFakeLspManager = (): AgentLspManager => ({
  cleanup: () => Promise.resolve(),
  diagnostics: (filePath) =>
    Promise.resolve({
      diagnostics: [
        {
          column: 7,
          line: 1,
          message: "Type mismatch",
          severity: "error",
          source: "ts"
        }
      ],
      path: filePath,
      status: "success"
    }),
  hasClients: () => true,
  inspect: ({ line, path: filePath }) =>
    Promise.resolve({
      column: 1,
      definition: [],
      diagnostics: [],
      hover: null,
      implementation: [],
      line,
      path: filePath,
      references: [
        {
          column: 14,
          line: 2,
          path: "src/reference.ts"
        }
      ],
      status: "success"
    }),
  status: () => ({
    clients: [
      {
        rootPath: testProjectPath,
        status: "running"
      }
    ],
    hasClients: true
  }),
  touchFile: (filePath) =>
    Promise.resolve({
      diagnostics: [
        {
          column: 7,
          line: 1,
          message: "Type mismatch",
          severity: "error",
          source: "ts"
        }
      ],
      path: filePath,
      status: "success"
    })
})

const getCodeAgentTextContent = (
  result: Awaited<ReturnType<typeof executeAgentTool>>
): string => {
  if (!("content" in result) || !Array.isArray(result.content)) {
    throw new Error("Expected code-agent text output.")
  }

  return result.content[0]?.text ?? ""
}

const getCodeAgentDetails = (
  result: Awaited<ReturnType<typeof executeAgentTool>>
): Record<string, unknown> => {
  if (!("details" in result) || !result.details) {
    throw new Error("Expected code-agent details.")
  }

  return result.details
}

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

  it("keeps model-facing code agent aliases mapped to Etyon workspace tools", () => {
    expect(CODE_AGENT_TOOL_ALIASES).toEqual([
      "read",
      "grep",
      "find",
      "ls",
      "stat",
      "bash",
      "processOutput",
      "stopProcess",
      "mkdir",
      "delete",
      "edit",
      "smartEdit",
      "write"
    ])
    expect(CODE_AGENT_LSP_TOOL_ALIASES).toEqual(["inspect"])
    expect(ETYON_CODE_AGENT_WORKSPACE_TOOL_ALIASES).toEqual({
      bash: {
        etyonName: "execute_command",
        etyonWorkspaceTool: "etyon_workspace_execute_command"
      },
      delete: {
        etyonName: "delete_file",
        etyonWorkspaceTool: "etyon_workspace_delete_file"
      },
      edit: {
        etyonName: "string_replace_lsp",
        etyonWorkspaceTool: "etyon_workspace_edit_file"
      },
      find: {
        etyonName: "find_files",
        etyonWorkspaceTool: "etyon_workspace_list_files"
      },
      grep: {
        etyonName: "search_content",
        etyonWorkspaceTool: "etyon_workspace_grep"
      },
      inspect: {
        etyonName: "lsp_inspect",
        etyonWorkspaceTool: "etyon_workspace_lsp_inspect"
      },
      ls: {
        etyonName: "find_files",
        etyonWorkspaceTool: "etyon_workspace_list_files"
      },
      mkdir: {
        etyonName: "mkdir",
        etyonWorkspaceTool: "etyon_workspace_mkdir"
      },
      processOutput: {
        etyonName: "process_output",
        etyonWorkspaceTool: "etyon_workspace_process_output"
      },
      read: {
        etyonName: "view",
        etyonWorkspaceTool: "etyon_workspace_read_file"
      },
      smartEdit: {
        etyonName: "ast_smart_edit",
        etyonWorkspaceTool: "etyon_workspace_ast_smart_edit"
      },
      stat: {
        etyonName: "file_stat",
        etyonWorkspaceTool: "etyon_workspace_file_stat"
      },
      stopProcess: {
        etyonName: "stop_process",
        etyonWorkspaceTool: "etyon_workspace_stop_process"
      },
      write: {
        etyonName: "write_file",
        etyonWorkspaceTool: "etyon_workspace_write_file"
      }
    })
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
      "find",
      "grep",
      "ls",
      "read",
      "stat"
    ])
    expect(tools).not.toHaveProperty("applyPatch")
    expect(tools).not.toHaveProperty("bash")
    expect(tools).not.toHaveProperty("edit")
    expect(tools).not.toHaveProperty("write")
  })

  it("exposes inspect only when both LSP and sandbox are enabled", () => {
    const lspOnlySettings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "explore",
        enabled: true,
        lsp: {
          enabled: true
        }
      }
    }).agents
    const sandboxOnlySettings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "explore",
        enabled: true,
        sandbox: {
          enabled: true
        }
      }
    }).agents
    const sandboxedLspSettings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "explore",
        enabled: true,
        lsp: {
          enabled: true
        },
        sandbox: {
          enabled: true
        }
      }
    }).agents

    expect(
      buildAgentTools({
        projectPath: testProjectPath,
        settings: lspOnlySettings
      })
    ).not.toHaveProperty("inspect")
    expect(
      buildAgentTools({
        projectPath: testProjectPath,
        settings: sandboxOnlySettings
      })
    ).not.toHaveProperty("inspect")
    expect(
      Object.keys(
        buildAgentTools({
          projectPath: testProjectPath,
          settings: sandboxedLspSettings
        })
      ).toSorted()
    ).toEqual(["find", "grep", "inspect", "ls", "read", "stat"])
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
      "delete",
      "edit",
      "mkdir",
      "smartEdit",
      "write"
    ])
  })

  it("exposes web tools only for selected network-capable skills", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true
      }
    }).agents

    expect(
      buildAgentTools({
        projectPath: testProjectPath,
        settings
      })
    ).not.toHaveProperty("webSearch")
    expect(
      buildAgentTools({
        projectPath: testProjectPath,
        settings
      })
    ).not.toHaveProperty("webExtract")
    expect(
      Object.keys(
        buildAgentTools({
          projectPath: testProjectPath,
          settings,
          skillCapabilities: ["network"]
        })
      )
    ).toEqual(["webExtract", "webSearch"])
    expect(
      buildAgentTools({
        includeApprovalTools: false,
        projectPath: testProjectPath,
        settings,
        skillCapabilities: ["network"]
      })
    ).not.toHaveProperty("webSearch")
    expect(
      buildAgentTools({
        includeApprovalTools: false,
        projectPath: testProjectPath,
        settings,
        skillCapabilities: ["network"]
      })
    ).not.toHaveProperty("webExtract")
  })

  it("exposes requestAccess only for profiles that can ask for scoped handoff approval", () => {
    const generalSettings = AppSettingsSchema.parse({
      agents: {
        enabled: true
      }
    }).agents
    const planSettings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "plan",
        enabled: true
      }
    }).agents
    const coderSettings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents

    expect(
      buildAgentTools({
        projectPath: testProjectPath,
        settings: generalSettings
      })
    ).not.toHaveProperty("requestAccess")
    expect(
      buildAgentTools({
        projectPath: testProjectPath,
        settings: planSettings
      })
    ).toHaveProperty("requestAccess")
    expect(
      buildAgentTools({
        projectPath: testProjectPath,
        settings: coderSettings
      })
    ).toHaveProperty("requestAccess")
    expect(
      buildAgentTools({
        includeApprovalTools: false,
        projectPath: testProjectPath,
        settings: planSettings
      })
    ).not.toHaveProperty("requestAccess")
  })

  it("keeps read-only profiles aligned to Etyon aliases even when memory retrieval is enabled", () => {
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
      "find",
      "grep",
      "ls",
      "read",
      "stat"
    ])
    expect(tools).not.toHaveProperty("memorySearch")
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
      "bash",
      "delete",
      "edit",
      "find",
      "grep",
      "ls",
      "mkdir",
      "processOutput",
      "read",
      "requestAccess",
      "smartEdit",
      "stat",
      "stopProcess",
      "write"
    ])
    expect(
      resolveNeedsApproval(tools.bash?.needsApproval, {
        command: "echo approved"
      })
    ).toBe(true)
    expect(
      resolveNeedsApproval(tools.bash?.needsApproval, {
        command: "rtk vp check"
      })
    ).toBe(false)
    expect(
      resolveNeedsApproval(tools.bash?.needsApproval, {
        background: true,
        command: "rtk vp check"
      })
    ).toBe(true)
    expect(
      resolveNeedsApproval(tools.edit?.needsApproval, {
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
      resolveNeedsApproval(tools.smartEdit?.needsApproval, {
        path: "src/value.ts",
        replacement: "export const value = 2",
        symbol: "value"
      })
    ).toBe(true)
    expect(
      resolveNeedsApproval(tools.mkdir?.needsApproval, {
        path: "src/generated"
      })
    ).toBe(true)
    expect(
      resolveNeedsApproval(tools.delete?.needsApproval, {
        path: "src/generated.ts"
      })
    ).toBe(true)
    expect(
      resolveNeedsApproval(tools.write?.needsApproval, {
        content: "export {}\n",
        path: "src/value.ts"
      })
    ).toBe(true)
    expect(
      resolveNeedsApproval(tools.requestAccess?.needsApproval, {
        reason: "Need approval before delegating implementation.",
        scope: "current task"
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
      typeof tools.bash?.needsApproval === "function"
        ? tools.bash.needsApproval(throwingInput, {
            messages: [],
            toolCallId: "approval-check-1"
          })
        : tools.bash?.needsApproval
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
      resolveNeedsApproval(tools.edit?.needsApproval, {
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
      resolveNeedsApproval(tools.write?.needsApproval, {
        content: "export {}\n",
        path: "src/value.ts"
      })
    ).toBe(true)
  })

  it("preapproves child coder tools after an approved handoff", async () => {
    writeProjectFile("src/preapproved-edit.ts", "export const value = 1\n")

    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      approvalMode: "preapproved",
      includeApprovalTools: true,
      projectPath: testProjectPath,
      settings
    })

    expect(tools.edit?.needsApproval).toBeUndefined()

    const result = await tools.edit?.execute?.(
      {
        edits: [
          {
            newText: "export const value = 2",
            oldText: "export const value = 1"
          }
        ],
        path: "src/preapproved-edit.ts"
      },
      {
        messages: [],
        toolCallId: "edit:18"
      }
    )

    expect(result).toMatchObject({
      content: [
        {
          text: "Successfully replaced 1 block(s) in src/preapproved-edit.ts.",
          type: "text"
        }
      ],
      details: {
        path: "src/preapproved-edit.ts",
        replacements: 1
      }
    })
    expect(
      fs.readFileSync(
        path.join(testProjectPath, "src/preapproved-edit.ts"),
        "utf-8"
      )
    ).toBe("export const value = 2\n")
  })

  it("appends LSP diagnostics after code-agent edit when LSP is active", async () => {
    writeProjectFile("src/edit-with-diagnostics.ts", "export const value = 1\n")

    const events: AgentWorkspaceEvent[] = []
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true,
        lsp: {
          enabled: true
        },
        sandbox: {
          enabled: true
        }
      }
    }).agents
    const workspace = {
      ...createFakeSandboxedWorkspace({
        events
      }),
      lsp: createFakeLspManager()
    }
    const result = await executeAgentTool({
      approvalContext: createApprovedToolContext(),
      input: {
        edits: [
          {
            newText: "export const value = 'wrong'",
            oldText: "export const value = 1"
          }
        ],
        path: "src/edit-with-diagnostics.ts"
      },
      name: "edit",
      projectPath: testProjectPath,
      settings,
      workspace
    })

    expect(getCodeAgentTextContent(result)).toContain(
      "Successfully replaced 1 block(s) in src/edit-with-diagnostics.ts."
    )
    expect(getCodeAgentTextContent(result)).toContain(
      "LSP diagnostics:\n- error 1:7 Type mismatch"
    )
    expect(getCodeAgentDetails(result)).toMatchObject({
      diagnostics: {
        diagnostics: [
          {
            column: 7,
            line: 1,
            message: "Type mismatch"
          }
        ],
        path: "src/edit-with-diagnostics.ts",
        status: "success"
      }
    })
  })

  it("executes smartEdit with an AST-bounded named declaration replacement", async () => {
    writeProjectFile(
      "src/smart-edit-target.ts",
      [
        "export const keep = 1",
        "",
        "export function makeLabel(value: string) {",
        `  return \`old \${value}\``,
        "}",
        "",
        "export const tail = true",
        ""
      ].join("\n")
    )

    const result = await executeAgentTool({
      approvalContext: createApprovedToolContext("smart-edit-call-1"),
      input: {
        kind: "function",
        path: "src/smart-edit-target.ts",
        replacement: [
          "export function makeLabel(value: string) {",
          `  return \`new \${value}\``,
          "}"
        ].join("\n"),
        symbol: "makeLabel"
      },
      name: "smartEdit",
      projectPath: testProjectPath
    })

    expect(getCodeAgentTextContent(result)).toContain(
      "Successfully smart-edited function makeLabel in src/smart-edit-target.ts."
    )
    expect(getCodeAgentDetails(result)).toMatchObject({
      kind: "function",
      path: "src/smart-edit-target.ts",
      startLine: 3,
      symbol: "makeLabel"
    })
    expect(
      fs.readFileSync(
        path.join(testProjectPath, "src/smart-edit-target.ts"),
        "utf-8"
      )
    ).toBe(
      [
        "export const keep = 1",
        "",
        "export function makeLabel(value: string) {",
        `  return \`new \${value}\``,
        "}",
        "",
        "export const tail = true",
        ""
      ].join("\n")
    )
  })

  it("rejects smartEdit when the named declaration is ambiguous", async () => {
    writeProjectFile(
      "src/smart-edit-duplicate.ts",
      [
        "export function duplicate() {",
        "  return 1",
        "}",
        "export function duplicate() {",
        "  return 2",
        "}",
        ""
      ].join("\n")
    )

    await expect(
      executeAgentTool({
        approvalContext: createApprovedToolContext("smart-edit-call-2"),
        input: {
          path: "src/smart-edit-duplicate.ts",
          replacement: "export function duplicate() { return 3 }",
          symbol: "duplicate"
        },
        name: "smartEdit",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("Expected exactly one declaration named duplicate")
  })

  it("executes requestAccess only after approval and returns the approved scope", async () => {
    const input = {
      actions: ["delegate to coder", "run targeted checks"],
      reason: "Need approval before moving from planning to implementation.",
      scope: "current task"
    }

    await expect(
      executeAgentTool({
        input,
        name: "requestAccess",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("requestAccess requires approval before execution.")

    await expect(
      executeAgentTool({
        approvalContext: createApprovedToolContext("access-call-1"),
        input,
        name: "requestAccess",
        projectPath: testProjectPath
      })
    ).resolves.toEqual({
      actions: ["delegate to coder", "run targeted checks"],
      approved: true,
      reason: "Need approval before moving from planning to implementation.",
      scope: "current task"
    })
  })

  it("returns LSP references from code-agent inspect", async () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true,
        lsp: {
          enabled: true
        },
        sandbox: {
          enabled: true
        }
      }
    }).agents
    const workspace = {
      ...createFakeSandboxedWorkspace({
        events: []
      }),
      lsp: createFakeLspManager()
    }
    const result = await executeAgentTool({
      input: {
        line: 1,
        match: "const <<<value = 1",
        path: "src/inspect-target.ts"
      },
      name: "inspect",
      projectPath: testProjectPath,
      settings,
      workspace
    })

    expect(getCodeAgentTextContent(result)).toContain(
      "references:\n- src/reference.ts:2:14"
    )
    expect(getCodeAgentDetails(result)).toMatchObject({
      references: [
        {
          column: 14,
          line: 2,
          path: "src/reference.ts"
        }
      ],
      status: "success"
    })
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
      "bash",
      "delete",
      "edit",
      "find",
      "grep",
      "ls",
      "mkdir",
      "processOutput",
      "read",
      "requestAccess",
      "smartEdit",
      "stat",
      "stopProcess",
      "write"
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

  it("emits sandbox command lifecycle events through the workspace event sink", async () => {
    const events: AgentWorkspaceEvent[] = []
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true,
        sandbox: {
          enabled: true
        }
      }
    }).agents
    const result = await executeAgentTool({
      approvalContext: createApprovedToolContext(),
      input: {
        command: "printf out"
      },
      name: "bash",
      projectPath: testProjectPath,
      settings,
      workspace: createFakeSandboxedWorkspace({
        events
      })
    })

    expect(result).toMatchObject({
      content: [
        {
          text: "out",
          type: "text"
        }
      ]
    })
    expect(events.map((event) => event.type)).toEqual([
      "sandbox_command_started",
      "sandbox_command_output",
      "sandbox_command_finished"
    ])
    expect(events[0]?.payload).toMatchObject({
      command: "printf out",
      cwd: testProjectPath,
      pid: expect.any(Number),
      sandboxed: true
    })
    expect(events[1]?.payload).toMatchObject({
      channel: "stdout",
      chunk: "out",
      sequence: 0
    })
    expect(events[2]?.payload).toMatchObject({
      command: "printf out",
      exitCode: 0,
      shellStatus: "exited",
      status: "success"
    })
  })

  it("starts, reads, and stops Etyon background process tools", async () => {
    const events: AgentWorkspaceEvent[] = []
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true,
        sandbox: {
          enabled: true
        }
      }
    }).agents
    const workspace = createFakeSandboxedWorkspace({
      events
    })
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
      "process.stdout.write('ready'); setInterval(() => {}, 1000)"
    )}`
    const startResult = await executeAgentTool({
      approvalContext: createApprovedToolContext(),
      input: {
        background: true,
        command
      },
      name: "bash",
      projectPath: testProjectPath,
      settings,
      workspace
    })
    const { processId } = getCodeAgentDetails(startResult)

    expect(getCodeAgentTextContent(startResult)).toContain(
      "Started background process"
    )
    expect(typeof processId).toBe("string")

    if (typeof processId !== "string") {
      throw new TypeError("Expected processId.")
    }

    await vi.waitFor(async () => {
      const outputResult = await executeAgentTool({
        input: {
          processId
        },
        name: "processOutput",
        projectPath: testProjectPath,
        settings,
        workspace
      })
      const process = getCodeAgentDetails(outputResult).process as
        | { stdoutPreview?: unknown }
        | undefined

      expect(process?.stdoutPreview).toBe("ready")
    })

    const stopResult = await executeAgentTool({
      input: {
        processId
      },
      name: "stopProcess",
      projectPath: testProjectPath,
      settings,
      workspace
    })

    expect(getCodeAgentTextContent(stopResult)).toContain(
      `Stopped background process ${processId}`
    )
    expect(getCodeAgentTextContent(stopResult)).toContain("status: stopped")
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "background_process_started",
        "background_process_output",
        "background_process_finished"
      ])
    )
    expect(
      events.find((event) => event.type === "background_process_started")
        ?.payload
    ).toMatchObject({
      command,
      cwd: testProjectPath,
      processId,
      sandboxed: true
    })
    expect(
      events.find((event) => event.type === "background_process_output")
        ?.payload
    ).toMatchObject({
      channel: "stdout",
      chunk: "ready",
      processId
    })
    expect(
      events.find((event) => event.type === "background_process_finished")
        ?.payload
    ).toMatchObject({
      command,
      exitCode: null,
      processId,
      sandboxed: true,
      status: "stopped"
    })
  })

  it("annotates truncated background process output for model-visible reads", async () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true,
        sandbox: {
          enabled: true
        }
      }
    }).agents
    const workspace = createFakeSandboxedWorkspace({
      events: []
    })
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
      `process.stdout.write('x'.repeat(${AGENT_TOOL_OUTPUT_MAX_CHARS + 5})); setInterval(() => {}, 1000)`
    )}`
    const startResult = await executeAgentTool({
      approvalContext: createApprovedToolContext(),
      input: {
        background: true,
        command
      },
      name: "bash",
      projectPath: testProjectPath,
      settings,
      workspace
    })
    const { processId } = getCodeAgentDetails(startResult)

    if (typeof processId !== "string") {
      throw new TypeError("Expected processId.")
    }

    try {
      await vi.waitFor(async () => {
        const outputResult = await executeAgentTool({
          input: {
            processId
          },
          name: "processOutput",
          projectPath: testProjectPath,
          settings,
          workspace
        })

        expect(getCodeAgentTextContent(outputResult)).toContain(
          `[stdout truncated: omitted 5 of ${
            AGENT_TOOL_OUTPUT_MAX_CHARS + 5
          } chars]`
        )
      })
    } finally {
      await executeAgentTool({
        input: {
          processId
        },
        name: "stopProcess",
        projectPath: testProjectPath,
        settings,
        workspace
      })
    }
  })

  it("keeps Etyon background process registry across workspace turns", async () => {
    const backgroundProcessStore = createAgentBackgroundProcessStore()
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true,
        sandbox: {
          enabled: true
        }
      }
    }).agents
    const startWorkspace = createFakeSandboxedWorkspace({
      backgroundProcessStore,
      events: []
    })
    const nextTurnWorkspace = createFakeSandboxedWorkspace({
      backgroundProcessStore,
      events: []
    })
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
      "process.stdout.write('next-turn-ready'); setInterval(() => {}, 1000)"
    )}`
    const startResult = await executeAgentTool({
      approvalContext: createApprovedToolContext(),
      input: {
        background: true,
        command
      },
      name: "bash",
      projectPath: testProjectPath,
      settings,
      workspace: startWorkspace
    })
    const { processId } = getCodeAgentDetails(startResult)

    if (typeof processId !== "string") {
      throw new TypeError("Expected processId.")
    }

    await vi.waitFor(async () => {
      const outputResult = await executeAgentTool({
        input: {
          processId
        },
        name: "processOutput",
        projectPath: testProjectPath,
        settings,
        workspace: nextTurnWorkspace
      })

      expect(getCodeAgentTextContent(outputResult)).toContain("next-turn-ready")
    })

    const stopResult = await executeAgentTool({
      input: {
        processId
      },
      name: "stopProcess",
      projectPath: testProjectPath,
      settings,
      workspace: nextTurnWorkspace
    })

    expect(getCodeAgentTextContent(stopResult)).toContain("status: stopped")
  })

  it("routes code-agent search commands through the provided workspace sandbox", async () => {
    writeProjectFile(
      "src/sandbox-grep.ts",
      "export const sandboxNeedle = true\n"
    )

    const commands: string[] = []
    const grepStdout = `${JSON.stringify({
      data: {
        line_number: 1,
        lines: {
          text: "export const sandboxNeedle = true\n"
        },
        path: {
          text: "src/sandbox-grep.ts"
        },
        submatches: [
          {
            start: 13
          }
        ]
      },
      type: "match"
    })}\n`
    const workspace = createFakeWorkspaceCommandOutput({
      commands,
      getStdout: (command) =>
        command.startsWith("rg ")
          ? grepStdout
          : `${path.join(testProjectPath, "src/sandbox-grep.ts")}\n`
    })
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true,
        sandbox: {
          enabled: true
        }
      }
    }).agents

    const grepResult = await executeAgentTool({
      input: {
        pattern: "sandboxNeedle"
      },
      name: "grep",
      projectPath: testProjectPath,
      settings,
      workspace
    })
    const findResult = await executeAgentTool({
      input: {
        pattern: "sandbox-grep.ts"
      },
      name: "find",
      projectPath: testProjectPath,
      settings,
      workspace
    })
    const searchResult = await executeAgentTool({
      input: {
        query: "sandboxNeedle"
      },
      name: "searchFiles",
      projectPath: testProjectPath,
      settings,
      workspace
    })

    expect(commands).toHaveLength(3)
    expect(commands[0]).toContain("rg ")
    expect(commands[1]).toContain("fd ")
    expect(commands[2]).toContain("rg ")
    expect(getCodeAgentTextContent(grepResult)).toContain(
      "src/sandbox-grep.ts:1: export const sandboxNeedle = true"
    )
    expect(getCodeAgentTextContent(findResult)).toBe("src/sandbox-grep.ts")
    expect(searchResult).toMatchObject({
      matches: [
        {
          column: 14,
          lineNumber: 1,
          path: "src/sandbox-grep.ts"
        }
      ]
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
      "find",
      "grep",
      "ls",
      "read",
      "stat"
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
      "find",
      "grep",
      "ls",
      "read",
      "stat"
    ])
  })

  it("filters extension tools through risk metadata and child approval scope", async () => {
    const extensionRunner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "tool-registry-extension",
          register: (context) => {
            context.registerTool({
              description: "Safe extension read.",
              execute: () => "safe",
              inputSchema: z.object({}),
              name: "etyonSafeTool",
              profiles: ["coder"],
              riskLevel: "safe"
            })
            context.registerTool({
              description: "Default-risk extension action.",
              execute: () => "default",
              inputSchema: z.object({}),
              name: "etyonDefaultRiskTool",
              profiles: ["coder"]
            })
            context.registerTool({
              description: "Explicit approval extension action.",
              execute: () => "approval",
              inputSchema: z.object({}),
              name: "etyonApprovalTool",
              profiles: ["coder"],
              requiresApproval: true,
              riskLevel: "safe"
            })
          }
        }
      ]
    })
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      extensionRunner,
      projectPath: testProjectPath,
      settings
    })
    const childTools = buildAgentTools({
      extensionRunner,
      includeApprovalTools: false,
      projectPath: testProjectPath,
      settings
    })

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "etyonApprovalTool",
        "etyonDefaultRiskTool",
        "etyonSafeTool"
      ])
    )
    expect(resolveNeedsApproval(tools.etyonSafeTool?.needsApproval, {})).toBe(
      undefined
    )
    expect(
      resolveNeedsApproval(tools.etyonDefaultRiskTool?.needsApproval, {})
    ).toBe(true)
    expect(
      resolveNeedsApproval(tools.etyonApprovalTool?.needsApproval, {})
    ).toBe(true)
    expect(Object.keys(childTools).toSorted()).toEqual([
      "etyonSafeTool",
      "find",
      "grep",
      "ls",
      "read",
      "stat"
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
      "agentRunInspect"
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

  it("executes stat as a code-agent metadata alias", async () => {
    writeProjectFile("src/stat-target.ts", "export const statTarget = true\n")

    const result = await executeAgentTool({
      input: {
        path: "src/stat-target.ts"
      },
      name: "stat",
      projectPath: testProjectPath
    })

    if (
      !("content" in result) ||
      !Array.isArray(result.content) ||
      !("details" in result)
    ) {
      throw new Error("Expected stat output.")
    }

    expect(result.content[0]?.text).toContain("src/stat-target.ts: file")
    expect(result.details).toMatchObject({
      isSymlink: false,
      kind: "file",
      language: "typescript",
      path: "src/stat-target.ts",
      size: 31
    })
  })

  it("executes mkdir and delete as approval-gated workspace aliases", async () => {
    const directoryPath = path.join(testProjectPath, "src/generated-dir/nested")

    const mkdirResult = await executeAgentTool({
      approvalContext: createApprovedToolContext("mkdir-call-1"),
      input: {
        path: "src/generated-dir/nested"
      },
      name: "mkdir",
      projectPath: testProjectPath
    })

    if (
      !("content" in mkdirResult) ||
      !Array.isArray(mkdirResult.content) ||
      !("details" in mkdirResult)
    ) {
      throw new Error("Expected mkdir output.")
    }

    expect(fs.existsSync(directoryPath)).toBe(true)
    expect(mkdirResult.details).toMatchObject({
      path: "src/generated-dir/nested",
      recursive: true
    })

    writeProjectFile("src/generated-dir/nested/value.ts", "export {}\n")

    const deleteResult = await executeAgentTool({
      approvalContext: createApprovedToolContext("delete-call-1"),
      input: {
        path: "src/generated-dir",
        recursive: true
      },
      name: "delete",
      projectPath: testProjectPath
    })

    if (
      !("content" in deleteResult) ||
      !Array.isArray(deleteResult.content) ||
      !("details" in deleteResult)
    ) {
      throw new Error("Expected delete output.")
    }

    expect(fs.existsSync(path.join(testProjectPath, "src/generated-dir"))).toBe(
      false
    )
    expect(deleteResult.details).toMatchObject({
      kind: "folder",
      path: "src/generated-dir",
      recursive: true
    })
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

    await expect(
      executeAgentTool({
        input: {
          path: "src/direct-created-dir"
        },
        name: "mkdir",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("requires approval")
    expect(
      fs.existsSync(path.join(testProjectPath, "src/direct-created-dir"))
    ).toBe(false)

    writeProjectFile(
      "src/direct-smart-edit.ts",
      "export function directSmartEdit() {\n  return 1\n}\n"
    )

    await expect(
      executeAgentTool({
        input: {
          path: "src/direct-smart-edit.ts",
          replacement: "export function directSmartEdit() { return 2 }",
          symbol: "directSmartEdit"
        },
        name: "smartEdit",
        projectPath: testProjectPath
      })
    ).rejects.toThrow("requires approval")
    expect(
      fs.readFileSync(
        path.join(testProjectPath, "src/direct-smart-edit.ts"),
        "utf-8"
      )
    ).toBe("export function directSmartEdit() {\n  return 1\n}\n")
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

  it("executes webExtract with bounded readable text", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type"
              ? "text/html; charset=utf-8"
              : null
        },
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(`
            <!doctype html>
            <html>
              <head>
                <title>Etyon &amp; Agents</title>
                <style>.hidden { display: none; }</style>
              </head>
              <body>
                <h1>Etyon</h1>
                <script>window.secret = true;</script>
                <p>Local agent &amp; workspace runtime.</p>
              </body>
            </html>
          `)
      })
    )

    vi.stubGlobal("fetch", fetchMock)

    const result = await executeAgentTool({
      approvalContext: createApprovedToolContext(),
      input: {
        maxChars: 24,
        url: "https://example.com/etyon"
      },
      name: "webExtract",
      projectPath: testProjectPath
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/etyon",
      expect.objectContaining({
        headers: {
          accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "user-agent": "Etyon Agent Web Extract"
        }
      })
    )
    expect(result).toEqual({
      content: "Etyon & Agents\nEtyon\nLoc",
      contentType: "text/html; charset=utf-8",
      title: "Etyon & Agents",
      truncated: true,
      url: "https://example.com/etyon"
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
