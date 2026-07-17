import { createChat } from "@shadcn/helpers/ai-sdk"
import type { AiSdkChat } from "@shadcn/helpers/ai-sdk"
import type { UIMessage } from "ai"
import { readUIMessageStream } from "ai"
import { describe, expect, it } from "vite-plus/test"

import {
  buildAssistantChainEntries,
  getAssistantBodyText,
  groupChainEntries,
  hasPendingApproval,
  isToolGroupRunning,
  messageHasWorkSection
} from "@/renderer/lib/chat/assistant-message-timeline"
import type { ChatUiMessage } from "@/renderer/lib/chat/assistant-message-timeline"
import { shouldSendChatAutomatically } from "@/renderer/lib/chat/auto-send"

/**
 * Streams scripted conversations through @shadcn/helpers' ChatTransport and the
 * SDK's own `readUIMessageStream` materializer, then pins the renderer view
 * logic against the RESULTING messages. Unlike the hand-written part fixtures
 * in the sibling suites (which also cover mid-stream and approval states this
 * builder cannot express), these messages carry exactly the shapes ai@7
 * produces end-to-end, so SDK-side part/state drift fails here first.
 */

const streamReply = async (
  chat: AiSdkChat,
  priorCount: number,
  onError?: (error: unknown) => void
): Promise<UIMessage> => {
  const transport = chat.transport({ delayMs: 0 })
  const stream = await transport.sendMessages({
    abortSignal: undefined,
    body: undefined,
    chatId: "chat-under-test",
    headers: undefined,
    messageId: undefined,
    messages: chat.get(priorCount),
    metadata: undefined,
    trigger: "submit-message"
  })

  let final: UIMessage | undefined

  for await (const snapshot of readUIMessageStream({
    stream,
    ...(onError ? { onError } : {})
  })) {
    final = snapshot
  }

  if (!final) {
    throw new Error("stream produced no message")
  }

  return final
}

const asChatMessage = (message: UIMessage): ChatUiMessage =>
  message as unknown as ChatUiMessage

describe("timeline fold over an SDK-materialized worked turn", () => {
  const chat = createChat()
    .user("Run the tests")
    .assistant(({ writer }) => {
      writer.reasoning("Checking the suite first.")
      writer
        .tool("bash", { input: { command: "vp test" } })
        .output({ exitCode: 0 })
      writer.tool("read", { input: { path: "vite.config.ts" } }).output("cfg")
      writer.text("All tests pass.")
    })

  it("folds reasoning + tools into the chain and keeps the trailing text as body", async () => {
    const reply = asChatMessage(await streamReply(chat, 1))

    expect(messageHasWorkSection(reply)).toBe(true)

    const entries = buildAssistantChainEntries(reply)

    expect(entries.map((entry) => entry.kind)).toEqual([
      "reasoning",
      "tool",
      "tool"
    ])
    expect(getAssistantBodyText(reply)).toBe("All tests pass.")

    const grouped = groupChainEntries(entries)

    expect(grouped.map((entry) => entry.kind)).toEqual([
      "reasoning",
      "tool-group"
    ])

    const group = grouped.find((entry) => entry.kind === "tool-group")

    if (group?.kind !== "tool-group") {
      throw new Error("expected a tool group")
    }

    expect(group.label).toEqual({ count: 2, kind: "usedTools" })
    expect(isToolGroupRunning(group.tools)).toBe(false)
    expect(hasPendingApproval(grouped)).toBe(false)
  })

  it("does not trigger an automatic resend for a settled turn", async () => {
    const reply = await streamReply(chat, 1)

    expect(
      shouldSendChatAutomatically({ messages: [...chat.get(1), reply] })
    ).toBe(false)
  })
})

describe("in-flight and denied tool states", () => {
  it("reports a group with an unresolved tool input as running", async () => {
    const chat = createChat()
      .user("Start the build")
      .assistant(({ writer }) => {
        writer.tool("bash", { input: { command: "vp run make" } })
      })
    const grouped = groupChainEntries(
      buildAssistantChainEntries(asChatMessage(await streamReply(chat, 1)))
    )
    const group = grouped.find((entry) => entry.kind === "tool-group")

    if (group?.kind !== "tool-group") {
      throw new Error("expected a tool group")
    }

    expect(isToolGroupRunning(group.tools)).toBe(true)
  })

  it("treats the v7 output-denied state as settled, not as a pending approval", async () => {
    const chat = createChat()
      .user("Delete the folder")
      .assistant(({ writer }) => {
        writer.tool("bash", { input: { command: "rm -rf build" } }).denied()
        writer.text("Understood, leaving it in place.")
      })
    const reply = await streamReply(chat, 1)
    const grouped = groupChainEntries(
      buildAssistantChainEntries(asChatMessage(reply))
    )
    const group = grouped.find((entry) => entry.kind === "tool-group")

    if (group?.kind !== "tool-group") {
      throw new Error("expected a tool group")
    }

    expect(isToolGroupRunning(group.tools)).toBe(false)
    expect(hasPendingApproval(grouped)).toBe(false)
    expect(
      shouldSendChatAutomatically({ messages: [...chat.get(1), reply] })
    ).toBe(false)
  })
})

describe("input-required tools drive the auto-send predicate", () => {
  it("resends after a trailing ask_user gains its output", async () => {
    const chat = createChat()
      .user("Pick a store")
      .assistant(({ writer }) => {
        writer.tool("ask_user", {
          input: { options: [], question: "Which store?" },
          output: { custom: null, selected: ["SQLite"] }
        })
      })
    const reply = await streamReply(chat, 1)

    expect(
      shouldSendChatAutomatically({ messages: [...chat.get(1), reply] })
    ).toBe(true)
  })

  it("stays quiet while the trailing ask_user is unanswered", async () => {
    const chat = createChat()
      .user("Pick a store")
      .assistant(({ writer }) => {
        writer.tool("ask_user", {
          input: { options: [], question: "Which store?" }
        })
      })
    const reply = await streamReply(chat, 1)

    expect(
      shouldSendChatAutomatically({ messages: [...chat.get(1), reply] })
    ).toBe(false)
  })
})

describe("data parts", () => {
  it("materializes persistent data parts and drops transient ones", async () => {
    const chat = createChat()
      .user("Show progress")
      .assistant(({ writer }) => {
        writer.data({
          data: { childRunId: "c1", chunk: { delta: "x", type: "text-delta" } },
          transient: true,
          type: "data-subagent-chunk"
        })
        writer.data({
          data: { runId: "r1", todos: [] },
          id: "todo-r1",
          type: "data-todo"
        })
        writer.text("On it.")
      })
    const reply = await streamReply(chat, 1)
    const partTypes = reply.parts.map((part) => part.type)

    expect(partTypes).toContain("data-todo")
    expect(partTypes).not.toContain("data-subagent-chunk")
  })
})

describe("stream errors and scripted continuations", () => {
  it("surfaces a scripted error chunk through readUIMessageStream", async () => {
    const chat = createChat().user("Load the report").error("Report kaput")
    const errors: unknown[] = []
    const reply = await streamReply(chat, 1, (error) => errors.push(error))

    expect(reply.parts).toEqual([])
    expect(errors.map(String).join(" ")).toContain("Report kaput")
  })

  it("walks the scripted conversation with next()", async () => {
    const chat = createChat()
      .user("one")
      .assistant("first")
      .user("two")
      .assistant("second")
    const reply = await streamReply(chat, 1)
    const next = chat.next([...chat.get(1), reply])

    expect(next).not.toBeNull()
    expect(next?.parts.find((part) => part.type === "text")).toMatchObject({
      text: "two"
    })
    expect(chat.next(chat.get())).toBeNull()
  })
})
