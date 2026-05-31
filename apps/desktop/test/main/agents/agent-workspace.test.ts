import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { AppSettingsSchema } from "@etyon/rpc"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from "vite-plus/test"

import {
  cleanupAgentWorkspaceResources,
  createAgentWorkspace,
  createAgentWorkspaceOperations
} from "@/main/agents/agent-workspace"
import { createAgentExecutionEnv } from "@/main/agents/execution-env"
import type { AgentLspManager } from "@/main/agents/lsp-manager"
import type { WorkspaceSandbox } from "@/main/agents/workspace-sandbox"

const testProjectPath = `/tmp/etyon-agent-workspace-test-${Date.now()}`

const runGit = (cwd: string, args: string[]): void => {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore"
  })
}

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

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it("fails closed before creating an unsandboxed LSP manager", async () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true,
        lsp: {
          enabled: true,
          requireSandbox: true
        },
        sandbox: {
          enabled: false
        }
      }
    }).agents
    const workspace = createAgentWorkspace({
      chatSessionId: "chat-lsp-requires-sandbox",
      projectPath: testProjectPath,
      settings
    })

    expect(workspace.lsp).toBeNull()
    await expect(
      workspace.operations.lspInspect({
        line: 1,
        match: "const <<<name>>> = 1",
        path: "src/example.ts"
      })
    ).resolves.toMatchObject({
      status: "unavailable"
    })
  })

  it("exposes filesystem operations through the workspace substrate", async () => {
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
      chatSessionId: "chat-operations",
      projectPath: testProjectPath,
      settings
    })

    const writeResult = await workspace.operations.writeFile(
      "src/ops/example.txt",
      "hello",
      {
        createParentDirectories: true
      }
    )

    if (!writeResult.ok) {
      throw new Error(writeResult.error.message)
    }

    expect(writeResult.value).toMatchObject({
      bytesWritten: 5,
      info: {
        kind: "file",
        path: "src/ops/example.txt",
        size: 5
      }
    })

    const viewResult = await workspace.operations.view("src/ops/example.txt")

    if (!viewResult.ok) {
      throw new Error(viewResult.error.message)
    }

    expect(viewResult.value).toMatchObject({
      content: "hello",
      info: {
        kind: "file",
        path: "src/ops/example.txt"
      }
    })

    const mkdirResult = await workspace.operations.mkdir("generated/nested", {
      recursive: true
    })

    if (!mkdirResult.ok) {
      throw new Error(mkdirResult.error.message)
    }

    expect(mkdirResult.value).toMatchObject({
      kind: "folder",
      path: "generated/nested"
    })

    const listResult = await workspace.operations.listDir("generated")

    if (!listResult.ok) {
      throw new Error(listResult.error.message)
    }

    expect(listResult.value.map((entry) => entry.path)).toContain(
      "generated/nested"
    )

    const deleteResult = await workspace.operations.deleteFile(
      "src/ops/example.txt"
    )

    if (!deleteResult.ok) {
      throw new Error(deleteResult.error.message)
    }

    expect(deleteResult.value).toMatchObject({
      kind: "file",
      path: "src/ops/example.txt",
      size: 5
    })

    const afterDeleteResult = await workspace.operations.fileStat(
      "src/ops/example.txt"
    )

    expect(afterDeleteResult).toMatchObject({
      error: {
        code: "not-found"
      },
      ok: false
    })
  })

  it("rejects stale workspace writes when an expected mtime is provided", async () => {
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
      chatSessionId: "chat-stale-write",
      projectPath: testProjectPath,
      settings
    })
    const targetPath = path.join(testProjectPath, "src/stale-write.txt")

    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, "before")

    const statResult = await workspace.operations.fileStat(
      "src/stale-write.txt"
    )

    if (!statResult.ok) {
      throw new Error(statResult.error.message)
    }

    fs.writeFileSync(targetPath, "external")
    fs.utimesSync(
      targetPath,
      new Date(statResult.value.mtimeMs + 2000),
      new Date(statResult.value.mtimeMs + 2000)
    )

    await expect(
      workspace.operations.writeFile("src/stale-write.txt", "after", {
        expectedMtimeMs: statResult.value.mtimeMs
      })
    ).resolves.toMatchObject({
      error: {
        code: "stale-write",
        path: "src/stale-write.txt"
      },
      ok: false
    })
    expect(fs.readFileSync(targetPath, "utf-8")).toBe("external")
  })

  it("serializes stale-checked writes to the same workspace file", async () => {
    const targetRelativePath = "src/concurrent-write.txt"
    const targetPath = path.join(testProjectPath, targetRelativePath)
    const executionEnv = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    let checkedReads = 0
    const staleCheckBarrier = Promise.withResolvers<null>()
    const releaseTimer = setTimeout(() => staleCheckBarrier.resolve(null), 20)
    const operations = createAgentWorkspaceOperations({
      ...executionEnv,
      fileSystem: {
        ...executionEnv.fileSystem,
        fileInfo: async (requestedPath, signal) => {
          const result = await executionEnv.fileSystem.fileInfo(
            requestedPath,
            signal
          )

          if (requestedPath === targetRelativePath && checkedReads < 2) {
            checkedReads += 1

            if (checkedReads === 2) {
              staleCheckBarrier.resolve(null)
            }

            await staleCheckBarrier.promise
          }

          return result
        }
      }
    })

    fs.writeFileSync(targetPath, "before")
    fs.utimesSync(targetPath, new Date(1), new Date(1))

    const initialFileInfo =
      await executionEnv.fileSystem.fileInfo(targetRelativePath)

    if (!initialFileInfo.ok) {
      throw new Error(initialFileInfo.error.message)
    }

    const [firstWrite, secondWrite] = await Promise.all([
      operations.writeFile(targetRelativePath, "first", {
        expectedMtimeMs: initialFileInfo.value.mtimeMs
      }),
      operations.writeFile(targetRelativePath, "second", {
        expectedMtimeMs: initialFileInfo.value.mtimeMs
      })
    ])

    clearTimeout(releaseTimer)

    expect([firstWrite.ok, secondWrite.ok]).toEqual([true, false])
    expect(secondWrite).toEqual({
      error: {
        code: "stale-write",
        message:
          "src/concurrent-write.txt changed since it was read; read it again before writing.",
        path: "src/concurrent-write.txt"
      },
      ok: false
    })
    expect(fs.readFileSync(targetPath, "utf-8")).toBe("first")
  })

  it("exposes project snapshot files through workspace operations", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true,
        lsp: {
          enabled: false
        },
        sandbox: {
          enabled: false
        }
      }
    }).agents
    const snapshotPath = path.join(testProjectPath, "src/snapshot-visible.ts")

    fs.writeFileSync(snapshotPath, "export const visible = true\n")

    const workspace = createAgentWorkspace({
      chatSessionId: "chat-project-snapshot",
      projectPath: testProjectPath,
      settings
    })
    const result = workspace.operations.listProjectSnapshotFiles({
      limit: 20,
      query: "snapshot-visible"
    })

    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "file",
          relativePath: "src/snapshot-visible.ts"
        })
      ])
    )
  })

  it("routes LSP operations through the workspace substrate", async () => {
    const executionEnv = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const lsp: AgentLspManager = {
      cleanup: () => Promise.resolve(),
      diagnostics: (filePath) =>
        Promise.resolve({
          diagnostics: [],
          path: filePath,
          status: "success"
        }),
      documentSymbols: ({ path: filePath }) =>
        Promise.resolve({
          path: filePath,
          status: "success",
          symbols: [
            {
              column: 1,
              endColumn: 12,
              endLine: 1,
              kind: "function",
              line: 1,
              name: "makeValue",
              path: filePath
            }
          ]
        }),
      workspaceSymbols: ({ query }) =>
        Promise.resolve({
          query,
          rootPath: ".",
          status: "success",
          symbols: [
            {
              column: 14,
              endColumn: 23,
              endLine: 2,
              kind: "function",
              line: 2,
              name: "makeValue",
              path: "src/lsp-target.ts"
            }
          ]
        }),
      hasClients: () => true,
      inspect: ({ line, path: filePath }) =>
        Promise.resolve({
          calls: {
            incoming: [],
            outgoing: []
          },
          column: 4,
          definition: [],
          diagnostics: [],
          hover: "const value: number",
          implementation: [],
          line,
          path: filePath,
          references: [],
          status: "success"
        }),
      status: () => ({
        clients: [],
        hasClients: true
      }),
      touchFile: (filePath) =>
        Promise.resolve({
          diagnostics: [
            {
              column: 4,
              line: 1,
              message: "Type mismatch",
              severity: "error"
            }
          ],
          path: filePath,
          status: "success"
        })
    }
    const operations = createAgentWorkspaceOperations(
      executionEnv,
      undefined,
      lsp
    )

    await expect(
      operations.lspInspect({
        line: 1,
        match: "<<<value",
        path: "src/lsp-target.ts"
      })
    ).resolves.toMatchObject({
      hover: "const value: number",
      path: "src/lsp-target.ts",
      status: "success"
    })
    await expect(
      operations.lspDocumentSymbols({
        path: "src/lsp-target.ts"
      })
    ).resolves.toMatchObject({
      path: "src/lsp-target.ts",
      status: "success",
      symbols: [
        {
          kind: "function",
          name: "makeValue"
        }
      ]
    })
    await expect(
      operations.lspWorkspaceSymbols({
        query: "makeValue"
      })
    ).resolves.toMatchObject({
      query: "makeValue",
      status: "success",
      symbols: [
        {
          kind: "function",
          name: "makeValue"
        }
      ]
    })
    await expect(
      operations.lspTouchFile("src/lsp-target.ts")
    ).resolves.toMatchObject({
      diagnostics: [
        {
          message: "Type mismatch"
        }
      ],
      path: "src/lsp-target.ts",
      status: "success"
    })
  })

  it("exposes git diff through workspace operations", async () => {
    const projectPath = `${testProjectPath}-git-diff`
    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true,
        lsp: {
          enabled: false
        },
        sandbox: {
          enabled: false
        }
      }
    }).agents

    fs.mkdirSync(path.join(projectPath, "src"), { recursive: true })

    try {
      runGit(projectPath, ["init"])
      runGit(projectPath, ["config", "user.email", "test@example.com"])
      runGit(projectPath, ["config", "user.name", "Etyon Test"])
      fs.writeFileSync(path.join(projectPath, "src/example.ts"), "old\n")
      runGit(projectPath, ["add", "."])
      runGit(projectPath, ["commit", "-m", "initial"])
      fs.writeFileSync(path.join(projectPath, "src/example.ts"), "new\n")

      const workspace = createAgentWorkspace({
        chatSessionId: "chat-git-diff",
        projectPath,
        settings
      })
      const result = await workspace.operations.gitDiff({
        excludeSecretPaths: true,
        paths: ["src/example.ts"]
      })

      expect(result).toMatchObject({
        hasPatch: true,
        projectPath
      })
      expect(result.patch).toContain("src/example.ts")
      expect(result.patch).toContain("-old")
      expect(result.patch).toContain("+new")
    } finally {
      fs.rmSync(projectPath, {
        force: true,
        recursive: true
      })
    }
  })

  it("runs commands and manages processes through workspace operations", async () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true,
        lsp: {
          enabled: false
        },
        sandbox: {
          enabled: false
        }
      }
    }).agents
    const workspace = createAgentWorkspace({
      chatSessionId: "chat-command-operations",
      projectPath: testProjectPath,
      settings
    })
    const commandResult = await workspace.operations.executeCommand(
      `${process.execPath} -e ${JSON.stringify("process.stdout.write('workspace-command')")}`,
      {
        timeoutMs: 5000
      }
    )

    if (!commandResult.result.ok) {
      throw new Error(commandResult.result.error.message)
    }

    expect(commandResult).toMatchObject({
      resolvedCwd: testProjectPath
    })
    expect(commandResult.result.value).toMatchObject({
      exitCode: 0,
      stdout: "workspace-command"
    })

    const processResult = await workspace.operations.startProcess(
      `${process.execPath} -e ${JSON.stringify("setInterval(() => {}, 1000)")}`
    )

    if (!processResult.ok) {
      throw new Error(processResult.error.message)
    }

    expect(
      workspace.operations.getProcess(processResult.value.id)
    ).toMatchObject({
      id: processResult.value.id,
      status: "running"
    })

    const stoppedResult = await workspace.operations.stopProcess(
      processResult.value.id
    )

    if (!stoppedResult.ok) {
      throw new Error(stoppedResult.error.message)
    }

    expect(stoppedResult.value).toMatchObject({
      id: processResult.value.id,
      status: "stopped"
    })
  })

  it("routes search operations through workspace command execution", async () => {
    const commands: string[] = []
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
              `process.stdout.write(${JSON.stringify(
                input.command.startsWith("rg ") ? "rg-output" : "fd-output"
              )})`
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
    const operations = createAgentWorkspaceOperations(
      createAgentExecutionEnv({
        projectPath: testProjectPath,
        sandbox
      })
    )
    const searchResult = await operations.searchContent({
      args: ["--json", "--", "needle", "."],
      requestedCwd: ""
    })
    const findResult = await operations.findFiles({
      args: ["--glob", "--", "*.ts", "."],
      requestedCwd: ""
    })

    if (!searchResult.ok) {
      throw new Error(searchResult.error.message)
    }

    if (!findResult.ok) {
      throw new Error(findResult.error.message)
    }

    expect(searchResult.value).toBe("rg-output")
    expect(findResult.value).toBe("fd-output")
    expect(commands).toEqual(["rg --json -- needle .", "fd --glob -- '*.ts' ."])
  })

  it("executes web operations through the workspace substrate", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("https://api.duckduckgo.com/")) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              AbstractText: "Workspace web result",
              AbstractURL: "https://example.com/result",
              Heading: "Workspace"
            }),
          ok: true,
          status: 200
        })
      }

      return Promise.resolve({
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type"
              ? "text/html; charset=utf-8"
              : null
        },
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            "<html><head><title>Workspace &amp; Web</title></head><body><p>Readable &amp; bounded content</p></body></html>"
          )
      })
    })
    const operations = createAgentWorkspaceOperations(
      createAgentExecutionEnv({
        projectPath: testProjectPath
      })
    )

    vi.stubGlobal("fetch", fetchMock)

    const searchResult = await operations.webSearch("workspace web", {
      maxResults: 5
    })
    const extractResult = await operations.webExtract("https://example.com", {
      maxChars: 16
    })

    if (!searchResult.ok) {
      throw new Error(searchResult.error.message)
    }

    if (!extractResult.ok) {
      throw new Error(extractResult.error.message)
    }

    expect(searchResult.value).toMatchObject({
      query: "workspace web",
      results: [
        {
          snippet: "Workspace web result",
          title: "Workspace",
          url: "https://example.com/result"
        }
      ],
      truncated: false
    })
    expect(extractResult.value).toEqual({
      content: "Readable & bound",
      contentType: "text/html; charset=utf-8",
      title: "Workspace & Web",
      truncated: true,
      url: "https://example.com"
    })
  })

  it("rejects local web extraction targets before fetching", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("fetch should not be called")
    })
    const operations = createAgentWorkspaceOperations(
      createAgentExecutionEnv({
        projectPath: testProjectPath
      })
    )

    vi.stubGlobal("fetch", fetchMock)

    for (const url of [
      "http://127.0.0.1:3000/private",
      "http://localhost/private",
      "http://192.168.1.10/private"
    ]) {
      await expect(
        operations.webExtract(url, {
          maxChars: 1000
        })
      ).resolves.toEqual({
        error: {
          code: "unknown",
          message:
            "webExtract can only fetch public http(s) URLs; local and private network targets are not allowed."
        },
        ok: false
      })
    }

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects web extraction redirects to local targets before reading content", async () => {
    const textMock = vi.fn(() => Promise.resolve("secret local content"))
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type"
              ? "text/plain; charset=utf-8"
              : null
        },
        ok: true,
        status: 200,
        text: textMock,
        url: "http://127.0.0.1:3000/private"
      })
    )
    const operations = createAgentWorkspaceOperations(
      createAgentExecutionEnv({
        projectPath: testProjectPath
      })
    )

    vi.stubGlobal("fetch", fetchMock)

    await expect(
      operations.webExtract("https://example.com/public", {
        maxChars: 1000
      })
    ).resolves.toEqual({
      error: {
        code: "unknown",
        message:
          "webExtract can only fetch public http(s) URLs; local and private network targets are not allowed."
      },
      ok: false
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(textMock).not.toHaveBeenCalled()
  })

  it("validates manual web extraction redirects before following them", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "location"
              ? "http://127.0.0.1:3000/private"
              : null
        },
        ok: false,
        status: 302,
        text: vi.fn(),
        url: "https://example.com/public"
      })
    )
    const operations = createAgentWorkspaceOperations(
      createAgentExecutionEnv({
        projectPath: testProjectPath
      })
    )

    vi.stubGlobal("fetch", fetchMock)

    await expect(
      operations.webExtract("https://example.com/public", {
        maxChars: 1000
      })
    ).resolves.toEqual({
      error: {
        code: "unknown",
        message:
          "webExtract can only fetch public http(s) URLs; local and private network targets are not allowed."
      },
      ok: false
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/public",
      expect.objectContaining({
        redirect: "manual"
      })
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
