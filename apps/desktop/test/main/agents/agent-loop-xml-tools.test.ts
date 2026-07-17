import type {
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart
} from "@ai-sdk/provider"
import type { LanguageModel, UIMessageChunk } from "ai"
import { tool, wrapLanguageModel } from "ai"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { describe, expect, it, vi } from "vite-plus/test"
import { z } from "zod"

import { runAgentLoop } from "@/main/agents/minimal/agent-loop"
import { createXmlToolMiddleware } from "@/main/server/lib/xml-tool-middleware"
import { XML_TOOL_PROMPT_HEADER } from "@/main/server/lib/xml-tool-protocol"

vi.mock("@/main/logger", () => ({
  logger: {
    critical: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    startEvent: vi.fn()
  }
}))

const usage = {
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: undefined,
    total: 1
  },
  outputTokens: {
    reasoning: undefined,
    text: undefined,
    total: 1
  }
}

// The model has no native tool API, so in XML mode it emits its whole reply as
// text — the `<tool_call>` markup is split across `text-delta` chunks to prove
// the parser and stream transform survive chunk boundaries.
const xmlStep = (
  deltas: readonly string[],
  finishUnified: "stop" | "tool-calls" = "stop"
): LanguageModelV3StreamPart[] => [
  { type: "stream-start", warnings: [] },
  { id: "text-1", type: "text-start" },
  ...deltas.map(
    (delta): LanguageModelV3StreamPart => ({
      delta,
      id: "text-1",
      type: "text-delta"
    })
  ),
  { id: "text-1", type: "text-end" },
  {
    finishReason: { raw: finishUnified, unified: finishUnified },
    type: "finish",
    usage
  }
]

interface Harness {
  chunks: UIMessageChunk[]
  flush: () => Promise<void>
  model: LanguageModel
  prompts: LanguageModelV3Prompt[]
  writer: {
    merge: (stream: ReadableStream<UIMessageChunk>) => void
    onError: undefined
    write: (chunk: UIMessageChunk) => void
  }
}

const buildHarness = (
  scripts: readonly LanguageModelV3StreamPart[][]
): Harness => {
  const chunks: UIMessageChunk[] = []
  const prompts: LanguageModelV3Prompt[] = []
  const pumps: Promise<void>[] = []
  let callIndex = 0

  const mock = new MockLanguageModelV3({
    doStream: (options) => {
      // Captures the params AFTER the middleware's transformParams ran, so the
      // recorded prompt is exactly what the provider would have received.
      prompts.push(options.prompt)
      const script = scripts[Math.min(callIndex, scripts.length - 1)]

      callIndex += 1

      return Promise.resolve({
        stream: simulateReadableStream({ chunks: [...(script ?? [])] })
      })
    }
  })

  return {
    chunks,
    flush: async () => {
      await Promise.all(pumps)
    },
    model: wrapLanguageModel({
      middleware: createXmlToolMiddleware(),
      model: mock
    }),
    prompts,
    writer: {
      merge: (stream) => {
        pumps.push(
          (async () => {
            const reader = stream.getReader()

            while (true) {
              const { done, value } = await reader.read()

              if (done) {
                break
              }

              chunks.push(value)
            }
          })()
        )
      },
      onError: undefined,
      write: (chunk) => {
        chunks.push(chunk)
      }
    }
  }
}

const systemText = (prompt: LanguageModelV3Prompt): string =>
  prompt
    .filter((message) => message.role === "system")
    .map((message) => (message.role === "system" ? message.content : ""))
    .join("\n")

// Flattens every message to its raw text so assertions see real quotes rather
// than the escaped `\"` that `JSON.stringify` would produce.
const promptText = (prompt: LanguageModelV3Prompt): string =>
  prompt
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content
            .map((part) => ("text" in part ? part.text : ""))
            .join("")
    )
    .join("\n")

const userMessages = [{ content: "ping the value 1", role: "user" as const }]

describe("agent loop with XML tool middleware", () => {
  it("parses a chunk-split XML call, executes it, and continues the loop", async () => {
    const ping = vi.fn().mockResolvedValue("pong")
    const harness = buildHarness([
      xmlStep(['<tool_call name="pi', 'ng">{"val', 'ue":1}</tool', "_call>"]),
      xmlStep(["All done."])
    ])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: userMessages,
      model: harness.model,
      tools: {
        ping: tool({
          description: "ping a value",
          execute: ping,
          inputSchema: z.object({ value: z.number() })
        })
      },
      writer: harness.writer
    })

    await harness.flush()

    // The parsed input reached the tool, and the finish rewrite (stop →
    // tool-calls) drove a second step instead of exiting after the first call.
    expect(ping).toHaveBeenCalledTimes(1)
    expect(ping.mock.calls[0]?.[0]).toEqual({ value: 1 })
    expect(outcome.exitReason).toBe("completed")
    expect(outcome.stepCount).toBe(2)

    const secondPrompt = harness.prompts[1] ?? []

    expect(secondPrompt.some((message) => message.role === "tool")).toBe(false)
    expect(promptText(secondPrompt)).toContain('<tool_result name="ping"')
    expect(systemText(secondPrompt)).toContain(XML_TOOL_PROMPT_HEADER)

    // The raw XML markup was converted to tool parts, never surfaced as text.
    expect(JSON.stringify(harness.chunks)).not.toContain("<tool_call")
  })

  it("feeds a malformed XML call back to the model as an error result", async () => {
    const ping = vi.fn().mockResolvedValue("pong")
    const harness = buildHarness([
      xmlStep(['<tool_call name="ping">{oops}</tool_call>']),
      xmlStep(["Recovered."])
    ])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: userMessages,
      model: harness.model,
      tools: {
        ping: tool({
          description: "ping a value",
          execute: ping,
          inputSchema: z.object({ value: z.number() })
        })
      },
      writer: harness.writer
    })

    await harness.flush()

    expect(outcome.stepCount).toBe(2)
    expect(promptText(harness.prompts[1] ?? [])).toContain('is_error="true"')
    expect(ping).not.toHaveBeenCalled()
  })

  it("suspends when an execute-less tool is called through XML", async () => {
    const harness = buildHarness([
      xmlStep([
        '<tool_call name="ask_user">{"question":"pick","options":[{"label":"A"}]}</tool_call>'
      ])
    ])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: userMessages,
      model: harness.model,
      tools: {
        ask_user: tool({
          description: "ask the user",
          inputSchema: z.object({
            options: z.array(z.object({ label: z.string() })),
            question: z.string()
          })
        })
      },
      writer: harness.writer
    })

    await harness.flush()

    expect(outcome.exitReason).toBe("suspended")
    expect(outcome.stepCount).toBe(1)
  })
})
