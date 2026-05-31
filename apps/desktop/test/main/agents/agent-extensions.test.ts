import { describe, expect, it } from "vite-plus/test"
import * as z from "zod"

import {
  createAgentExtensionRunner,
  loadAgentExtensions
} from "@/main/agents/agent-extensions"
import type { AgentExtensionRegistrationContext } from "@/main/agents/agent-extensions"
import {
  applyAgentStreamResponseHooks,
  prepareAgentStreamRequest
} from "@/main/agents/agent-stream-hooks"

describe("agent extensions", () => {
  it("registers tools and filters them by profile and selected skill capability", async () => {
    const events: string[] = []
    const runner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "echo-extension",
          register: (context: AgentExtensionRegistrationContext) => {
            context.on("*", (event) => {
              events.push(event.type)
            })
            context.registerTool({
              description: "Echo a message for extension tests.",
              execute: ({ message }) => message,
              inputSchema: z.object({
                message: z.string()
              }),
              name: "etyonEcho",
              profiles: ["coder"],
              requiredSkillCapabilities: ["extension.echo"],
              riskLevel: "safe"
            })
          }
        }
      ]
    })

    expect(
      runner.listTools({
        profileId: "coder",
        skillCapabilities: ["extension.echo"]
      })
    ).toHaveLength(1)
    expect(
      runner.listTools({
        profileId: "coder",
        skillCapabilities: []
      })
    ).toEqual([])
    expect(
      runner.listTools({
        profileId: "review",
        skillCapabilities: ["extension.echo"]
      })
    ).toEqual([])
    expect(events).toEqual(["tool_registered"])
  })

  it("filters extension tools by risk when approval tools are excluded", async () => {
    const runner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "risk-extension",
          register: (context: AgentExtensionRegistrationContext) => {
            context.registerTool({
              description: "Safe extension tool.",
              execute: () => "safe",
              inputSchema: z.object({}),
              name: "etyonSafeExtension",
              riskLevel: "safe"
            })
            context.registerTool({
              capabilities: ["network"],
              description: "External lookup extension tool.",
              execute: () => "network",
              inputSchema: z.object({}),
              name: "etyonNetworkExtension",
              riskLevel: "high"
            })
            context.registerTool({
              description: "Default risk extension tool.",
              execute: () => "default",
              inputSchema: z.object({}),
              name: "etyonDefaultRiskExtension"
            })
            context.registerTool({
              description: "Safe but approval-gated extension tool.",
              execute: () => "approval",
              inputSchema: z.object({}),
              name: "etyonApprovalExtension",
              requiresApproval: true,
              riskLevel: "safe"
            })
          }
        }
      ]
    })

    expect(
      runner
        .listTools({
          profileId: "coder"
        })
        .map(({ capabilities, name, owner, riskLevel }) => ({
          capabilities,
          name,
          owner,
          riskLevel
        }))
    ).toEqual([
      {
        capabilities: [],
        name: "etyonSafeExtension",
        owner: "skill",
        riskLevel: "safe"
      },
      {
        capabilities: ["network"],
        name: "etyonNetworkExtension",
        owner: "skill",
        riskLevel: "high"
      },
      {
        capabilities: [],
        name: "etyonDefaultRiskExtension",
        owner: "skill",
        riskLevel: "medium"
      },
      {
        capabilities: [],
        name: "etyonApprovalExtension",
        owner: "skill",
        riskLevel: "safe"
      }
    ])
    expect(
      runner
        .listTools({
          includeApprovalTools: false,
          profileId: "coder"
        })
        .map(({ name }) => name)
    ).toEqual(["etyonSafeExtension"])
  })

  it("registers structured tool packages with owner metadata and hooks", async () => {
    const runner = await createAgentExtensionRunner({
      toolPackages: [
        {
          id: "project-tool-package",
          owner: "project",
          toolHooks: [
            {
              beforeToolCall: () => ({
                input: {
                  projectHook: true
                }
              }),
              profiles: ["coder"],
              requiredSkillCapabilities: ["project.tools"]
            }
          ],
          tools: [
            {
              capabilities: ["read-fs"],
              description: "Project package file reader.",
              execute: () => "package-read",
              inputSchema: z.object({}),
              name: "etyonProjectRead",
              profiles: ["coder"],
              requiredSkillCapabilities: ["project.tools"],
              riskLevel: "safe"
            }
          ]
        },
        {
          id: "mcp-tool-package",
          owner: "mcp",
          streamHooks: [
            {
              beforeProviderPayload: () => ({
                mcpPackage: true
              }),
              profiles: ["coder"],
              requiredSkillCapabilities: ["project.tools"]
            }
          ],
          tools: [
            {
              capabilities: ["network"],
              description: "MCP package lookup.",
              execute: () => "mcp",
              inputSchema: z.object({}),
              name: "etyonMcpLookup",
              profiles: ["coder"],
              requiredSkillCapabilities: ["project.tools"],
              riskLevel: "high"
            }
          ]
        }
      ]
    })

    expect(
      runner
        .listTools({
          profileId: "coder",
          skillCapabilities: ["project.tools"]
        })
        .map(({ extensionId, name, owner, riskLevel }) => ({
          extensionId,
          name,
          owner,
          riskLevel
        }))
    ).toEqual([
      {
        extensionId: "project-tool-package",
        name: "etyonProjectRead",
        owner: "project",
        riskLevel: "safe"
      },
      {
        extensionId: "mcp-tool-package",
        name: "etyonMcpLookup",
        owner: "mcp",
        riskLevel: "high"
      }
    ])
    expect(
      runner
        .listTools({
          includeApprovalTools: false,
          profileId: "coder",
          skillCapabilities: ["project.tools"]
        })
        .map(({ name }) => name)
    ).toEqual(["etyonProjectRead"])

    const toolHooks = runner.getToolHooks({
      profileId: "coder",
      skillCapabilities: ["project.tools"]
    })
    const streamHooks = runner.getStreamHooks({
      profileId: "coder",
      skillCapabilities: ["project.tools"]
    })

    await expect(
      toolHooks?.beforeToolCall?.(
        {
          input: {},
          toolCallId: "package-call-1",
          toolName: "etyonProjectRead"
        },
        {
          messages: [],
          toolCall: {
            input: {},
            toolCallId: "package-call-1",
            toolName: "etyonProjectRead"
          }
        }
      )
    ).resolves.toEqual({
      input: {
        projectHook: true
      }
    })
    await expect(
      prepareAgentStreamRequest({
        hooks: streamHooks,
        payload: {},
        requestOptions: {
          headers: {},
          metadata: {}
        }
      })
    ).resolves.toMatchObject({
      payload: {
        mcpPackage: true
      }
    })
  })

  it("rejects built-in and duplicate tool names", async () => {
    await expect(
      createAgentExtensionRunner({
        extensions: [
          {
            id: "bad-extension",
            register: (context: AgentExtensionRegistrationContext) => {
              context.registerTool({
                description: "Shadows a built-in tool.",
                execute: () => "bad",
                inputSchema: z.object({}),
                name: "read"
              })
            }
          }
        ]
      })
    ).rejects.toThrow("shadows built-in tool")

    await expect(
      createAgentExtensionRunner({
        extensions: [
          {
            id: "duplicate-extension",
            register: (context: AgentExtensionRegistrationContext) => {
              const definition = {
                description: "Duplicate extension tool.",
                execute: () => "bad",
                inputSchema: z.object({}),
                name: "etyonDuplicate"
              }

              context.registerTool(definition)
              context.registerTool(definition)
            }
          }
        ]
      })
    ).rejects.toThrow("Duplicate agent extension tool")
  })

  it("registers stream hooks and filters them by profile and selected skill capability", async () => {
    const responses: unknown[] = []
    const runner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "stream-extension",
          register: (context: AgentExtensionRegistrationContext) => {
            context.registerStreamHooks({
              afterProviderResponse: ({ response }) => {
                responses.push(response)
              },
              beforeProviderPayload: () => ({
                extensionPayload: true
              }),
              beforeProviderRequest: () => ({
                headers: {
                  "x-extension-hook": "enabled"
                },
                metadata: {
                  extensionHook: true
                }
              }),
              profiles: ["coder"],
              requiredSkillCapabilities: ["extension.stream"]
            })
          }
        }
      ]
    })

    const filteredHooks = runner.getStreamHooks({
      profileId: "coder",
      skillCapabilities: ["extension.stream"]
    })
    const missingCapabilityHooks = runner.getStreamHooks({
      profileId: "coder",
      skillCapabilities: []
    })
    const missingProfileHooks = runner.getStreamHooks({
      profileId: "review",
      skillCapabilities: ["extension.stream"]
    })
    const prepared = await prepareAgentStreamRequest({
      hooks: filteredHooks,
      payload: {
        originalPayload: true
      },
      requestOptions: {
        headers: {},
        metadata: {}
      }
    })

    await applyAgentStreamResponseHooks({
      hooks: filteredHooks,
      response: {
        status: "succeeded"
      }
    })

    expect(missingCapabilityHooks).toBeUndefined()
    expect(missingProfileHooks).toBeUndefined()
    expect(prepared).toEqual({
      payload: {
        extensionPayload: true,
        originalPayload: true
      },
      requestOptions: {
        headers: {
          "x-extension-hook": "enabled"
        },
        metadata: {
          extensionHook: true
        }
      }
    })
    expect(responses).toEqual([
      {
        status: "succeeded"
      }
    ])
  })

  it("registers tool hooks and filters them by profile and selected skill capability", async () => {
    const runner = await createAgentExtensionRunner({
      extensions: [
        {
          id: "tool-hook-extension",
          register: (context: AgentExtensionRegistrationContext) => {
            context.registerToolHooks({
              afterToolCall: (result) => ({
                output: {
                  patched: true,
                  value: result.output
                }
              }),
              beforeToolCall: (toolCall) => ({
                input: {
                  path: `${String((toolCall.input as { path: string }).path)}.patched`
                }
              }),
              profiles: ["coder"],
              requiredSkillCapabilities: ["extension.tool-hooks"]
            })
          }
        }
      ]
    })

    const filteredHooks = runner.getToolHooks({
      profileId: "coder",
      skillCapabilities: ["extension.tool-hooks"]
    })
    const missingCapabilityHooks = runner.getToolHooks({
      profileId: "coder",
      skillCapabilities: []
    })
    const missingProfileHooks = runner.getToolHooks({
      profileId: "review",
      skillCapabilities: ["extension.tool-hooks"]
    })
    const beforeResult = await filteredHooks?.beforeToolCall?.(
      {
        input: {
          path: "package.json"
        },
        toolCallId: "tool-1",
        toolName: "read"
      },
      {
        messages: [],
        toolCall: {
          input: {
            path: "package.json"
          },
          toolCallId: "tool-1",
          toolName: "read"
        }
      }
    )
    const afterResult = await filteredHooks?.afterToolCall?.(
      {
        isError: false,
        output: {
          content: "ok"
        },
        sourceIndex: 0,
        terminate: false,
        toolCall: {
          input: {
            path: "package.json.patched"
          },
          toolCallId: "tool-1",
          toolName: "read"
        }
      },
      {
        messages: [],
        result: {
          isError: false,
          output: {
            content: "ok"
          },
          sourceIndex: 0,
          terminate: false,
          toolCall: {
            input: {
              path: "package.json.patched"
            },
            toolCallId: "tool-1",
            toolName: "read"
          }
        }
      }
    )

    expect(missingCapabilityHooks).toBeUndefined()
    expect(missingProfileHooks).toBeUndefined()
    expect(beforeResult).toEqual({
      input: {
        path: "package.json.patched"
      }
    })
    expect(afterResult).toEqual({
      isError: false,
      output: {
        patched: true,
        value: {
          content: "ok"
        }
      },
      terminate: false
    })
  })

  it("loads extension factories from module exports", async () => {
    const runner = await loadAgentExtensions({
      importer: () =>
        Promise.resolve({
          default: () => ({
            id: "loaded-extension",
            register: (context: AgentExtensionRegistrationContext) => {
              context.registerTool({
                description: "Loaded extension tool.",
                execute: () => "loaded",
                inputSchema: z.object({}),
                name: "etyonLoaded"
              })
            }
          })
        }),
      paths: ["/tmp/etyon-loaded-extension.mjs"]
    })

    expect(
      runner.listTools({
        profileId: "coder"
      })
    ).toHaveLength(1)
  })
})
