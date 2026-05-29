import fs from "node:fs"

import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  buildAgentTools
} from "@/main/agents/tool-registry"

const { spawnedChildren, spawnedCommands, spawnMock } = vi.hoisted(() => {
  type MockListener = (...args: unknown[]) => void
  interface MockEmitter {
    emit: (eventName: string, ...args: unknown[]) => void
    on: (eventName: string, listener: MockListener) => MockEmitter
    once: (eventName: string, listener: MockListener) => MockEmitter
    removeListener: (eventName: string, listener: MockListener) => MockEmitter
  }

  const createMockEmitter = (): MockEmitter => {
    const listeners = new Map<string, Set<MockListener>>()
    const emitter: MockEmitter = {
      emit: (eventName, ...args) => {
        for (const listener of listeners.get(eventName) ?? []) {
          listener(...args)
        }
      },
      on: (eventName, listener) => {
        const eventListeners = listeners.get(eventName) ?? new Set()

        eventListeners.add(listener)
        listeners.set(eventName, eventListeners)

        return emitter
      },
      once: (eventName, listener) => {
        const onceListener: MockListener = (...args) => {
          emitter.removeListener(eventName, onceListener)
          listener(...args)
        }

        return emitter.on(eventName, onceListener)
      },
      removeListener: (eventName, listener) => {
        listeners.get(eventName)?.delete(listener)

        return emitter
      }
    }

    return emitter
  }

  const commandLog: string[] = []
  const childProcesses: {
    kill: ReturnType<typeof vi.fn>
    stdin: {
      end: ReturnType<typeof vi.fn>
      write: ReturnType<typeof vi.fn>
    }
  }[] = []
  const getMockStdout = (shellCommand: string): string => {
    if (shellCommand.startsWith("rg ")) {
      if (!shellCommand.includes("--json")) {
        return "src/search.ts:1:export const needle = true\n"
      }

      return `${JSON.stringify({
        data: {
          line_number: 1,
          lines: {
            text: "export const needle = true\n"
          },
          path: {
            text: "src/search.ts"
          },
          submatches: [
            {
              start: 13
            }
          ]
        },
        type: "match"
      })}\n`
    }

    if (shellCommand.includes("large-output")) {
      return "x".repeat(AGENT_TOOL_OUTPUT_MAX_CHARS + 1)
    }

    if (shellCommand.includes("slow-output")) {
      return "partial before timeout\n"
    }

    return "approved\n"
  }
  const childProcessSpawnMock = vi.fn((command: string, args: string[]) => {
    commandLog.push([command, ...args].join(" "))

    const child = createMockEmitter() as MockEmitter & {
      kill: ReturnType<typeof vi.fn>
      stderr: MockEmitter
      stdin: {
        end: ReturnType<typeof vi.fn>
        write: ReturnType<typeof vi.fn>
      }
      stdout: MockEmitter
    }

    child.kill = vi.fn(() => {
      child.emit("close", null)
    })
    childProcesses.push(child)
    child.stderr = createMockEmitter()
    child.stdin = {
      end: vi.fn(),
      write: vi.fn()
    }
    child.stdout = createMockEmitter()

    queueMicrotask(() => {
      const shellCommand = args[1] ?? ""
      const stdout = getMockStdout(shellCommand)

      child.stdout.emit("data", Buffer.from(stdout))
      if (shellCommand.includes("slow-output")) {
        return
      }

      child.emit("close", 0)
    })

    return child
  })

  return {
    spawnedChildren: childProcesses,
    spawnedCommands: commandLog,
    spawnMock: childProcessSpawnMock
  }
})

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...(actual as object),
    spawn: spawnMock
  }
})

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

const createApprovedToolOptions = (toolCallId = "tool-call-1") => ({
  messages: createApprovedToolMessages(toolCallId),
  toolCallId
})

describe("agent command tools", () => {
  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync("/tmp/etyon-agent-command-tools", {
      force: true,
      recursive: true
    })
    spawnedChildren.length = 0
    spawnedCommands.length = 0
    vi.clearAllMocks()
  })

  it("executes a command after the AI SDK approval gate has allowed execution", async () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: "/tmp/etyon-agent-command-tools",
      settings
    })
    const result = await tools.bash?.execute?.(
      {
        command: "echo approved"
      },
      createApprovedToolOptions()
    )

    expect(result).toMatchObject({
      content: [
        {
          text: "approved\n",
          type: "text"
        }
      ],
      details: {
        durationMs: expect.any(Number),
        truncated: false
      }
    })
    expect(spawnedCommands).toEqual(["/bin/zsh -fc echo approved"])
  })

  it("rejects unsupported package managers before spawning", async () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: "/tmp/etyon-agent-command-tools",
      settings
    })
    const resultPromise = tools.bash?.execute?.(
      {
        command: "pnpm install"
      },
      {
        messages: [],
        toolCallId: "tool-call-1"
      }
    )

    await expect(resultPromise).rejects.toThrow(
      "Use vp for package manager commands."
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("kills the running command and reports failure when aborted", async () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: "/tmp/etyon-agent-command-tools",
      settings
    })
    const abortController = new AbortController()
    const resultPromise = tools.bash?.execute?.(
      {
        command: "echo approved"
      },
      {
        abortSignal: abortController.signal,
        ...createApprovedToolOptions()
      }
    )

    abortController.abort()

    await expect(resultPromise).rejects.toThrow("Command aborted.")
    expect(spawnedChildren[0]?.kill).toHaveBeenCalledWith("SIGTERM")
  })

  it("rejects without spawning when already aborted", async () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: "/tmp/etyon-agent-command-tools",
      settings
    })
    const abortController = new AbortController()

    abortController.abort()

    const resultPromise = tools.bash?.execute?.(
      {
        command: "echo skipped"
      },
      {
        abortSignal: abortController.signal,
        ...createApprovedToolOptions()
      }
    )

    await expect(resultPromise).rejects.toThrow("Command aborted.")
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it("executes grep through the shell adapter", async () => {
    fs.mkdirSync("/tmp/etyon-agent-command-tools/src", { recursive: true })
    fs.writeFileSync(
      "/tmp/etyon-agent-command-tools/src/search.ts",
      "export const needle = true\n"
    )

    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: "/tmp/etyon-agent-command-tools",
      settings
    })
    const result = await tools.grep?.execute?.(
      {
        pattern: "needle"
      },
      {
        messages: [],
        toolCallId: "tool-call-1"
      }
    )

    expect(result).toMatchObject({
      content: [
        {
          text: "src/search.ts:1:export const needle = true",
          type: "text"
        }
      ]
    })
    expect(spawnedCommands[0]).toContain("/bin/zsh -fc rg --line-number")
  })

  it("does not expose legacy searchFiles on the coder surface", () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: "/tmp/etyon-agent-command-tools",
      settings
    })

    expect(tools).not.toHaveProperty("searchFiles")
  })

  it("returns a full output artifact ref when bash output is truncated", async () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: "/tmp/etyon-agent-command-tools",
      settings
    })
    const result = await tools.bash?.execute?.(
      {
        command: "echo large-output"
      },
      createApprovedToolOptions()
    )

    expect(result).toMatchObject({
      details: expect.objectContaining({
        fullOutputPath: expect.any(String),
        truncated: true
      })
    })

    if (
      typeof result !== "object" ||
      result === null ||
      !("details" in result) ||
      !result.details ||
      typeof result.details.fullOutputPath !== "string"
    ) {
      throw new Error("Expected command output artifact ref.")
    }

    expect(fs.existsSync(result.details.fullOutputPath)).toBe(true)
  })

  it("preserves partial command output when a command times out", async () => {
    vi.useFakeTimers()

    const settings = AppSettingsSchema.parse({
      agents: {
        defaultProfileId: "coder",
        enabled: true
      }
    }).agents
    const tools = buildAgentTools({
      projectPath: "/tmp/etyon-agent-command-tools",
      settings
    })
    const resultPromise = tools.bash?.execute?.(
      {
        command: "echo slow-output",
        timeout: 1
      },
      createApprovedToolOptions()
    )
    const resultExpectation =
      expect(resultPromise).rejects.toThrow("Command timed out.")

    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000)

    await resultExpectation
  })
})
