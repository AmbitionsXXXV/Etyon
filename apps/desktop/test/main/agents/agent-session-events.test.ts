import { describe, expect, it } from "vite-plus/test"

import { AgentRuntimeError } from "@/main/agents/agent-errors"
import type { AgentEvent, AgentRun } from "@/main/agents/agent-event-store"
import {
  appendAgentSessionSavePointEvent,
  buildAgentSessionModelContextFromLatestSavePoint,
  buildAgentSessionTreeFromEvents,
  getLatestAgentSessionSavePoint,
  listPendingAgentSessionQueuedMessages
} from "@/main/agents/agent-session-events"

const createAgentEvent = (
  sequence: number,
  payload: AgentEvent["payload"],
  type = "agent_session_entry_appended"
): AgentEvent => ({
  createdAt: "2026-05-24T06:00:00.000Z",
  id: `event-${sequence}`,
  payload,
  runId: "run-1",
  sequence,
  type
})

describe("agent session events", () => {
  it("rebuilds model context from persisted session entry events", () => {
    const session = buildAgentSessionTreeFromEvents([
      createAgentEvent(1, {
        action: "appendMessage",
        message: {
          content: "Start.",
          role: "user",
          type: "model"
        }
      }),
      createAgentEvent(2, {
        action: "appendCustomMessage",
        message: {
          data: {
            runId: "run-1"
          },
          type: "agent-run-started"
        }
      }),
      createAgentEvent(3, {
        action: "appendMessage",
        message: {
          content: "Done.",
          role: "assistant",
          type: "model"
        }
      })
    ])

    expect(session.buildContext()).toEqual([
      {
        content: "Start.",
        role: "user",
        type: "model"
      },
      {
        content: "Done.",
        role: "assistant",
        type: "model"
      }
    ])
  })

  it("uses the latest save point as durable model context", () => {
    const events = [
      createAgentEvent(1, {
        action: "appendMessage",
        message: {
          content: "Start.",
          role: "user",
          type: "model"
        }
      }),
      createAgentEvent(
        2,
        {
          label: "provider-request-prepared",
          messages: [
            {
              content: "Start.",
              role: "user",
              type: "model"
            }
          ]
        },
        "agent_session_save_point_created"
      ),
      createAgentEvent(3, {
        action: "appendMessage",
        message: {
          content: "Intermediary response.",
          role: "assistant",
          type: "model"
        }
      }),
      createAgentEvent(
        4,
        {
          label: "provider-response-committed",
          messages: [
            {
              content: "Start.",
              role: "user",
              type: "model"
            },
            {
              content: "Committed response.",
              role: "assistant",
              type: "model"
            }
          ]
        },
        "agent_session_save_point_created"
      ),
      createAgentEvent(5, {
        action: "appendMessage",
        message: {
          content: "After latest save point.",
          role: "assistant",
          type: "model"
        }
      })
    ]

    expect(getLatestAgentSessionSavePoint(events)).toMatchObject({
      eventId: "event-4",
      label: "provider-response-committed",
      sequence: 4
    })
    expect(buildAgentSessionModelContextFromLatestSavePoint(events)).toEqual([
      {
        content: "Start.",
        role: "user",
        type: "model"
      },
      {
        content: "Committed response.",
        role: "assistant",
        type: "model"
      }
    ])
  })

  it("falls back to replaying session entries when no save point exists", () => {
    expect(
      buildAgentSessionModelContextFromLatestSavePoint([
        createAgentEvent(1, {
          action: "appendMessage",
          message: {
            content: "Start.",
            role: "user",
            type: "model"
          }
        }),
        createAgentEvent(2, {
          action: "appendMessage",
          message: {
            content: "Done.",
            role: "assistant",
            type: "model"
          }
        })
      ])
    ).toEqual([
      {
        content: "Start.",
        role: "user",
        type: "model"
      },
      {
        content: "Done.",
        role: "assistant",
        type: "model"
      }
    ])
  })

  it("appends session save point events", async () => {
    const appendedEvents: AgentEvent[] = []
    const fakeRun = {
      appendEvent: ({ payload, type }) => {
        const event = createAgentEvent(appendedEvents.length + 1, payload, type)
        appendedEvents.push(event)

        return Promise.resolve(event)
      },
      chatSessionId: "session-1",
      errorMessage: null,
      finishedAt: null,
      id: "run-1",
      modelId: "model-1",
      parentRunId: null,
      profileId: "default",
      startedAt: "2026-05-24T06:00:00.000Z",
      status: "running"
    } satisfies AgentRun

    await expect(
      appendAgentSessionSavePointEvent({
        label: "provider-request-prepared",
        messages: [
          {
            content: "Start.",
            role: "user"
          }
        ],
        run: fakeRun
      })
    ).resolves.toMatchObject({
      eventId: "event-1",
      label: "provider-request-prepared",
      messages: [
        {
          content: "Start.",
          role: "user",
          type: "model"
        }
      ]
    })
    expect(appendedEvents).toEqual([
      createAgentEvent(
        1,
        {
          label: "provider-request-prepared",
          messages: [
            {
              content: "Start.",
              role: "user",
              type: "model"
            }
          ]
        },
        "agent_session_save_point_created"
      )
    ])
  })

  it("lists queued messages that have not been replayed into model context", () => {
    expect(
      listPendingAgentSessionQueuedMessages([
        createAgentEvent(1, {
          action: "appendMessage",
          message: {
            content: "Start.",
            role: "user",
            type: "model"
          }
        }),
        createAgentEvent(2, {
          action: "appendCustomMessage",
          message: {
            data: {
              message: "Prefer concise output.",
              queue: "steer"
            },
            type: "steering"
          }
        }),
        createAgentEvent(3, {
          action: "appendCustomMessage",
          message: {
            data: {
              message: "Continue after the final answer.",
              queue: "follow-up"
            },
            type: "follow-up"
          }
        }),
        createAgentEvent(4, {
          action: "appendMessage",
          message: {
            content: "Prefer concise output.",
            role: "user",
            type: "model"
          }
        })
      ])
    ).toEqual([
      {
        createdAt: "2026-05-24T06:00:00.000Z",
        id: "event-3",
        message: "Continue after the final answer.",
        queue: "follow-up",
        runId: "run-1",
        sequence: 3
      }
    ])
  })

  it("applies queued message update, remove, and reorder events", () => {
    expect(
      listPendingAgentSessionQueuedMessages([
        createAgentEvent(1, {
          action: "appendCustomMessage",
          message: {
            data: {
              id: "queue-1",
              message: "First instruction.",
              queue: "steer"
            },
            type: "steering"
          }
        }),
        createAgentEvent(2, {
          action: "appendCustomMessage",
          message: {
            data: {
              id: "queue-2",
              message: "Second instruction.",
              queue: "follow-up"
            },
            type: "follow-up"
          }
        }),
        createAgentEvent(3, {
          action: "appendCustomMessage",
          message: {
            data: {
              id: "queue-1",
              message: "Updated first instruction.",
              queue: "follow-up"
            },
            type: "queued-message-updated"
          }
        }),
        createAgentEvent(4, {
          action: "appendCustomMessage",
          message: {
            data: {
              ids: ["queue-2", "queue-1"]
            },
            type: "queued-messages-reordered"
          }
        }),
        createAgentEvent(5, {
          action: "appendCustomMessage",
          message: {
            data: {
              id: "queue-2"
            },
            type: "queued-message-removed"
          }
        })
      ])
    ).toEqual([
      {
        createdAt: "2026-05-24T06:00:00.000Z",
        id: "queue-1",
        message: "Updated first instruction.",
        queue: "follow-up",
        runId: "run-1",
        sequence: 1
      }
    ])
  })

  it("consumes duplicate queued messages one item at a time by content", () => {
    expect(
      listPendingAgentSessionQueuedMessages([
        createAgentEvent(1, {
          action: "appendCustomMessage",
          message: {
            data: {
              id: "queue-1",
              message: "Same content.",
              queue: "steer"
            },
            type: "steering"
          }
        }),
        createAgentEvent(2, {
          action: "appendCustomMessage",
          message: {
            data: {
              id: "queue-2",
              message: "Same content.",
              queue: "follow-up"
            },
            type: "follow-up"
          }
        }),
        createAgentEvent(3, {
          action: "appendMessage",
          message: {
            content: "Same content.",
            role: "user",
            type: "model"
          }
        })
      ])
    ).toEqual([
      {
        createdAt: "2026-05-24T06:00:00.000Z",
        id: "queue-2",
        message: "Same content.",
        queue: "follow-up",
        runId: "run-1",
        sequence: 2
      }
    ])
  })

  it("rejects corrupted move events with a typed session error", () => {
    expect(() => {
      buildAgentSessionTreeFromEvents([
        createAgentEvent(1, {
          action: "moveTo",
          entryId: "missing-entry"
        })
      ])
    }).toThrow(AgentRuntimeError)

    try {
      buildAgentSessionTreeFromEvents([
        createAgentEvent(1, {
          action: "moveTo",
          entryId: "missing-entry"
        })
      ])
    } catch (error) {
      expect(error).toMatchObject({
        code: "session",
        message: "Unknown agent session tree entry: missing-entry"
      })
    }
  })
})
