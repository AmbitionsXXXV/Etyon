import type { ModelMessage } from "ai"
import { describe, expect, it } from "vite-plus/test"

import {
  buildProviderReadyModelMessages,
  completeUnresolvedToolCallsInModelMessages,
  convertAgentMessagesToLlm,
  formatAgentMessageForDebug
} from "@/main/agents/agent-messages"
import type { AgentMessage } from "@/main/agents/agent-messages"

declare module "@/main/agents/agent-messages" {
  interface CustomAgentMessages {
    checkpoint: {
      data: {
        checkpointId: string
      }
      type: "checkpoint"
    }
  }
}

describe("agent messages", () => {
  it("converts model-visible messages to LLM messages", () => {
    expect(
      convertAgentMessagesToLlm([
        {
          content: "System prompt",
          role: "system",
          type: "model"
        },
        {
          content: "User task",
          role: "user",
          type: "model"
        },
        {
          data: {
            runId: "run-1"
          },
          type: "agent-run-started"
        },
        {
          content: [
            {
              output: "tool result",
              toolCallId: "tool-call-1",
              toolName: "readFile",
              type: "tool-result"
            }
          ],
          role: "tool",
          type: "model"
        }
      ])
    ).toEqual([
      {
        content: "System prompt",
        role: "system"
      },
      {
        content: "User task",
        role: "user"
      },
      {
        content: [
          {
            output: "tool result",
            toolCallId: "tool-call-1",
            toolName: "readFile",
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    ])
  })

  it("completes unresolved assistant tool calls before a normal follow-up", () => {
    expect(
      completeUnresolvedToolCallsInModelMessages([
        {
          content: "Inspect files.",
          role: "user"
        },
        {
          content: [
            {
              input: {
                path: "src/value.ts"
              },
              toolCallId: "readFile:18",
              toolName: "readFile",
              type: "tool-call"
            },
            {
              input: {
                edits: [],
                path: "src/value.ts"
              },
              toolCallId: "editFile:18",
              toolName: "editFile",
              type: "tool-call"
            },
            {
              approvalId: "approval-18",
              toolCallId: "editFile:18",
              type: "tool-approval-request"
            }
          ],
          role: "assistant"
        },
        {
          content: "Continue without approving that tool batch.",
          role: "user"
        }
      ])
    ).toEqual([
      {
        content: "Inspect files.",
        role: "user"
      },
      {
        content: [
          {
            input: {
              path: "src/value.ts"
            },
            toolCallId: "readFile:18",
            toolName: "readFile",
            type: "tool-call"
          },
          {
            input: {
              edits: [],
              path: "src/value.ts"
            },
            toolCallId: "editFile:18",
            toolName: "editFile",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            output: {
              type: "error-text",
              value:
                "Tool execution did not complete before the next user message."
            },
            toolCallId: "readFile:18",
            toolName: "readFile",
            type: "tool-result"
          },
          {
            output: {
              type: "error-text",
              value:
                "Tool execution did not complete before the next user message."
            },
            toolCallId: "editFile:18",
            toolName: "editFile",
            type: "tool-result"
          }
        ],
        role: "tool"
      },
      {
        content: "Continue without approving that tool batch.",
        role: "user"
      }
    ])
  })

  it("keeps tool calls resolved by results and approval responses", () => {
    const messages = [
      {
        content: [
          {
            input: {
              path: "src/value.ts"
            },
            toolCallId: "readFile:18",
            toolName: "readFile",
            type: "tool-call"
          },
          {
            input: {
              edits: [],
              path: "src/value.ts"
            },
            toolCallId: "editFile:18",
            toolName: "editFile",
            type: "tool-call"
          },
          {
            approvalId: "approval-18",
            toolCallId: "editFile:18",
            type: "tool-approval-request"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            output: {
              type: "text",
              value: "file contents"
            },
            toolCallId: "readFile:18",
            toolName: "readFile",
            type: "tool-result"
          },
          {
            approvalId: "approval-18",
            approved: true,
            type: "tool-approval-response"
          }
        ],
        role: "tool"
      }
    ] satisfies ModelMessage[]

    expect(completeUnresolvedToolCallsInModelMessages(messages)).toEqual(
      messages
    )
  })

  it("keeps split approval requests attached to pending tool calls", () => {
    const messages = [
      {
        content: [
          {
            input: {
              command: "git diff --cached --stat"
            },
            toolCallId: "bash:18",
            toolName: "bash",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            approvalId: "approval-18",
            toolCallId: "bash:18",
            type: "tool-approval-request"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            approvalId: "approval-18",
            approved: true,
            type: "tool-approval-response"
          }
        ],
        role: "tool"
      }
    ] satisfies ModelMessage[]

    expect(completeUnresolvedToolCallsInModelMessages(messages)).toEqual(
      messages
    )
  })

  it("moves approved tool results back next to their matching tool calls for provider context", () => {
    const messages = [
      {
        content: "Inspect staged changes.",
        role: "user"
      },
      {
        content: [
          {
            input: {
              command: "git diff --cached --stat"
            },
            toolCallId: "bash:18",
            toolName: "bash",
            type: "tool-call"
          },
          {
            approvalId: "approval-18",
            toolCallId: "bash:18",
            type: "tool-approval-request"
          },
          {
            input: {
              command: "git diff --cached -- app.ts"
            },
            toolCallId: "bash:19",
            toolName: "bash",
            type: "tool-call"
          },
          {
            approvalId: "approval-19",
            toolCallId: "bash:19",
            type: "tool-approval-request"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            output: {
              type: "error-text",
              value:
                "Tool execution did not complete before the next user message."
            },
            toolCallId: "bash:19",
            toolName: "bash",
            type: "tool-result"
          }
        ],
        role: "tool"
      },
      {
        content: [
          {
            approvalId: "approval-19",
            approved: true,
            type: "tool-approval-response"
          }
        ],
        role: "tool"
      },
      {
        content: "Continue.",
        role: "user"
      }
    ] satisfies ModelMessage[]
    const providerMessages = buildProviderReadyModelMessages({
      messages,
      toolResultMessages: [
        {
          content: [
            {
              output: {
                type: "json",
                value: {
                  content: [{ text: "real diff" }]
                }
              },
              toolCallId: "bash:19",
              toolName: "bash",
              type: "tool-result"
            }
          ],
          role: "tool"
        }
      ]
    })

    expect(providerMessages).toEqual([
      {
        content: "Inspect staged changes.",
        role: "user"
      },
      {
        content: [
          {
            input: {
              command: "git diff --cached --stat"
            },
            toolCallId: "bash:18",
            toolName: "bash",
            type: "tool-call"
          },
          {
            input: {
              command: "git diff --cached -- app.ts"
            },
            toolCallId: "bash:19",
            toolName: "bash",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            output: {
              type: "json",
              value: {
                content: [{ text: "real diff" }]
              }
            },
            toolCallId: "bash:19",
            toolName: "bash",
            type: "tool-result"
          }
        ],
        role: "tool"
      },
      {
        content: [
          {
            output: {
              type: "error-text",
              value:
                "Tool execution did not complete before the next user message."
            },
            toolCallId: "bash:18",
            toolName: "bash",
            type: "tool-result"
          }
        ],
        role: "tool"
      },
      {
        content: "Continue.",
        role: "user"
      }
    ])
    expect(JSON.stringify(providerMessages)).not.toContain(
      "tool-approval-response"
    )
    expect(JSON.stringify(providerMessages)).not.toContain(
      "tool-approval-request"
    )
  })

  it("drops duplicate stale tool calls when building provider context", () => {
    const messages = [
      {
        content: [
          {
            input: {
              command: "git diff --cached -- a.ts"
            },
            toolCallId: "bash:19",
            toolName: "bash",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            output: {
              type: "json",
              value: "first"
            },
            toolCallId: "bash:19",
            toolName: "bash",
            type: "tool-result"
          }
        ],
        role: "tool"
      },
      {
        content: [
          {
            input: {
              command: "git diff --cached -- a.ts"
            },
            toolCallId: "bash:19",
            toolName: "bash",
            type: "tool-call"
          },
          {
            approvalId: "approval-19",
            toolCallId: "bash:19",
            type: "tool-approval-request"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            approvalId: "approval-19",
            approved: true,
            type: "tool-approval-response"
          }
        ],
        role: "tool"
      }
    ] satisfies ModelMessage[]

    expect(buildProviderReadyModelMessages({ messages })).toEqual([
      {
        content: [
          {
            input: {
              command: "git diff --cached -- a.ts"
            },
            toolCallId: "bash:19",
            toolName: "bash",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            output: {
              type: "json",
              value: "first"
            },
            toolCallId: "bash:19",
            toolName: "bash",
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    ])
  })

  it("formats custom agent messages for debug output", () => {
    expect(
      formatAgentMessageForDebug({
        data: {
          toolCallId: "tool-call-1",
          toolName: "readFile"
        },
        type: "agent-tool-event"
      })
    ).toBe(
      'agent-tool-event {"toolCallId":"tool-call-1","toolName":"readFile"}'
    )
  })

  it("supports declaration-merged custom messages", () => {
    const message: AgentMessage = {
      data: {
        checkpointId: "checkpoint-1"
      },
      type: "checkpoint"
    }

    expect(formatAgentMessageForDebug(message)).toBe(
      'checkpoint {"checkpointId":"checkpoint-1"}'
    )
  })
})
