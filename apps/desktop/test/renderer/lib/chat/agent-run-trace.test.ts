import { describe, expect, it } from "vite-plus/test"

import {
  buildAgentRunGraphPreviewDisplay,
  buildAgentRunGraphPreview,
  buildAgentRunTracePreview,
  getAgentRunIdFromToolOutput
} from "@/renderer/lib/chat/agent-run-trace"

describe("agent run trace helpers", () => {
  it("extracts a child run id from delegation tool output", () => {
    expect(getAgentRunIdFromToolOutput({ subRunId: "run-child-1" })).toBe(
      "run-child-1"
    )
    expect(getAgentRunIdFromToolOutput({ subRunId: null })).toBeNull()
    expect(getAgentRunIdFromToolOutput("run-child-1")).toBeNull()
  })

  it("builds a bounded preview for child run trace data", () => {
    const preview = buildAgentRunTracePreview(
      {
        events: [
          {
            createdAt: "2026-05-24T00:00:00.000Z",
            id: "event-1",
            payload: { step: 1 },
            runId: "run-child-1",
            sequence: 1,
            type: "agent_run_started"
          },
          {
            createdAt: "2026-05-24T00:00:01.000Z",
            id: "event-2",
            payload: { toolName: "readFile" },
            runId: "run-child-1",
            sequence: 2,
            type: "tool_call_started"
          },
          {
            createdAt: "2026-05-24T00:00:02.000Z",
            id: "event-3",
            payload: "done",
            runId: "run-child-1",
            sequence: 3,
            type: "agent_run_finished"
          }
        ],
        run: {
          chatSessionId: "session-1",
          errorMessage: null,
          finishedAt: null,
          id: "run-child-1",
          modelId: "openai/gpt-4.1",
          parentRunId: "run-parent-1",
          profileId: "explore",
          startedAt: "2026-05-24T00:00:00.000Z",
          status: "succeeded"
        },
        toolCalls: [
          {
            approvalState: "not_required",
            errorMessage: null,
            finishedAt: "2026-05-24T00:00:02.000Z",
            id: "tool-1",
            input: { path: "README.md" },
            output: { content: "README" },
            parentToolCallId: null,
            runId: "run-child-1",
            startedAt: "2026-05-24T00:00:01.000Z",
            state: "finished",
            toolName: "readFile"
          }
        ]
      },
      2
    )

    expect(preview).toMatchObject({
      eventCount: 3,
      profileId: "explore",
      status: "succeeded",
      toolCallCount: 1
    })
    expect(preview.events).toEqual([
      {
        detail: '{"toolName":"readFile"}',
        id: "event-2",
        label: "#2 tool_call_started"
      },
      {
        detail: "done",
        id: "event-3",
        label: "#3 agent_run_finished"
      }
    ])
    expect(preview.toolCalls).toEqual([
      {
        detail: "finished",
        id: "tool-1",
        label: "readFile"
      }
    ])
  })

  it("builds a stable run graph preview from inspected traces", () => {
    const graph = buildAgentRunGraphPreview([
      {
        events: [],
        run: {
          chatSessionId: "session-1",
          errorMessage: null,
          finishedAt: null,
          id: "child-run-1",
          modelId: "openai/gpt-4.1",
          parentRunId: "root-run-1",
          profileId: "explore",
          startedAt: "2026-05-24T00:00:01.000Z",
          status: "succeeded"
        },
        toolCalls: [
          {
            approvalState: "not_required",
            errorMessage: null,
            finishedAt: null,
            id: "tool-1",
            input: {},
            output: {},
            parentToolCallId: null,
            runId: "child-run-1",
            startedAt: "2026-05-24T00:00:01.000Z",
            state: "finished",
            toolName: "readFile"
          }
        ]
      },
      {
        events: [
          {
            createdAt: "2026-05-24T00:00:00.000Z",
            id: "event-1",
            payload: {},
            runId: "root-run-1",
            sequence: 1,
            type: "agent_run_started"
          }
        ],
        run: {
          chatSessionId: "session-1",
          errorMessage: null,
          finishedAt: null,
          id: "root-run-1",
          modelId: "openai/gpt-4.1",
          parentRunId: null,
          profileId: "coder",
          startedAt: "2026-05-24T00:00:00.000Z",
          status: "running"
        },
        toolCalls: []
      }
    ])

    expect(graph.nodes).toEqual([
      {
        depth: 0,
        eventCount: 1,
        id: "root-run-1",
        parentRunId: null,
        profileId: "coder",
        status: "running",
        toolCallCount: 0
      },
      {
        depth: 1,
        eventCount: 0,
        id: "child-run-1",
        parentRunId: "root-run-1",
        profileId: "explore",
        status: "succeeded",
        toolCallCount: 1
      }
    ])
    expect(graph.edges).toEqual([
      {
        childRunId: "child-run-1",
        parentRunId: "root-run-1"
      }
    ])
  })

  it("builds display rows for a run graph preview", () => {
    expect(
      buildAgentRunGraphPreviewDisplay({
        edges: [
          {
            childRunId: "child-run-1",
            parentRunId: "root-run-1"
          }
        ],
        nodes: [
          {
            depth: 0,
            eventCount: 2,
            id: "root-run-1",
            parentRunId: null,
            profileId: "coder",
            status: "running",
            toolCallCount: 1
          },
          {
            depth: 1,
            eventCount: 1,
            id: "child-run-1",
            parentRunId: "root-run-1",
            profileId: "explore",
            status: "succeeded",
            toolCallCount: 3
          }
        ]
      })
    ).toEqual({
      edges: [
        {
          childRunId: "child-run-1",
          id: "root-run-1:child-run-1",
          label: "root-run-1 -> child-run-1",
          parentRunId: "root-run-1"
        }
      ],
      nodes: [
        {
          depth: 0,
          detailItems: ["running", "2 events", "1 tool"],
          id: "root-run-1",
          label: "coder",
          parentRunId: null
        },
        {
          depth: 1,
          detailItems: ["succeeded", "1 event", "3 tools"],
          id: "child-run-1",
          label: "explore",
          parentRunId: "root-run-1"
        }
      ]
    })
  })
})
