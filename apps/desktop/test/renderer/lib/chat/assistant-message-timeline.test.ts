import { describe, expect, it } from "vite-plus/test"

import {
  buildAssistantChainEntries,
  describeToolGroup,
  getAssistantBodyText,
  getTodoPartTodos,
  getWorkSectionInitialExpanded,
  getWorkSectionStatus,
  groupChainEntries,
  hasPendingApproval,
  isWorkSectionForcedExpanded,
  isWorkSectionSelfCollapsing,
  isToolGroupRunning,
  messageHasWorkSection,
  shouldReopenWorkSection
} from "@/renderer/lib/chat/assistant-message-timeline"
import type {
  ChainToolGroupItem,
  ChatToolPart,
  ChatUiMessage
} from "@/renderer/lib/chat/assistant-message-timeline"

const toolPart = (
  overrides: Record<string, unknown>
): Record<string, unknown> => ({
  input: {},
  state: "output-available",
  toolCallId: `tool-${Math.random().toString(36).slice(2)}`,
  type: "dynamic-tool",
  ...overrides
})

const message = (parts: Record<string, unknown>[]): ChatUiMessage =>
  ({ id: "assistant-1", parts, role: "assistant" }) as unknown as ChatUiMessage

const groupItem = (
  overrides: Record<string, unknown>,
  repeatCount = 1
): ChainToolGroupItem =>
  ({ part: toolPart(overrides), repeatCount }) as unknown as ChainToolGroupItem

describe("buildAssistantChainEntries tail split", () => {
  it("keeps intermediate text in the chain and the trailing text in the body", () => {
    const source = message([
      { text: "Let me check the config.", type: "text" },
      toolPart({ input: { command: "ls" }, toolName: "bash" }),
      { text: "All set.", type: "text" }
    ])

    const entries = buildAssistantChainEntries(source)

    expect(entries.map((entry) => entry.kind)).toEqual(["text", "tool"])
    expect(entries[0]).toMatchObject({
      kind: "text",
      text: "Let me check the config."
    })
    expect(getAssistantBodyText(source)).toBe("All set.")
  })

  it("treats every text part as body when there is no chain part", () => {
    const source = message([
      { text: "First line.", type: "text" },
      { text: "Second line.", type: "text" }
    ])

    expect(buildAssistantChainEntries(source)).toEqual([])
    expect(getAssistantBodyText(source)).toBe("First line.\n\nSecond line.")
    expect(messageHasWorkSection(source)).toBe(false)
  })

  it("marks a message with tools or reasoning as having a work section", () => {
    expect(
      messageHasWorkSection(
        message([toolPart({ input: { path: "a.ts" }, toolName: "read" })])
      )
    ).toBe(true)
    expect(
      messageHasWorkSection(
        message([{ state: "done", text: "hmm", type: "reasoning" }])
      )
    ).toBe(true)
    expect(
      messageHasWorkSection(
        message([{ state: "done", text: "   ", type: "reasoning" }])
      )
    ).toBe(false)
  })

  it("captures reasoning streaming state and ordinal index", () => {
    const entries = buildAssistantChainEntries(
      message([
        { state: "done", text: "step one", type: "reasoning" },
        toolPart({ input: { command: "ls" }, toolName: "bash" }),
        { state: "streaming", text: "step two", type: "reasoning" }
      ])
    )
    const reasoning = entries.filter((entry) => entry.kind === "reasoning")

    expect(reasoning).toMatchObject([
      { index: 0, streaming: false, text: "step one" },
      { index: 1, streaming: true, text: "step two" }
    ])
  })
})

describe("groupChainEntries", () => {
  it("collapses consecutive tool entries into a single group", () => {
    const grouped = groupChainEntries(
      buildAssistantChainEntries(
        message([
          toolPart({ input: { command: "ls" }, toolName: "bash" }),
          toolPart({ input: { command: "pwd" }, toolName: "bash" }),
          { state: "done", text: "thinking", type: "reasoning" },
          toolPart({ input: { path: "a.ts" }, toolName: "read" })
        ])
      )
    )

    expect(grouped.map((entry) => entry.kind)).toEqual([
      "tool-group",
      "reasoning",
      "tool-group"
    ])
  })

  it("flags a group that contains an approval request", () => {
    const grouped = groupChainEntries(
      buildAssistantChainEntries(
        message([
          toolPart({
            approval: { id: "a1" },
            input: { command: "rm x" },
            state: "approval-requested",
            toolName: "bash"
          })
        ])
      )
    )

    expect(hasPendingApproval(grouped)).toBe(true)
  })

  it("splits delegate and workflow tools into standalone subagent-call entries", () => {
    const grouped = groupChainEntries(
      buildAssistantChainEntries(
        message([
          toolPart({ input: { path: "a.ts" }, toolName: "read" }),
          toolPart({
            input: { profileId: "explore", task: "look" },
            toolName: "delegate"
          }),
          toolPart({ input: { script: "meta" }, toolName: "workflow" }),
          toolPart({ input: { command: "ls" }, toolName: "bash" })
        ])
      )
    )

    expect(grouped.map((entry) => entry.kind)).toEqual([
      "tool-group",
      "subagent-call",
      "subagent-call",
      "tool-group"
    ])
    expect(
      grouped
        .filter((entry) => entry.kind === "subagent-call")
        .map((entry) => (entry as { toolName: string }).toolName)
    ).toEqual(["delegate", "workflow"])
  })

  it("collapses repeated todo_write calls to a single latest todo entry", () => {
    const grouped = groupChainEntries(
      buildAssistantChainEntries(
        message([
          toolPart({
            input: { todos: [{ content: "a", status: "pending" }] },
            toolName: "todo_write"
          }),
          toolPart({ input: { path: "a.ts" }, toolName: "read" }),
          toolPart({
            input: {
              todos: [
                { content: "a", status: "completed" },
                { content: "b", status: "in_progress" }
              ]
            },
            toolName: "todo_write"
          })
        ])
      )
    )

    // One todo entry only, positioned after the read group (latest call wins).
    expect(grouped.map((entry) => entry.kind)).toEqual(["tool-group", "todo"])
    const todo = grouped.find((entry) => entry.kind === "todo")
    expect(
      getTodoPartTodos((todo as { part: ChatToolPart }).part)
    ).toHaveLength(2)
  })
})

describe("getTodoPartTodos", () => {
  it("extracts a validated todo list from a todo_write part input", () => {
    const part = toolPart({
      input: {
        todos: [
          { content: "a", status: "completed" },
          { activeForm: "Doing b", content: "b", status: "in_progress" }
        ]
      },
      toolName: "todo_write"
    })

    expect(getTodoPartTodos(part as unknown as ChatToolPart)).toEqual([
      { content: "a", status: "completed" },
      { activeForm: "Doing b", content: "b", status: "in_progress" }
    ])
  })

  it("drops malformed items and returns [] when there is no list", () => {
    const bad = toolPart({
      input: {
        todos: [
          { content: "a", status: "nope" },
          { status: "pending" },
          { content: "ok", status: "pending" }
        ]
      },
      toolName: "todo_write"
    })

    expect(getTodoPartTodos(bad as unknown as ChatToolPart)).toEqual([
      { content: "ok", status: "pending" }
    ])
    expect(
      getTodoPartTodos(
        toolPart({
          input: {},
          toolName: "todo_write"
        }) as unknown as ChatToolPart
      )
    ).toEqual([])
  })
})

describe("describeToolGroup", () => {
  it("labels a single command and multiple commands", () => {
    expect(describeToolGroup([groupItem({ toolName: "bash" })])).toEqual({
      kind: "ranCommand"
    })
    expect(
      describeToolGroup([
        groupItem({ toolName: "bash" }),
        groupItem({ toolName: "bash" })
      ])
    ).toEqual({ count: 2, kind: "ranCommands" })
  })

  it("names a lone read/edit by file and counts the rest", () => {
    expect(
      describeToolGroup([
        groupItem({
          input: { path: "src/message-tool-trace.tsx" },
          toolName: "read"
        })
      ])
    ).toEqual({ kind: "readFile", name: "message-tool-trace.tsx" })
    expect(
      describeToolGroup([
        groupItem({ input: { pattern: "foo" }, toolName: "grep" })
      ])
    ).toEqual({ kind: "exploredFile" })
    expect(
      describeToolGroup([
        groupItem({ input: { path: "a.ts" }, toolName: "read" }),
        groupItem({ input: { path: "b.ts" }, toolName: "read" })
      ])
    ).toEqual({ count: 2, kind: "exploredFiles" })
    expect(
      describeToolGroup([
        groupItem({ input: { path: "a.ts" }, toolName: "edit" })
      ])
    ).toEqual({ kind: "editedFile", name: "a.ts" })
    expect(
      describeToolGroup([
        groupItem({ input: { path: "a.ts" }, toolName: "edit" }),
        groupItem({ input: { path: "b.ts" }, toolName: "write" })
      ])
    ).toEqual({ count: 2, kind: "editedFiles" })
  })

  it("counts repeats and falls back to used-tools for mixed or unknown groups", () => {
    expect(
      describeToolGroup([
        groupItem({ input: { path: "a.ts" }, toolName: "read" }, 3)
      ])
    ).toEqual({ count: 3, kind: "exploredFiles" })
    expect(
      describeToolGroup([
        groupItem({ toolName: "bash" }),
        groupItem({ input: { path: "a.ts" }, toolName: "read" })
      ])
    ).toEqual({ count: 2, kind: "usedTools" })
    expect(describeToolGroup([groupItem({ toolName: "delegate" })])).toEqual({
      kind: "usedTool"
    })
  })

  it("labels a lone directory listing as exploring the project", () => {
    expect(
      describeToolGroup([groupItem({ input: { path: "." }, toolName: "ls" })])
    ).toEqual({ kind: "exploredProject" })
    // A lone grep with no path still reads as exploring a file.
    expect(
      describeToolGroup([
        groupItem({ input: { pattern: "foo" }, toolName: "grep" })
      ])
    ).toEqual({ kind: "exploredFile" })
  })
})

describe("isToolGroupRunning", () => {
  it("recognizes streaming and available tool input, but not approval requests", () => {
    expect(isToolGroupRunning([groupItem({ state: "input-streaming" })])).toBe(
      true
    )
    expect(isToolGroupRunning([groupItem({ state: "input-available" })])).toBe(
      true
    )
    expect(
      isToolGroupRunning([
        groupItem({ state: "output-available" }),
        groupItem({ state: "approval-requested" })
      ])
    ).toBe(false)
  })
})

describe("work section status machine", () => {
  it("resolves the header status from run state and outcome", () => {
    expect(
      getWorkSectionStatus({ hasApprovalPending: false, isRunActive: true })
    ).toBe("working")
    expect(
      getWorkSectionStatus({ hasApprovalPending: true, isRunActive: false })
    ).toBe("waiting")
    // A pending approval (parent tool part OR a folded-in delegated-child prompt)
    // wins over "working" while the run is still live.
    expect(
      getWorkSectionStatus({ hasApprovalPending: true, isRunActive: true })
    ).toBe("waiting")
    expect(
      getWorkSectionStatus({
        exitReason: "aborted",
        hasApprovalPending: false,
        isRunActive: false
      })
    ).toBe("stopped")
    expect(
      getWorkSectionStatus({
        exitReason: "model-error",
        hasApprovalPending: false,
        isRunActive: false
      })
    ).toBe("failed")
    expect(
      getWorkSectionStatus({
        exitReason: "completed",
        hasApprovalPending: false,
        isRunActive: false
      })
    ).toBe("worked")
  })

  it("forces expansion and self-collapse only for the right states", () => {
    expect(isWorkSectionForcedExpanded("working")).toBe(true)
    expect(isWorkSectionForcedExpanded("waiting")).toBe(true)
    expect(isWorkSectionForcedExpanded("worked")).toBe(false)
    expect(isWorkSectionSelfCollapsing("worked")).toBe(true)
    expect(isWorkSectionSelfCollapsing("stopped")).toBe(false)
    expect(isWorkSectionSelfCollapsing("failed")).toBe(false)
  })

  it("mounts terminal-interrupted sections open and completions collapsed", () => {
    expect(getWorkSectionInitialExpanded("stopped")).toBe(true)
    expect(getWorkSectionInitialExpanded("failed")).toBe(true)
    expect(getWorkSectionInitialExpanded("worked")).toBe(false)
  })

  it("reopens only on a late transition into stopped/failed", () => {
    expect(shouldReopenWorkSection("worked", "failed")).toBe(true)
    expect(shouldReopenWorkSection("worked", "stopped")).toBe(true)
    expect(shouldReopenWorkSection("working", "failed")).toBe(true)
    expect(shouldReopenWorkSection("failed", "failed")).toBe(false)
    expect(shouldReopenWorkSection("stopped", "stopped")).toBe(false)
    expect(shouldReopenWorkSection("working", "worked")).toBe(false)
    expect(shouldReopenWorkSection("worked", "waiting")).toBe(false)
  })
})
