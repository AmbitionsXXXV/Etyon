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
