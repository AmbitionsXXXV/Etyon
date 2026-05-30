import type { AgentUiStreamSnapshotsOutput } from "@etyon/rpc"
import type { UIMessage } from "ai"
import { describe, expect, it } from "vite-plus/test"

import {
  mergeAgentUiStreamSnapshots,
  resolveAgentUiStreamSnapshotInput
} from "@/renderer/lib/chat/agent-ui-stream-snapshots"

const createSnapshotResult = ({
  parts,
  runId = "run-1",
  sequence = 3,
  status = "running"
}: {
  parts: unknown[]
  runId?: string
  sequence?: number
  status?: NonNullable<AgentUiStreamSnapshotsOutput["run"]>["status"]
}): AgentUiStreamSnapshotsOutput => ({
  nextSequence: sequence,
  run: {
    chatSessionId: "session-1",
    errorMessage: null,
    finishedAt: null,
    id: runId,
    modelId: "openai/gpt-4.1",
    parentRunId: null,
    profileId: "coder",
    startedAt: "2026-05-30T00:00:00.000Z",
    status
  },
  snapshots: [
    {
      createdAt: "2026-05-30T00:00:01.000Z",
      eventId: `event-${sequence}`,
      parts,
      runId,
      sequence
    }
  ]
})

describe("agent UI stream snapshot helpers", () => {
  it("resolves cursor input from the latest projected assistant message", () => {
    const messages: UIMessage[] = [
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
            text: "partial",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ]

    expect(
      resolveAgentUiStreamSnapshotInput({
        cursor: {
          nextSequence: 4
        },
        messages,
        sessionId: "session-1"
      })
    ).toEqual({
      afterSequence: 4,
      runId: "run-1",
      sessionId: "session-1"
    })
  })

  it("appends the latest snapshot as a projected assistant message", () => {
    const messages: UIMessage[] = [
      {
        id: "user-1",
        parts: [
          {
            text: "Start",
            type: "text"
          }
        ],
        role: "user"
      }
    ]
    const result = createSnapshotResult({
      parts: [
        {
          text: "partial",
          type: "text"
        }
      ]
    })
    const merged = mergeAgentUiStreamSnapshots({
      messages,
      result
    })

    expect(merged.cursor).toEqual({
      nextSequence: 3,
      runId: "run-1"
    })
    expect(merged.shouldContinue).toBe(true)
    expect(merged.messages).toEqual([
      messages[0],
      {
        id: "agent-ui-stream-run-1",
        metadata: {
          agentProjection: {
            runId: "run-1",
            source: "agent_events"
          }
        },
        parts: [
          {
            text: "partial",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ])
  })

  it("updates an existing projected assistant message without duplicating it", () => {
    const messages: UIMessage[] = [
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
            text: "old partial",
            type: "text"
          }
        ],
        role: "assistant"
      }
    ]
    const result = createSnapshotResult({
      parts: [
        {
          text: "new partial",
          type: "text"
        }
      ],
      sequence: 5
    })
    const merged = mergeAgentUiStreamSnapshots({
      messages,
      result
    })

    expect(merged.messages).toHaveLength(1)
    expect(merged.messages[0]).toEqual({
      id: "assistant-1",
      metadata: {
        agentProjection: {
          runId: "run-1",
          source: "agent_events"
        }
      },
      parts: [
        {
          text: "new partial",
          type: "text"
        }
      ],
      role: "assistant"
    })
  })

  it("stops polling when the scoped run is terminal", () => {
    const messages: UIMessage[] = []
    const result: AgentUiStreamSnapshotsOutput = {
      nextSequence: 7,
      run: {
        chatSessionId: "session-1",
        errorMessage: null,
        finishedAt: "2026-05-30T00:00:02.000Z",
        id: "run-1",
        modelId: "openai/gpt-4.1",
        parentRunId: null,
        profileId: "coder",
        startedAt: "2026-05-30T00:00:00.000Z",
        status: "succeeded"
      },
      snapshots: []
    }

    expect(
      mergeAgentUiStreamSnapshots({
        messages,
        result
      })
    ).toEqual({
      cursor: {
        nextSequence: 7,
        runId: "run-1"
      },
      messages,
      shouldContinue: false
    })
  })
})
