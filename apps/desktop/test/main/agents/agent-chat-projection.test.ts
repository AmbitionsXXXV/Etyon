import type { UIMessage } from "ai"
import { describe, expect, it } from "vite-plus/test"

import {
  buildAgentChatProjectionMessages,
  getLatestAgentChatProjectionBranch,
  mergeAgentEventProjectionIntoChatMessages,
  selectAgentChatProjectionPrefixMessages
} from "@/main/agents/agent-chat-projection"
import type { AgentEvent } from "@/main/agents/agent-event-store"

const createAgentEvent = (
  sequence: number,
  payload: AgentEvent["payload"],
  type = "agent_session_entry_appended"
): AgentEvent => ({
  createdAt: "2026-05-30T00:00:00.000Z",
  id: `event-${sequence}`,
  payload,
  runId: "run-1",
  sequence,
  type
})

describe("agent chat projection", () => {
  it("projects session model events into chat messages with folded tool output", () => {
    const messages = buildAgentChatProjectionMessages({
      events: [
        createAgentEvent(1, {
          action: "appendMessage",
          message: {
            content: "Read package metadata.",
            role: "user",
            type: "model"
          }
        }),
        createAgentEvent(2, {
          action: "appendMessage",
          message: {
            content: [
              {
                text: "Reading package metadata.",
                type: "text"
              },
              {
                input: {
                  path: "package.json"
                },
                toolCallId: "tool-1",
                toolName: "read",
                type: "tool-call"
              }
            ],
            role: "assistant",
            type: "model"
          }
        }),
        createAgentEvent(3, {
          action: "appendMessage",
          message: {
            content: [
              {
                output: {
                  type: "text",
                  value: '{"name":"etyon"}'
                },
                toolCallId: "tool-1",
                toolName: "read",
                type: "tool-result"
              }
            ],
            role: "tool",
            type: "model"
          }
        }),
        createAgentEvent(4, {
          action: "appendMessage",
          message: {
            content: "Done.",
            role: "assistant",
            type: "model"
          }
        })
      ],
      runId: "run-1"
    })

    expect(messages).toEqual([
      {
        id: "agent-run-1-0-user",
        parts: [
          {
            text: "Read package metadata.",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "agent-run-1-1-assistant",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "Reading package metadata.",
            type: "text"
          },
          {
            input: {
              path: "package.json"
            },
            output: '{"name":"etyon"}',
            state: "output-available",
            toolCallId: "tool-1",
            toolName: "read",
            type: "dynamic-tool"
          }
        ],
        role: "assistant"
      },
      {
        id: "agent-run-1-3-assistant",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "Done.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ])
  })

  it("projects persisted split approval responses through approval ids", () => {
    const pendingMessages = buildAgentChatProjectionMessages({
      events: [
        createAgentEvent(1, {
          action: "appendMessage",
          message: {
            content: "Write a file.",
            role: "user",
            type: "model"
          }
        }),
        createAgentEvent(2, {
          action: "appendMessage",
          message: {
            content: [
              {
                input: {
                  content: "generated",
                  path: "generated.txt"
                },
                toolCallId: "write-call-1",
                toolName: "write",
                type: "tool-call"
              },
              {
                approvalId: "approval-write-1",
                toolCallId: "write-call-1",
                type: "tool-approval-request"
              }
            ],
            role: "assistant",
            type: "model"
          }
        })
      ],
      runId: "run-1"
    })

    expect(pendingMessages[1]?.parts).toEqual([
      {
        approval: {
          id: "approval-write-1"
        },
        input: {
          content: "generated",
          path: "generated.txt"
        },
        state: "approval-requested",
        toolCallId: "write-call-1",
        toolName: "write",
        type: "dynamic-tool"
      }
    ])

    const respondedMessages = buildAgentChatProjectionMessages({
      events: [
        createAgentEvent(1, {
          action: "appendMessage",
          message: {
            content: "Write a file.",
            role: "user",
            type: "model"
          }
        }),
        createAgentEvent(2, {
          action: "appendMessage",
          message: {
            content: [
              {
                input: {
                  content: "generated",
                  path: "generated.txt"
                },
                toolCallId: "write-call-1",
                toolName: "write",
                type: "tool-call"
              },
              {
                approvalId: "approval-write-1",
                toolCallId: "write-call-1",
                type: "tool-approval-request"
              }
            ],
            role: "assistant",
            type: "model"
          }
        }),
        createAgentEvent(3, {
          action: "appendMessage",
          message: {
            content: [
              {
                approvalId: "approval-write-1",
                approved: false,
                reason: "Do not write this file.",
                type: "tool-approval-response"
              }
            ],
            role: "tool",
            type: "model"
          }
        })
      ],
      runId: "run-1"
    })

    expect(respondedMessages[1]?.parts).toEqual([
      {
        approval: {
          id: "approval-write-1"
        },
        input: {
          content: "generated",
          path: "generated.txt"
        },
        state: "approval-responded",
        toolCallId: "write-call-1",
        toolName: "write",
        type: "dynamic-tool"
      }
    ])
  })

  it("merges approval-resume assistant continuation into the original assistant message", () => {
    const messages = buildAgentChatProjectionMessages({
      events: [
        createAgentEvent(1, {
          action: "appendMessage",
          message: {
            content: "Update the file.",
            role: "user",
            type: "model"
          }
        }),
        createAgentEvent(2, {
          action: "appendMessage",
          message: {
            content: [
              {
                text: "I will update the file.",
                type: "text"
              },
              {
                input: {
                  content: "updated",
                  path: "generated.txt"
                },
                toolCallId: "write-call-1",
                toolName: "write",
                type: "tool-call"
              },
              {
                approvalId: "approval-write-1",
                toolCallId: "write-call-1",
                toolName: "write",
                type: "tool-approval-request"
              }
            ],
            role: "assistant",
            type: "model"
          }
        }),
        createAgentEvent(3, {
          action: "appendMessage",
          message: {
            content: [
              {
                approvalId: "approval-write-1",
                approved: true,
                type: "tool-approval-response"
              }
            ],
            role: "tool",
            type: "model"
          }
        }),
        createAgentEvent(4, {
          action: "appendMessage",
          message: {
            content: [
              {
                output: {
                  type: "json",
                  value: {
                    ok: true
                  }
                },
                toolCallId: "write-call-1",
                toolName: "write",
                type: "tool-result"
              }
            ],
            role: "tool",
            type: "model"
          }
        }),
        createAgentEvent(5, {
          action: "appendMessage",
          message: {
            content: "Done updating the file.",
            role: "assistant",
            type: "model"
          }
        })
      ],
      runId: "run-1"
    })

    expect(messages).toEqual([
      {
        id: "agent-run-1-0-user",
        parts: [
          {
            text: "Update the file.",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "agent-run-1-1-assistant",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "I will update the file.",
            type: "text"
          },
          {
            approval: {
              id: "approval-write-1"
            },
            input: {
              content: "updated",
              path: "generated.txt"
            },
            output: {
              ok: true
            },
            state: "output-available",
            toolCallId: "write-call-1",
            toolName: "write",
            type: "dynamic-tool"
          },
          {
            text: "Done updating the file.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ])
  })

  it("merges approval-only assistant resume entries into the original assistant message", () => {
    const messages = buildAgentChatProjectionMessages({
      events: [
        createAgentEvent(1, {
          action: "appendMessage",
          message: {
            content: "Check staged changes.",
            role: "user",
            type: "model"
          }
        }),
        createAgentEvent(2, {
          action: "appendMessage",
          message: {
            content: [
              {
                input: {
                  command: "git diff --staged"
                },
                toolCallId: "bash:18",
                toolName: "bash",
                type: "tool-call"
              },
              {
                approvalId: "approval-bash-1",
                input: {
                  command: "git diff --staged"
                },
                toolCallId: "bash:18",
                toolName: "bash",
                type: "tool-approval-request"
              }
            ],
            role: "assistant",
            type: "model"
          }
        }),
        createAgentEvent(3, {
          action: "appendMessage",
          message: {
            content: [
              {
                approvalId: "approval-bash-1",
                toolCallId: "bash:18",
                type: "tool-approval-request"
              }
            ],
            role: "assistant",
            type: "model"
          }
        }),
        createAgentEvent(4, {
          action: "appendMessage",
          message: {
            content: [
              {
                approvalId: "approval-bash-1",
                approved: true,
                type: "tool-approval-response"
              }
            ],
            role: "tool",
            type: "model"
          }
        }),
        createAgentEvent(5, {
          action: "appendMessage",
          message: {
            content: [
              {
                output: {
                  type: "text",
                  value: "(no output)"
                },
                toolCallId: "bash:18",
                toolName: "bash",
                type: "tool-result"
              }
            ],
            role: "tool",
            type: "model"
          }
        }),
        createAgentEvent(6, {
          action: "appendMessage",
          message: {
            content: "当前暂存区为空。",
            role: "assistant",
            type: "model"
          }
        })
      ],
      runId: "run-1"
    })

    expect(messages).toEqual([
      {
        id: "agent-run-1-0-user",
        parts: [
          {
            text: "Check staged changes.",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "agent-run-1-1-assistant",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          }
        },
        parts: [
          {
            approval: {
              id: "approval-bash-1"
            },
            input: {
              command: "git diff --staged"
            },
            output: "(no output)",
            state: "output-available",
            toolCallId: "bash:18",
            toolName: "bash",
            type: "dynamic-tool"
          },
          {
            text: "当前暂存区为空。",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ])
  })

  it("projects the latest active UI stream snapshot before terminal run events", () => {
    const messages = buildAgentChatProjectionMessages({
      events: [
        createAgentEvent(1, {
          action: "appendMessage",
          message: {
            content: "Inspect the project.",
            role: "user",
            type: "model"
          }
        }),
        createAgentEvent(
          2,
          {
            parts: [
              {
                text: "Reading files...",
                type: "text"
              },
              {
                input: {
                  path: "package.json"
                },
                state: "input-available",
                toolCallId: "tool-1",
                toolName: "read",
                type: "dynamic-tool"
              }
            ]
          },
          "agent_ui_stream_snapshot_created"
        )
      ],
      runId: "run-1"
    })

    expect(messages).toEqual([
      {
        id: "agent-run-1-0-user",
        parts: [
          {
            text: "Inspect the project.",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "agent-run-1-1-assistant",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "Reading files...",
            type: "text"
          },
          {
            input: {
              path: "package.json"
            },
            state: "input-available",
            toolCallId: "tool-1",
            toolName: "read",
            type: "dynamic-tool"
          }
        ],
        role: "assistant"
      }
    ])

    expect(
      buildAgentChatProjectionMessages({
        events: [
          createAgentEvent(1, {
            action: "appendMessage",
            message: {
              content: "Inspect the project.",
              role: "user",
              type: "model"
            }
          }),
          createAgentEvent(
            2,
            {
              parts: [
                {
                  text: "Ignore this after finish.",
                  type: "text"
                }
              ]
            },
            "agent_ui_stream_snapshot_created"
          ),
          createAgentEvent(
            3,
            {
              finishReason: "stop"
            },
            "agent_run_finished"
          )
        ],
        runId: "run-1"
      })
    ).toEqual([
      {
        id: "agent-run-1-0-user",
        parts: [
          {
            text: "Inspect the project.",
            type: "text"
          }
        ],
        role: "user"
      }
    ])
  })

  it("merges event-derived assistant suffix into persisted chat messages", () => {
    const messages: UIMessage[] = [
      {
        id: "user-1",
        parts: [
          {
            text: "Fix the runtime.",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "runtime-assistant-1",
        metadata: {
          workTimeMs: 42
        },
        parts: [
          {
            text: "Runtime stream text.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ]

    expect(
      mergeAgentEventProjectionIntoChatMessages({
        events: [
          createAgentEvent(1, {
            action: "appendMessage",
            message: {
              content: "Fix the runtime.",
              role: "user",
              type: "model"
            }
          }),
          createAgentEvent(2, {
            action: "appendMessage",
            message: {
              content: "Event-derived response.",
              role: "assistant",
              type: "model"
            }
          })
        ],
        messages,
        originalMessageCount: 1,
        runId: "run-1"
      })
    ).toEqual([
      messages[0],
      {
        id: "agent-run-1-1-assistant",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          },
          workTimeMs: 42
        },
        parts: [
          {
            text: "Event-derived response.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ])
  })

  it("strips trailing assistant from prefix when approval resume adds projected suffix", () => {
    const messages: UIMessage[] = [
      {
        id: "user-1",
        parts: [
          {
            text: "Update the file.",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "assistant-from-first-stream",
        parts: [
          {
            text: "I will update the file.",
            type: "text"
          }
        ],
        role: "assistant"
      },
      {
        id: "assistant-from-second-stream",
        parts: [
          {
            text: "Done updating the file.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ]

    const result = mergeAgentEventProjectionIntoChatMessages({
      events: [
        createAgentEvent(1, {
          action: "appendMessage",
          message: {
            content: "Update the file.",
            role: "user",
            type: "model"
          }
        }),
        createAgentEvent(2, {
          action: "appendMessage",
          message: {
            content: [
              {
                text: "I will update the file.",
                type: "text"
              },
              {
                input: {
                  content: "updated",
                  path: "generated.txt"
                },
                toolCallId: "write-call-1",
                toolName: "write",
                type: "tool-call"
              },
              {
                approvalId: "approval-write-1",
                toolCallId: "write-call-1",
                toolName: "write",
                type: "tool-approval-request"
              }
            ],
            role: "assistant",
            type: "model"
          }
        }),
        createAgentEvent(3, {
          action: "appendMessage",
          message: {
            content: [
              {
                approvalId: "approval-write-1",
                approved: true,
                type: "tool-approval-response"
              }
            ],
            role: "tool",
            type: "model"
          }
        }),
        createAgentEvent(4, {
          action: "appendMessage",
          message: {
            content: [
              {
                output: {
                  type: "json",
                  value: {
                    ok: true
                  }
                },
                toolCallId: "write-call-1",
                toolName: "write",
                type: "tool-result"
              }
            ],
            role: "tool",
            type: "model"
          }
        }),
        createAgentEvent(5, {
          action: "appendMessage",
          message: {
            content: "Done updating the file.",
            role: "assistant",
            type: "model"
          }
        })
      ],
      messages,
      originalMessageCount: 2,
      runId: "run-1"
    })

    const assistantMessages = result.filter((m) => m.role === "assistant")

    expect(assistantMessages).toHaveLength(1)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(messages[0])
    expect(result[1].role).toBe("assistant")
    expect(result[1].metadata).toMatchObject({
      continuation: true
    })
    expect(result[1].parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "I will update the file.",
          type: "text"
        }),
        expect.objectContaining({
          text: "Done updating the file.",
          type: "text"
        })
      ])
    )
  })

  it("keeps projected user messages when active repair starts after persisted history", () => {
    const previousUserMessage: UIMessage = {
      id: "user-1",
      parts: [
        {
          text: "Earlier question.",
          type: "text"
        }
      ],
      role: "user"
    }
    const previousAssistantMessage: UIMessage = {
      id: "assistant-1",
      parts: [
        {
          text: "Earlier answer.",
          type: "text"
        }
      ],
      role: "assistant"
    }
    const messages: UIMessage[] = [
      previousUserMessage,
      previousAssistantMessage
    ]

    expect(
      mergeAgentEventProjectionIntoChatMessages({
        events: [
          createAgentEvent(1, {
            action: "appendMessage",
            message: {
              content: "Earlier question.",
              role: "user",
              type: "model"
            }
          }),
          createAgentEvent(2, {
            action: "appendMessage",
            message: {
              content: "Earlier answer.",
              role: "assistant",
              type: "model"
            }
          }),
          createAgentEvent(3, {
            action: "appendMessage",
            message: {
              content: "Current prompt.",
              role: "user",
              type: "model"
            }
          }),
          createAgentEvent(
            4,
            {
              parts: [
                {
                  text: "Working on current prompt.",
                  type: "text"
                }
              ]
            },
            "agent_ui_stream_snapshot_created"
          )
        ],
        includeProjectedUserMessages: true,
        messages,
        originalMessageCount: messages.length,
        runId: "run-1"
      })
    ).toEqual([
      previousUserMessage,
      previousAssistantMessage,
      {
        id: "agent-run-1-2-user",
        parts: [
          {
            text: "Current prompt.",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "agent-run-1-3-assistant",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "Working on current prompt.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ])
  })

  it("returns full projected messages when active repair has no persisted prefix", () => {
    expect(
      mergeAgentEventProjectionIntoChatMessages({
        events: [
          createAgentEvent(1, {
            action: "appendMessage",
            message: {
              content: "Current prompt.",
              role: "user",
              type: "model"
            }
          }),
          createAgentEvent(
            2,
            {
              parts: [
                {
                  text: "Working on current prompt.",
                  type: "text"
                }
              ]
            },
            "agent_ui_stream_snapshot_created"
          )
        ],
        includeProjectedUserMessages: true,
        messages: [],
        originalMessageCount: 0,
        runId: "run-1"
      })
    ).toEqual([
      {
        id: "agent-run-1-0-user",
        parts: [
          {
            text: "Current prompt.",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "agent-run-1-1-assistant",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "Working on current prompt.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ])
  })

  it("falls back to stream messages when no event-derived suffix exists", () => {
    const messages: UIMessage[] = [
      {
        id: "user-1",
        parts: [
          {
            text: "Hello",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "assistant-1",
        parts: [
          {
            text: "Hello.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ]

    expect(
      mergeAgentEventProjectionIntoChatMessages({
        events: [],
        messages,
        originalMessageCount: 1,
        runId: "run-1"
      })
    ).toEqual([
      messages[0],
      {
        id: "assistant-1",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "Hello.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ])
  })

  it("selects the retained chat branch prefix for projection repair", () => {
    const events = [
      createAgentEvent(1, {
        action: "appendCustomMessage",
        message: {
          data: {
            branchKind: "regenerate",
            messageId: "assistant-1",
            retainedMessageCount: 1,
            retainedMessageIds: ["user-1"],
            trigger: "regenerate-message"
          },
          type: "chat-branch"
        }
      })
    ]
    const messages: UIMessage[] = [
      {
        id: "user-1",
        parts: [
          {
            text: "Regenerate this.",
            type: "text"
          }
        ],
        role: "user"
      },
      {
        id: "assistant-1",
        parts: [
          {
            text: "Old answer.",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ]

    expect(getLatestAgentChatProjectionBranch(events)).toEqual({
      branchKind: "regenerate",
      messageId: "assistant-1",
      retainedMessageIds: ["user-1"],
      trigger: "regenerate-message"
    })
    expect(
      selectAgentChatProjectionPrefixMessages({
        events,
        fallbackMessageCount: 2,
        messages
      })
    ).toEqual([messages[0]])
  })
})
