import { describe, expect, it } from "vite-plus/test"

import { createAgentSessionTree } from "@/main/agents/agent-session-tree"

describe("agent session tree", () => {
  it("appends messages to the current leaf and rebuilds context from the leaf path", () => {
    const session = createAgentSessionTree()
    const userEntry = session.appendMessage({
      content: "Start.",
      role: "user",
      type: "model"
    })
    const assistantEntry = session.appendMessage({
      content: "Done.",
      role: "assistant",
      type: "model"
    })

    expect(assistantEntry.parentId).toBe(userEntry.id)
    expect(session.getLeafEntryId()).toBe(assistantEntry.id)
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
    expect(session.listEntries().map((entry) => entry.type)).toEqual([
      "message",
      "leaf",
      "message",
      "leaf"
    ])
  })

  it("moves the leaf to a previous entry and injects branch summary into context", () => {
    const session = createAgentSessionTree()
    const rootUser = session.appendMessage({
      content: "Start.",
      role: "user",
      type: "model"
    })

    session.appendMessage({
      content: "Old branch.",
      role: "assistant",
      type: "model"
    })

    const summaryEntry = session.moveTo(rootUser.id, "Forked after start.")
    const newAssistant = session.appendMessage({
      content: "New branch.",
      role: "assistant",
      type: "model"
    })

    expect(summaryEntry.parentId).toBe(rootUser.id)
    expect(newAssistant.parentId).toBe(summaryEntry.id)
    expect(session.buildContext()).toEqual([
      {
        content: "Start.",
        role: "user",
        type: "model"
      },
      {
        content: "Branch summary:\nForked after start.",
        role: "system",
        type: "model"
      },
      {
        content: "New branch.",
        role: "assistant",
        type: "model"
      }
    ])
  })

  it("rejects moving the leaf to an unknown entry", () => {
    const session = createAgentSessionTree()

    session.appendMessage({
      content: "Start.",
      role: "user",
      type: "model"
    })

    expect(() => {
      session.moveTo("missing-entry")
    }).toThrow("Unknown agent session tree entry")
    expect(session.buildContext()).toEqual([
      {
        content: "Start.",
        role: "user",
        type: "model"
      }
    ])
  })

  it("rebuilds context from the latest compaction summary", () => {
    const session = createAgentSessionTree()

    session.appendMessage({
      content: "Long old user request.",
      role: "user",
      type: "model"
    })
    session.appendMessage({
      content: "Long old assistant answer.",
      role: "assistant",
      type: "model"
    })
    const compactionEntry = session.appendCompactionSummary(
      "Earlier conversation asked for a refactor."
    )
    const newUser = session.appendMessage({
      content: "Continue from summary.",
      role: "user",
      type: "model"
    })

    expect(newUser.parentId).toBe(compactionEntry.id)
    expect(session.buildContext()).toEqual([
      {
        content:
          "Compaction summary:\nEarlier conversation asked for a refactor.",
        role: "system",
        type: "model"
      },
      {
        content: "Continue from summary.",
        role: "user",
        type: "model"
      }
    ])
  })

  it("stores custom messages on the leaf path without exposing them to model context", () => {
    const session = createAgentSessionTree()

    session.appendMessage({
      content: "Start.",
      role: "user",
      type: "model"
    })
    const customEntry = session.appendCustomMessage({
      data: {
        checkpointId: "checkpoint-1"
      },
      type: "checkpoint"
    })
    const assistantEntry = session.appendMessage({
      content: "Visible answer.",
      role: "assistant",
      type: "model"
    })

    expect(assistantEntry.parentId).toBe(customEntry.id)
    expect(session.buildContext()).toEqual([
      {
        content: "Start.",
        role: "user",
        type: "model"
      },
      {
        content: "Visible answer.",
        role: "assistant",
        type: "model"
      }
    ])
    expect(session.listEntries().map((entry) => entry.type)).toContain(
      "custom_message"
    )
  })
})
