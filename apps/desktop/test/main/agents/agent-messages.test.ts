import { describe, expect, it } from "vite-plus/test"

import {
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
