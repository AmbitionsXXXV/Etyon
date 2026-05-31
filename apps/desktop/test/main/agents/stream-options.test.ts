import { AppSettingsSchema } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import { describe, expect, it, vi } from "vite-plus/test"

import type { AgentStreamHooks } from "@/main/agents/agent-stream-hooks"
import { prepareAgentStreamRequest } from "@/main/agents/agent-stream-hooks"
import { createAgentTurnState } from "@/main/agents/agent-turn-state"

import { createAgentRuntimeHarness } from "./agent-runtime-harness"
import { createFauxTextResponse } from "./faux-provider"

const { mockedAppPath, mockedHomeDir } = vi.hoisted(() => ({
  mockedAppPath: process.cwd().endsWith("/apps/desktop")
    ? process.cwd()
    : `${process.cwd()}/apps/desktop`,
  mockedHomeDir: `/tmp/etyon-stream-options-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
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

describe("agent stream options", () => {
  it("snapshots stream options before provider hooks patch the request", async () => {
    const headers = {
      stale: "remove",
      "x-base": "base"
    }
    const metadata = {
      source: "chat",
      stale: true
    }
    const turnState = await createAgentTurnState({
      messages: [
        {
          content: "Original user",
          role: "user"
        }
      ],
      model: "gpt-5",
      streamOptions: {
        headers,
        metadata
      },
      systemPrompt: "Base system",
      tools: {
        read: {}
      }
    })

    headers["x-base"] = "mutated"
    metadata.source = "mutated"

    const prepared = await prepareAgentStreamRequest({
      hooks: {
        beforeProviderPayload: ({ payload, requestOptions }) => ({
          messages: [
            {
              content: `source:${String(requestOptions.metadata.source)}`,
              role: "user"
            }
          ],
          system: `${String(payload.system)} (${String(requestOptions.metadata.source)})`
        }),
        beforeProviderRequest: [
          ({ requestOptions }) => ({
            headers: {
              stale: null,
              "x-first": requestOptions.headers["x-base"]
            },
            metadata: {
              first: 1,
              source: "hook",
              stale: undefined
            }
          }),
          ({ requestOptions }) => ({
            headers: {
              "x-source": String(requestOptions.metadata.source)
            },
            metadata: {
              second: 2
            }
          })
        ]
      },
      payload: {
        messages: turnState.messages,
        modelId: turnState.model,
        system: turnState.systemPrompt,
        toolNames: Object.keys(turnState.tools)
      },
      requestOptions: {
        headers: {
          ...turnState.streamOptions.headers
        },
        metadata: {
          ...turnState.streamOptions.metadata
        }
      }
    })

    expect(prepared).toEqual({
      payload: {
        messages: [
          {
            content: "source:hook",
            role: "user"
          }
        ],
        modelId: "gpt-5",
        system: "Base system (hook)",
        toolNames: ["read"]
      },
      requestOptions: {
        headers: {
          "x-base": "base",
          "x-first": "base",
          "x-source": "hook"
        },
        metadata: {
          first: 1,
          second: 2,
          source: "hook"
        }
      }
    })
  })

  it("passes patched stream options to the main provider request", async () => {
    const harness = await createAgentRuntimeHarness({
      modelId: "mock-model",
      rootPath: mockedHomeDir,
      settings: AppSettingsSchema.parse({
        agents: {
          enabled: true
        }
      })
    })
    const streamHooks: AgentStreamHooks = {
      beforeProviderPayload: ({ requestOptions }) => ({
        system: `Hooked system ${String(requestOptions.metadata.source)}`
      }),
      beforeProviderRequest: [
        () => ({
          headers: {
            "x-runtime": "first"
          },
          metadata: {
            source: "runtime"
          }
        }),
        ({ requestOptions }) => ({
          headers: {
            "x-source": String(requestOptions.metadata.source)
          },
          metadata: {
            finalHook: true
          }
        })
      ]
    }

    harness.faux.setResponses([
      createFauxTextResponse("Stream options done.", {
        modelId: "mock-model"
      })
    ])

    const result = await harness.stream({
      messages: [
        {
          content: "Use stream options.",
          role: "user"
        }
      ] satisfies ModelMessage[],
      streamHooks,
      streamOptions: {
        headers: {
          "x-base": "base"
        },
        metadata: {
          source: "chat"
        }
      }
    })

    await result.consumeStream()

    const modelCall = harness.faux.model.doStreamCalls.at(-1)
    const promptJson = JSON.stringify(modelCall?.prompt)

    expect(modelCall?.headers).toEqual({
      "x-base": "base",
      "x-runtime": "first",
      "x-source": "runtime"
    })
    expect(promptJson).toContain("Hooked system runtime")
  })
})
