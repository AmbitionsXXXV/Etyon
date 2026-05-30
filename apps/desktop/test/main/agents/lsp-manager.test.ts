import fs from "node:fs"
import path from "node:path"
import { PassThrough } from "node:stream"
import { setTimeout as sleep } from "node:timers/promises"

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"

import { createAgentExecutionEnv } from "@/main/agents/execution-env"
import { createAgentLspManager } from "@/main/agents/lsp-manager"
import type { LspProcess, LspProcessManager } from "@/main/agents/lsp-manager"
import type {
  WorkspaceSandbox,
  WorkspaceSandboxCommandInput,
  WorkspaceSandboxSpawnConfig
} from "@/main/agents/workspace-sandbox"

interface FakeServerOptions {
  crashOnStart?: boolean
  ignoreInitialize?: boolean
}

type FakeLspProcessEvent = "close" | "error" | "exit"

class FakeLspProcess implements LspProcess {
  #listeners = new Map<FakeLspProcessEvent, ((...args: unknown[]) => void)[]>()

  pid = 42
  stderr = new PassThrough()
  stdin = new PassThrough()
  stdout = new PassThrough()

  emitClose = (code: number): void => {
    this.#emit("close", code)
  }

  kill = (): boolean => {
    this.emitClose(0)

    return true
  }

  once = (
    event: FakeLspProcessEvent,
    listener: (...args: unknown[]) => void
  ): FakeLspProcess => {
    const wrappedListener = (...args: unknown[]): void => {
      this.#listeners.set(
        event,
        (this.#listeners.get(event) ?? []).filter(
          (candidate) => candidate !== wrappedListener
        )
      )
      listener(...args)
    }

    this.#listeners.set(event, [
      ...(this.#listeners.get(event) ?? []),
      wrappedListener
    ])

    return this
  }

  #emit(event: FakeLspProcessEvent, ...args: unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      listener(...args)
    }
  }
}

const testProjectPath = `/tmp/etyon-lsp-manager-test-${Date.now()}`

const lspSettings = {
  diagnosticTimeoutMs: 50,
  enabled: true,
  initTimeoutMs: 100,
  requireSandbox: true
} as const

const writeRpcMessage = (
  stream: PassThrough,
  message: Record<string, unknown>
): void => {
  const content = JSON.stringify(message)

  stream.write(
    `Content-Length: ${Buffer.byteLength(content, "utf-8")}\r\n\r\n${content}`
  )
}

const createRpcParser = (
  onMessage: (message: Record<string, unknown>) => void
): ((chunk: Buffer) => void) => {
  let buffer = Buffer.alloc(0)

  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    while (true) {
      const headerEndIndex = buffer.indexOf("\r\n\r\n")

      if (headerEndIndex === -1) {
        return
      }

      const header = buffer.subarray(0, headerEndIndex).toString("utf-8")
      const contentLengthMatch = /Content-Length:\s*(\d+)/iu.exec(header)
      const contentLength = contentLengthMatch
        ? Number(contentLengthMatch[1])
        : Number.NaN
      const bodyStartIndex = headerEndIndex + 4
      const bodyEndIndex = bodyStartIndex + contentLength

      if (buffer.length < bodyEndIndex) {
        return
      }

      const body = buffer.subarray(bodyStartIndex, bodyEndIndex).toString()

      buffer = buffer.subarray(bodyEndIndex)
      onMessage(JSON.parse(body) as Record<string, unknown>)
    }
  }
}

const createFakeWorkspaceSandbox = (
  preparedCommands: string[],
  cleanupCalls: string[] = [],
  preparedCwds: string[] = []
): WorkspaceSandbox => ({
  cleanup: () => Promise.resolve(),
  enabled: true,
  prepareShellCommand: (
    input: WorkspaceSandboxCommandInput
  ): Promise<
    | {
        ok: true
        value: WorkspaceSandboxSpawnConfig
      }
    | {
        error: {
          code: "unavailable"
          message: string
        }
        ok: false
      }
  > => {
    preparedCommands.push(input.command)
    preparedCwds.push(input.cwd)

    return Promise.resolve({
      ok: true,
      value: {
        args: ["--stdio"],
        cleanup: () => {
          cleanupCalls.push(input.command)

          return Promise.resolve()
        },
        command: "fake-lsp",
        cwd: input.cwd,
        env: input.env,
        sandboxed: true
      }
    })
  }
})

const createFakeLspProcessManager = ({
  crashOnStart = false,
  ignoreInitialize = false
}: FakeServerOptions = {}): {
  manager: LspProcessManager
  spawnedProcesses: FakeLspProcess[]
} => {
  const spawnedProcesses: FakeLspProcess[] = []
  const manager: LspProcessManager = {
    spawn: () => {
      const lspProcess = new FakeLspProcess()

      spawnedProcesses.push(lspProcess)

      if (crashOnStart) {
        queueMicrotask(() => {
          lspProcess.emitClose(1)
        })

        return lspProcess
      }

      lspProcess.stdin.on(
        "data",
        createRpcParser((message) => {
          handleFakeLspMessage({
            ignoreInitialize,
            message,
            process: lspProcess
          })
        })
      )

      return lspProcess
    }
  }

  return {
    manager,
    spawnedProcesses
  }
}

const waitForSpawnedProcess = async (
  spawnedProcesses: readonly FakeLspProcess[]
): Promise<void> => {
  let attempts = 0

  while (spawnedProcesses.length === 0 && attempts < 20) {
    attempts += 1
    await sleep(0)
  }
}

const handleFakeLspMessage = ({
  ignoreInitialize,
  message,
  process: lspProcess
}: {
  ignoreInitialize: boolean
  message: Record<string, unknown>
  process: FakeLspProcess
}): void => {
  const { id, method } = message

  if (method === "initialize" && typeof id === "number") {
    if (ignoreInitialize) {
      return
    }

    writeRpcMessage(lspProcess.stdout, {
      id,
      jsonrpc: "2.0",
      result: {
        capabilities: {}
      }
    })
    return
  }

  if (method === "textDocument/didOpen") {
    const params = message.params as {
      textDocument?: {
        uri?: string
      }
    }
    const uri = params.textDocument?.uri ?? ""

    writeRpcMessage(lspProcess.stdout, {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        diagnostics: [
          {
            code: 2322,
            message: "Type mismatch",
            range: {
              end: {
                character: 12,
                line: 0
              },
              start: {
                character: 6,
                line: 0
              }
            },
            severity: 1,
            source: "ts"
          }
        ],
        uri
      }
    })
    return
  }

  if (method === "textDocument/diagnostic" && typeof id === "number") {
    writeRpcMessage(lspProcess.stdout, {
      id,
      jsonrpc: "2.0",
      result: {
        items: [],
        kind: "full"
      }
    })
    return
  }

  if (method === "textDocument/hover" && typeof id === "number") {
    writeRpcMessage(lspProcess.stdout, {
      id,
      jsonrpc: "2.0",
      result: {
        contents: {
          kind: "markdown",
          value: "const answer: number"
        }
      }
    })
    return
  }

  if (
    (method === "textDocument/definition" ||
      method === "textDocument/references") &&
    typeof id === "number"
  ) {
    const params = message.params as {
      textDocument?: {
        uri?: string
      }
    }

    writeRpcMessage(lspProcess.stdout, {
      id,
      jsonrpc: "2.0",
      result: [
        {
          range: {
            end: {
              character: 12,
              line: 0
            },
            start: {
              character: 6,
              line: 0
            }
          },
          uri: params.textDocument?.uri ?? ""
        }
      ]
    })
    return
  }

  if (method === "textDocument/implementation" && typeof id === "number") {
    writeRpcMessage(lspProcess.stdout, {
      id,
      jsonrpc: "2.0",
      result: []
    })
  }
}

describe("agent LSP manager", () => {
  beforeAll(() => {
    fs.mkdirSync(path.join(testProjectPath, "src"), { recursive: true })
    fs.writeFileSync(
      path.join(testProjectPath, "src/example.ts"),
      "const answer = 1\n"
    )
    fs.mkdirSync(path.join(testProjectPath, "packages/app/src"), {
      recursive: true
    })
    fs.writeFileSync(
      path.join(testProjectPath, "packages/app/pnpm-lock.yaml"),
      ""
    )
    fs.writeFileSync(
      path.join(testProjectPath, "packages/app/src/nested.ts"),
      "const nested = 1\n"
    )
    fs.writeFileSync(path.join(testProjectPath, "README.md"), "# test\n")
  })

  afterAll(() => {
    fs.rmSync(testProjectPath, { force: true, recursive: true })
  })

  it("inspects TypeScript hover, definition, and current-line diagnostics through a sandboxed server", async () => {
    const cleanupCalls: string[] = []
    const events: unknown[] = []
    const preparedCommands: string[] = []
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const { manager, spawnedProcesses } = createFakeLspProcessManager()
    const lsp = createAgentLspManager({
      eventSink: (event) => {
        events.push(event)
      },
      fileSystem: env.fileSystem,
      processManager: manager,
      projectPath: testProjectPath,
      sandbox: createFakeWorkspaceSandbox(preparedCommands, cleanupCalls),
      settings: lspSettings
    })

    expect(lsp.hasClients()).toBe(false)
    expect(lsp.status()).toEqual({
      clients: [],
      hasClients: false
    })

    const result = await lsp.inspect({
      line: 1,
      match: "const <<<answer = 1",
      path: "src/example.ts"
    })

    expect(result).toMatchObject({
      column: 7,
      definition: [
        {
          column: 7,
          line: 1,
          path: "src/example.ts"
        }
      ],
      diagnostics: [
        {
          code: 2322,
          column: 7,
          line: 1,
          message: "Type mismatch",
          severity: "error",
          source: "ts"
        }
      ],
      hover: "const answer: number",
      path: "src/example.ts",
      references: [
        {
          column: 7,
          line: 1,
          path: "src/example.ts"
        }
      ],
      status: "success"
    })
    expect(preparedCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("typescript-language-server")
      ])
    )
    expect(spawnedProcesses).toHaveLength(1)
    expect(lsp.hasClients()).toBe(true)
    expect(lsp.status()).toEqual({
      clients: [
        {
          rootPath: testProjectPath,
          status: "running"
        }
      ],
      hasClients: true
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "lsp_server_started"
        }),
        expect.objectContaining({
          type: "lsp_diagnostics_collected"
        })
      ])
    )

    await lsp.cleanup()

    expect(cleanupCalls).toEqual(preparedCommands)
  })

  it("touches a TypeScript document and keeps diagnostics as a compatibility alias", async () => {
    const preparedCommands: string[] = []
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const { manager } = createFakeLspProcessManager()
    const lsp = createAgentLspManager({
      fileSystem: env.fileSystem,
      processManager: manager,
      projectPath: testProjectPath,
      sandbox: createFakeWorkspaceSandbox(preparedCommands),
      settings: lspSettings
    })
    const result = await lsp.touchFile("src/example.ts")

    expect(result).toMatchObject({
      diagnostics: [
        {
          code: 2322,
          column: 7,
          line: 1,
          message: "Type mismatch",
          severity: "error",
          source: "ts"
        }
      ],
      path: "src/example.ts",
      status: "success"
    })
    expect(preparedCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("typescript-language-server")
      ])
    )

    await expect(lsp.diagnostics("src/example.ts")).resolves.toMatchObject({
      status: "success"
    })

    await lsp.cleanup()
  })

  it("starts TypeScript LSP at the nearest package root", async () => {
    const preparedCommands: string[] = []
    const preparedCwds: string[] = []
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const { manager, spawnedProcesses } = createFakeLspProcessManager()
    const lsp = createAgentLspManager({
      fileSystem: env.fileSystem,
      processManager: manager,
      projectPath: testProjectPath,
      sandbox: createFakeWorkspaceSandbox(preparedCommands, [], preparedCwds),
      settings: lspSettings
    })
    const result = await lsp.inspect({
      line: 1,
      match: "const <<<nested = 1",
      path: "packages/app/src/nested.ts"
    })

    expect(result.status).toBe("success")
    expect(preparedCwds).toEqual([path.join(testProjectPath, "packages/app")])
    expect(spawnedProcesses).toHaveLength(1)

    await lsp.cleanup()
  })

  it("returns unsupported without spawning for non TS/JS files", async () => {
    const preparedCommands: string[] = []
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const { manager, spawnedProcesses } = createFakeLspProcessManager()
    const lsp = createAgentLspManager({
      fileSystem: env.fileSystem,
      processManager: manager,
      projectPath: testProjectPath,
      sandbox: createFakeWorkspaceSandbox(preparedCommands),
      settings: lspSettings
    })

    await expect(
      lsp.inspect({
        line: 1,
        match: "# <<<test",
        path: "README.md"
      })
    ).resolves.toMatchObject({
      status: "unsupported"
    })
    expect(preparedCommands).toEqual([])
    expect(spawnedProcesses).toHaveLength(0)
  })

  it("reports initialize timeout as a timeout result", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const { manager } = createFakeLspProcessManager({
      ignoreInitialize: true
    })
    const lsp = createAgentLspManager({
      fileSystem: env.fileSystem,
      processManager: manager,
      projectPath: testProjectPath,
      sandbox: createFakeWorkspaceSandbox([]),
      settings: {
        ...lspSettings,
        initTimeoutMs: 10
      }
    })

    await expect(
      lsp.inspect({
        line: 1,
        match: "const <<<answer = 1",
        path: "src/example.ts"
      })
    ).resolves.toMatchObject({
      status: "timeout"
    })
  })

  it("deduplicates concurrent startup and exposes the starting status", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const { manager, spawnedProcesses } = createFakeLspProcessManager({
      ignoreInitialize: true
    })
    const lsp = createAgentLspManager({
      fileSystem: env.fileSystem,
      processManager: manager,
      projectPath: testProjectPath,
      sandbox: createFakeWorkspaceSandbox([]),
      settings: {
        ...lspSettings,
        initTimeoutMs: 20
      }
    })
    const firstInspection = lsp.inspect({
      line: 1,
      match: "const <<<answer = 1",
      path: "src/example.ts"
    })
    const secondInspection = lsp.inspect({
      line: 1,
      match: "const <<<answer = 1",
      path: "src/example.ts"
    })

    await waitForSpawnedProcess(spawnedProcesses)

    expect(spawnedProcesses).toHaveLength(1)
    expect(lsp.status()).toEqual({
      clients: [
        {
          rootPath: testProjectPath,
          status: "starting"
        }
      ],
      hasClients: false
    })
    await expect(firstInspection).resolves.toMatchObject({
      status: "timeout"
    })
    await expect(secondInspection).resolves.toMatchObject({
      status: "timeout"
    })
    expect(spawnedProcesses).toHaveLength(1)
    expect(lsp.status()).toEqual({
      clients: [
        {
          error: expect.stringContaining("timed out"),
          rootPath: testProjectPath,
          status: "broken"
        }
      ],
      hasClients: false
    })
  })

  it("reports server crash as unavailable", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const { manager } = createFakeLspProcessManager({
      crashOnStart: true
    })
    const lsp = createAgentLspManager({
      fileSystem: env.fileSystem,
      processManager: manager,
      projectPath: testProjectPath,
      sandbox: createFakeWorkspaceSandbox([]),
      settings: lspSettings
    })

    await expect(
      lsp.inspect({
        line: 1,
        match: "const <<<answer = 1",
        path: "src/example.ts"
      })
    ).resolves.toMatchObject({
      status: "unavailable"
    })
  })

  it("marks a running root as broken when the server exits and avoids respawn", async () => {
    const preparedCommands: string[] = []
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const { manager, spawnedProcesses } = createFakeLspProcessManager()
    const lsp = createAgentLspManager({
      fileSystem: env.fileSystem,
      processManager: manager,
      projectPath: testProjectPath,
      sandbox: createFakeWorkspaceSandbox(preparedCommands),
      settings: lspSettings
    })

    await expect(
      lsp.inspect({
        line: 1,
        match: "const <<<answer = 1",
        path: "src/example.ts"
      })
    ).resolves.toMatchObject({
      status: "success"
    })

    spawnedProcesses[0]?.emitClose(1)

    expect(lsp.hasClients()).toBe(false)
    expect(lsp.status()).toEqual({
      clients: [
        {
          error: "LSP server closed.",
          rootPath: testProjectPath,
          status: "broken"
        }
      ],
      hasClients: false
    })
    await expect(lsp.touchFile("src/example.ts")).resolves.toMatchObject({
      error: "LSP server closed.",
      status: "unavailable"
    })
    expect(spawnedProcesses).toHaveLength(1)
  })
})
