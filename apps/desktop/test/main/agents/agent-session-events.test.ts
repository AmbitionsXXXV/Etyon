import { describe, expect, it } from "vite-plus/test"

import type { AgentEvent } from "@/main/agents/agent-event-store"
import {
  buildAgentSessionTreeFromEvents,
  listPendingAgentSessionQueuedMessages
} from "@/main/agents/agent-session-events"

const createAgentEvent = (
  sequence: number,
  payload: AgentEvent["payload"]
): AgentEvent => ({
  createdAt: "2026-05-24T06:00:00.000Z",
  id: `event-${sequence}`,
  payload,
  runId: "run-1",
  sequence,
  type: "agent_session_entry_appended"
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
})
