import type {
  LanguageModelV4CallOptions,
  LanguageModelV4FunctionTool,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
  LanguageModelV4ProviderTool,
  LanguageModelV4StreamPart
} from "@ai-sdk/provider"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { logger } from "@/main/logger"
import {
  createXmlToolMiddleware,
  createXmlToolStreamTransform,
  rewriteXmlGenerateResult,
  transformXmlToolParams
} from "@/main/server/lib/xml-tool-middleware"
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

const pingTool: LanguageModelV4FunctionTool = {
  description: "Ping a value",
  inputSchema: {
    properties: { value: { type: "number" } },
    type: "object"
  },
  name: "ping",
  type: "function"
}

const providerTool: LanguageModelV4ProviderTool = {
  args: {},
  id: "openai.web_search",
  name: "web_search",
  type: "provider"
}

const userText = (text: string): LanguageModelV4Prompt[number] => ({
  content: [{ text, type: "text" }],
  role: "user"
})

const finishPart = (
  unified:
    | "content-filter"
    | "error"
    | "length"
    | "other"
    | "stop"
    | "tool-calls",
  raw = unified
): LanguageModelV4StreamPart => ({
  finishReason: { raw, unified },
  type: "finish",
  usage
})

const collect = async (
  stream: ReadableStream<LanguageModelV4StreamPart>
): Promise<LanguageModelV4StreamPart[]> => {
  const parts: LanguageModelV4StreamPart[] = []
  const reader = stream.getReader()

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    parts.push(value)
  }

  return parts
}

const makeReadable = (
  parts: readonly LanguageModelV4StreamPart[]
): ReadableStream<LanguageModelV4StreamPart> =>
  new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part)
      }

      controller.close()
    }
  })

const runTransform = (
  parts: readonly LanguageModelV4StreamPart[]
): Promise<LanguageModelV4StreamPart[]> =>
  collect(makeReadable(parts).pipeThrough(createXmlToolStreamTransform()))

const textBlock = (
  id: string,
  deltas: readonly string[]
): LanguageModelV4StreamPart[] => [
  { id, type: "text-start" },
  ...deltas.map(
    (delta): LanguageModelV4StreamPart => ({ delta, id, type: "text-delta" })
  ),
  { id, type: "text-end" }
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe("transformXmlToolParams", () => {
  it("strips tools and appends the spec to the existing system message", () => {
    const params: LanguageModelV4CallOptions = {
      prompt: [{ content: "You are helpful.", role: "system" }, userText("hi")],
      toolChoice: { type: "auto" },
      tools: [pingTool]
    }

    const result = transformXmlToolParams(params)

    expect(result.tools).toBeUndefined()
    expect(result.toolChoice).toBeUndefined()

    const systemMessages = result.prompt.filter(
      (message) => message.role === "system"
    )

    expect(systemMessages).toHaveLength(1)

    const [system] = systemMessages

    expect(system?.role === "system" ? system.content : "").toContain(
      "You are helpful."
    )
    expect(system?.role === "system" ? system.content : "").toContain(
      XML_TOOL_PROMPT_HEADER
    )
    expect(system?.role === "system" ? system.content : "").toContain("ping")
  })

  it("prepends a system message when the prompt has none", () => {
    const params: LanguageModelV4CallOptions = {
      prompt: [userText("hi")],
      tools: [pingTool]
    }

    const result = transformXmlToolParams(params)

    expect(result.prompt[0]?.role).toBe("system")
    expect(
      result.prompt[0]?.role === "system" ? result.prompt[0].content : ""
    ).toContain(XML_TOOL_PROMPT_HEADER)
    expect(result.prompt[1]?.role).toBe("user")
  })

  it("converts prior tool history but injects no sentinel when there are no tools", () => {
    const params: LanguageModelV4CallOptions = {
      prompt: [
        {
          content: [
            {
              input: { value: 1 },
              toolCallId: "call-1",
              toolName: "ping",
              type: "tool-call"
            }
          ],
          role: "assistant"
        }
      ]
    }

    const result = transformXmlToolParams(params)

    expect(result.tools).toBeUndefined()

    const serialized = JSON.stringify(result.prompt)

    expect(serialized).not.toContain(XML_TOOL_PROMPT_HEADER)
    expect(serialized).toContain("<tool_call")
    expect(serialized).toContain("ping")
  })

  it("drops provider-defined tools with a warning", () => {
    const params: LanguageModelV4CallOptions = {
      prompt: [{ content: "sys", role: "system" }],
      tools: [pingTool, providerTool]
    }

    const result = transformXmlToolParams(params)

    const system = result.prompt.find((message) => message.role === "system")
    const content = system?.role === "system" ? system.content : ""

    expect(content).toContain("ping")
    expect(content).not.toContain("web_search")
    expect(logger.info).toHaveBeenCalledWith(
      "xml_tool_middleware_provider_tools_dropped",
      { count: 1 }
    )
  })

  it("injects no spec when toolChoice is none", () => {
    const params: LanguageModelV4CallOptions = {
      prompt: [{ content: "sys", role: "system" }],
      toolChoice: { type: "none" },
      tools: [pingTool]
    }

    const result = transformXmlToolParams(params)

    expect(result.tools).toBeUndefined()
    expect(result.toolChoice).toBeUndefined()
    expect(JSON.stringify(result.prompt)).not.toContain(XML_TOOL_PROMPT_HEADER)
  })

  it("clears toolChoice and adds the required instruction", () => {
    const params: LanguageModelV4CallOptions = {
      prompt: [{ content: "sys", role: "system" }],
      toolChoice: { type: "required" },
      tools: [pingTool]
    }

    const result = transformXmlToolParams(params)

    expect(result.toolChoice).toBeUndefined()

    const system = result.prompt.find((message) => message.role === "system")

    expect(system?.role === "system" ? system.content : "").toContain(
      "You MUST call a tool"
    )
  })
})

describe("createXmlToolStreamTransform", () => {
  it("emits the quadruple with a shared id and string input", async () => {
    const parts = await runTransform([
      { type: "stream-start", warnings: [] },
      ...textBlock("t1", ['<tool_call name="ping">{"value":1}</tool_call>']),
      finishPart("stop")
    ])

    const inputStart = parts.find((part) => part.type === "tool-input-start")
    const inputDelta = parts.find((part) => part.type === "tool-input-delta")
    const inputEnd = parts.find((part) => part.type === "tool-input-end")
    const toolCall = parts.find((part) => part.type === "tool-call")

    expect(inputStart?.type === "tool-input-start" ? inputStart.id : "a").toBe(
      inputDelta?.type === "tool-input-delta" ? inputDelta.id : "b"
    )
    expect(inputEnd?.type === "tool-input-end" ? inputEnd.id : "c").toBe(
      toolCall?.type === "tool-call" ? toolCall.toolCallId : "d"
    )
    expect(inputStart?.type === "tool-input-start" ? inputStart.id : "a").toBe(
      toolCall?.type === "tool-call" ? toolCall.toolCallId : "d"
    )
    expect(toolCall?.type === "tool-call" ? toolCall.input : null).toBe(
      '{"value":1}'
    )
    expect(typeof (toolCall?.type === "tool-call" ? toolCall.input : 0)).toBe(
      "string"
    )
    // A tool-call-only reply must not leak any text parts.
    expect(parts.some((part) => part.type === "text-start")).toBe(false)
    expect(parts.some((part) => part.type === "text-end")).toBe(false)
    expect(parts.some((part) => part.type === "text-delta")).toBe(false)
    // stream-start passes through.
    expect(parts[0]?.type).toBe("stream-start")
  })

  it("reassembles a tool call split across many text-deltas", async () => {
    const parts = await runTransform([
      ...textBlock("t1", [
        "<tool_",
        'call name="pi',
        'ng">{"val',
        'ue":1}</tool',
        "_call>"
      ]),
      finishPart("stop")
    ])

    const toolCalls = parts.filter((part) => part.type === "tool-call")

    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.type === "tool-call" ? toolCalls[0].input : null).toBe(
      '{"value":1}'
    )
  })

  it("forwards leading prose before the tool call as text", async () => {
    const parts = await runTransform([
      ...textBlock("t1", [
        'Let me help. <tool_call name="ping">{}</tool_call>'
      ]),
      finishPart("stop")
    ])

    expect(parts.some((part) => part.type === "text-start")).toBe(true)

    const textDelta = parts.find((part) => part.type === "text-delta")

    expect(textDelta?.type === "text-delta" ? textDelta.delta : "").toBe(
      "Let me help. "
    )
    expect(parts.some((part) => part.type === "tool-call")).toBe(true)
    expect(parts.some((part) => part.type === "text-end")).toBe(true)
  })

  it("rewrites finish stop to tool-calls when a call was emitted", async () => {
    const parts = await runTransform([
      ...textBlock("t1", ['<tool_call name="ping">{}</tool_call>']),
      finishPart("stop")
    ])

    const finish = parts.find((part) => part.type === "finish")

    expect(finish?.type === "finish" ? finish.finishReason.unified : null).toBe(
      "tool-calls"
    )
    expect(finish?.type === "finish" ? finish.finishReason.raw : null).toBe(
      "stop"
    )
  })

  it("does not rewrite finish stop when no call was emitted", async () => {
    const parts = await runTransform([
      ...textBlock("t1", ["just some text"]),
      finishPart("stop")
    ])

    const finish = parts.find((part) => part.type === "finish")

    expect(finish?.type === "finish" ? finish.finishReason.unified : null).toBe(
      "stop"
    )
  })

  it("never rewrites a length finish reason", async () => {
    const parts = await runTransform([
      ...textBlock("t1", ['<tool_call name="ping">{}</tool_call>']),
      finishPart("length")
    ])

    const finish = parts.find((part) => part.type === "finish")

    expect(finish?.type === "finish" ? finish.finishReason.unified : null).toBe(
      "length"
    )
  })

  it("flushes an unterminated block as text and does not rewrite finish", async () => {
    const parts = await runTransform([
      ...textBlock("t1", ['<tool_call name="ping">{"value":1}']),
      finishPart("stop")
    ])

    expect(parts.some((part) => part.type === "tool-call")).toBe(false)

    const textDeltas = parts.filter((part) => part.type === "text-delta")
    const joined = textDeltas
      .map((part) => (part.type === "text-delta" ? part.delta : ""))
      .join("")

    expect(joined).toContain('<tool_call name="ping">{"value":1}')

    const finish = parts.find((part) => part.type === "finish")

    expect(finish?.type === "finish" ? finish.finishReason.unified : null).toBe(
      "stop"
    )
  })

  it("still emits a tool call with a malformed JSON body and warns", async () => {
    const parts = await runTransform([
      ...textBlock("t1", ['<tool_call name="ping">{oops}</tool_call>']),
      finishPart("stop")
    ])

    const toolCall = parts.find((part) => part.type === "tool-call")

    expect(toolCall?.type === "tool-call" ? toolCall.input : null).toBe(
      "{oops}"
    )
    expect(logger.info).toHaveBeenCalledWith(
      "xml_tool_middleware_invalid_tool_json",
      { toolName: "ping" }
    )

    const finish = parts.find((part) => part.type === "finish")

    expect(finish?.type === "finish" ? finish.finishReason.unified : null).toBe(
      "tool-calls"
    )
  })
})

describe("createXmlToolMiddleware wrapStream", () => {
  const runWrapStream = async (
    prompt: LanguageModelV4Prompt,
    parts: readonly LanguageModelV4StreamPart[]
  ): Promise<LanguageModelV4StreamPart[]> => {
    const middleware = createXmlToolMiddleware()
    const { wrapStream } = middleware

    if (!wrapStream) {
      throw new Error("wrapStream missing")
    }

    const result = await wrapStream({
      doGenerate: () => Promise.reject(new Error("unused")),
      doStream: () => Promise.resolve({ stream: makeReadable(parts) }),
      model: {
        modelId: "m",
        provider: "p",
        specificationVersion: "v3",
        supportedUrls: {}
      } as never,
      params: { prompt } as LanguageModelV4CallOptions
    })

    return collect(result.stream)
  }

  const streamWithCall: LanguageModelV4StreamPart[] = [
    ...textBlock("t1", ['<tool_call name="ping">{}</tool_call>']),
    finishPart("stop")
  ]

  it("passes parts through byte-identical without the sentinel", async () => {
    const parts = await runWrapStream(
      [{ content: "plain system", role: "system" }],
      streamWithCall
    )

    expect(parts).toEqual(streamWithCall)
    expect(parts.some((part) => part.type === "tool-call")).toBe(false)
  })

  it("applies the transform when the sentinel is present", async () => {
    const parts = await runWrapStream(
      [{ content: `sys\n\n${XML_TOOL_PROMPT_HEADER}\n...`, role: "system" }],
      streamWithCall
    )

    expect(parts.some((part) => part.type === "tool-call")).toBe(true)

    const finish = parts.find((part) => part.type === "finish")

    expect(finish?.type === "finish" ? finish.finishReason.unified : null).toBe(
      "tool-calls"
    )
  })
})

describe("rewriteXmlGenerateResult", () => {
  it("splits mixed text and tool blocks and rewrites the finish reason", () => {
    const result: LanguageModelV4GenerateResult = {
      content: [
        {
          text: 'Sure. <tool_call name="ping">{"value":1}</tool_call> done',
          type: "text"
        }
      ],
      finishReason: { raw: "stop", unified: "stop" },
      usage,
      warnings: []
    }

    const rewritten = rewriteXmlGenerateResult(result)

    expect(rewritten.content).toEqual([
      { text: "Sure. ", type: "text" },
      {
        input: '{"value":1}',
        toolCallId: expect.any(String),
        toolName: "ping",
        type: "tool-call"
      },
      { text: " done", type: "text" }
    ])
    expect(rewritten.finishReason.unified).toBe("tool-calls")
    expect(rewritten.finishReason.raw).toBe("stop")
  })

  it("leaves pure text content and its finish reason untouched", () => {
    const result: LanguageModelV4GenerateResult = {
      content: [{ text: "just an answer", type: "text" }],
      finishReason: { raw: "stop", unified: "stop" },
      usage,
      warnings: []
    }

    const rewritten = rewriteXmlGenerateResult(result)

    expect(rewritten.content).toEqual([
      { text: "just an answer", type: "text" }
    ])
    expect(rewritten.finishReason.unified).toBe("stop")
  })
})
