import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { describe, expect, it } from "vite-plus/test"

import {
  appendToSystemPrompt,
  buildXmlToolSystemPrompt,
  convertToolHistoryToXml,
  createXmlToolCallParser,
  XML_TOOL_PROMPT_HEADER
} from "@/main/server/lib/xml-tool-protocol"
import type {
  XmlSpecTool,
  XmlToolParserEvent
} from "@/main/server/lib/xml-tool-protocol"

const collectEvents = (chunks: readonly string[]): XmlToolParserEvent[] => {
  const parser = createXmlToolCallParser()
  const events: XmlToolParserEvent[] = []

  for (const chunk of chunks) {
    events.push(...parser.push(chunk))
  }

  events.push(...parser.flush())

  return events
}

// Consecutive text events coalesce to one; tool-call events are atomic. This
// normalization lets us compare event streams regardless of chunk boundaries.
const coalesce = (events: XmlToolParserEvent[]): XmlToolParserEvent[] => {
  const out: XmlToolParserEvent[] = []

  for (const event of events) {
    if (event.type === "text") {
      if (event.text === "") {
        continue
      }

      const last = out.at(-1)

      if (last?.type === "text") {
        last.text += event.text
        continue
      }

      out.push({ text: event.text, type: "text" })
    } else {
      out.push(event)
    }
  }

  return out
}

const parse = (input: string): XmlToolParserEvent[] =>
  coalesce(collectEvents([input]))

const firstUserText = (prompt: LanguageModelV3Prompt): string => {
  const [message] = prompt

  if (message?.role !== "user") {
    throw new Error("expected user message")
  }

  const [part] = message.content

  if (part?.type !== "text") {
    throw new Error("expected text part")
  }

  return part.text
}

describe("buildXmlToolSystemPrompt", () => {
  const tools: XmlSpecTool[] = [
    {
      description: "Search the web",
      inputSchema: { properties: { q: { type: "string" } }, type: "object" },
      name: "search"
    },
    {
      inputSchema: { type: "object" },
      name: "noop"
    }
  ]

  it("begins with the sentinel header", () => {
    const prompt = buildXmlToolSystemPrompt(tools)

    expect(prompt.startsWith(XML_TOOL_PROMPT_HEADER)).toBe(true)
  })

  it("emits one <tool> block per tool with name, description, and schema JSON", () => {
    const prompt = buildXmlToolSystemPrompt(tools)

    expect(prompt).toContain('<tool name="search">')
    expect(prompt).toContain("<description>Search the web</description>")
    expect(prompt).toContain(
      '<input_schema>{"properties":{"q":{"type":"string"}},"type":"object"}</input_schema>'
    )
    expect(prompt).toContain('<tool name="noop">')
    expect((prompt.match(/<tool name=/gu) ?? []).length).toBe(2)
  })

  it("omits the description line when a tool has no description", () => {
    const prompt = buildXmlToolSystemPrompt([
      { inputSchema: { type: "object" }, name: "noop" }
    ])

    expect(prompt).not.toContain("<description>")
  })

  it("documents that parallel blocks must be independent", () => {
    const prompt = buildXmlToolSystemPrompt(tools)

    expect(prompt).toContain("independent")
    expect(prompt).toContain("parallel")
  })

  it("appends a required-tool instruction for toolChoice required", () => {
    const prompt = buildXmlToolSystemPrompt(tools, {
      toolChoice: { type: "required" }
    })

    expect(prompt).toContain("You MUST call a tool in your next reply.")
  })

  it("appends a specific-tool instruction for toolChoice tool", () => {
    const prompt = buildXmlToolSystemPrompt(tools, {
      toolChoice: { toolName: "search", type: "tool" }
    })

    expect(prompt).toContain(
      'You MUST call the tool "search" in your next reply.'
    )
  })

  it("adds no instruction for auto/none tool choice", () => {
    expect(
      buildXmlToolSystemPrompt(tools, { toolChoice: { type: "auto" } })
    ).not.toContain("You MUST")
    expect(
      buildXmlToolSystemPrompt(tools, { toolChoice: { type: "none" } })
    ).not.toContain("You MUST")
  })
})

describe("createXmlToolCallParser", () => {
  it("parses a whole block in a single push", () => {
    expect(parse('<tool_call name="ping">{"a":1}</tool_call>')).toEqual([
      { input: '{"a":1}', toolName: "ping", type: "tool-call" }
    ])
  })

  it("keeps text before, between, and after blocks", () => {
    expect(
      parse(
        'A<tool_call name="x">{"i":1}</tool_call>B<tool_call name="y">{"j":2}</tool_call>C'
      )
    ).toEqual([
      { text: "A", type: "text" },
      { input: '{"i":1}', toolName: "x", type: "tool-call" },
      { text: "B", type: "text" },
      { input: '{"j":2}', toolName: "y", type: "tool-call" },
      { text: "C", type: "text" }
    ])
  })

  it("is chunk-boundary invariant across every 2-way split (text + block + text)", () => {
    const stream =
      'before <tool_call name="search">{"q":"hello"}</tool_call> after'
    const reference = coalesce(collectEvents([stream]))

    expect(reference).toEqual([
      { text: "before ", type: "text" },
      { input: '{"q":"hello"}', toolName: "search", type: "tool-call" },
      { text: " after", type: "text" }
    ])

    for (let i = 0; i <= stream.length; i += 1) {
      const split = coalesce(
        collectEvents([stream.slice(0, i), stream.slice(i)])
      )

      expect(split, `2-way split at index ${i}`).toEqual(reference)
    }
  })

  it("is chunk-boundary invariant across every 3-way split (smaller sample)", () => {
    const stream = 'hi<tool_call name="x">{}</tool_call>'
    const reference = coalesce(collectEvents([stream]))

    for (let i = 0; i <= stream.length; i += 1) {
      for (let j = i; j <= stream.length; j += 1) {
        const split = coalesce(
          collectEvents([
            stream.slice(0, i),
            stream.slice(i, j),
            stream.slice(j)
          ])
        )

        expect(split, `3-way split at ${i},${j}`).toEqual(reference)
      }
    }
  })

  it("emits a lone '<' as text on flush", () => {
    expect(parse("<")).toEqual([{ text: "<", type: "text" }])
  })

  it("treats a '<tool_' prefix that then diverges as text", () => {
    expect(collectEvents(["<tool_", "xyz done"])).not.toContainEqual(
      expect.objectContaining({ type: "tool-call" })
    )
    expect(parse("<tool_xyz done")).toEqual([
      { text: "<tool_xyz done", type: "text" }
    ])
  })

  it("does not treat <tool_callback> as a tool call", () => {
    const events = parse("<tool_callback>keep going")

    expect(events).toEqual([
      { text: "<tool_callback>keep going", type: "text" }
    ])
  })

  it("tolerates extra and reordered attributes including id", () => {
    expect(
      parse('<tool_call id="call-1" name="foo" extra="1">{"a":1}</tool_call>')
    ).toEqual([{ input: '{"a":1}', toolName: "foo", type: "tool-call" }])
  })

  it("emits an opener with no name attribute back as text", () => {
    const events = parse("<tool_call>{}</tool_call>")

    expect(events).toEqual([
      { text: "<tool_call>{}</tool_call>", type: "text" }
    ])
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "tool-call" })
    )
  })

  it("handles a self-closing opener as an empty-argument call", () => {
    expect(parse('<tool_call name="noop"/>')).toEqual([
      { input: "{}", toolName: "noop", type: "tool-call" }
    ])
  })

  it("returns an unterminated block verbatim on flush", () => {
    const parser = createXmlToolCallParser()

    expect(parser.push('text <tool_call name="x">{"a":1')).toEqual([
      { text: "text ", type: "text" }
    ])
    expect(parser.flush()).toEqual([
      { text: '<tool_call name="x">{"a":1', type: "text" }
    ])
  })

  it("passes through a body that contains '<' and newlines", () => {
    const stream =
      '<tool_call name="render">\n{"html": "<section>x</section>"}\n</tool_call>'

    expect(parse(stream)).toEqual([
      {
        input: '{"html": "<section>x</section>"}',
        toolName: "render",
        type: "tool-call"
      }
    ])
  })

  it("handles CRLF around the body", () => {
    expect(parse('<tool_call name="x">\r\n{}\r\n</tool_call>')).toEqual([
      { input: "{}", toolName: "x", type: "tool-call" }
    ])
  })

  it("normalizes an empty body to {}", () => {
    expect(parse('<tool_call name="x"></tool_call>')).toEqual([
      { input: "{}", toolName: "x", type: "tool-call" }
    ])
  })
})

describe("convertToolHistoryToXml", () => {
  it("rewrites an assistant tool-call part as tool_call text with an id", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        content: [
          {
            input: { query: "cats" },
            toolCallId: "call-1",
            toolName: "search",
            type: "tool-call"
          }
        ],
        role: "assistant"
      }
    ]

    const [message] = convertToolHistoryToXml(prompt)

    expect(message?.role).toBe("assistant")

    if (message?.role !== "assistant") {
      throw new Error("expected assistant message")
    }

    const [part] = message.content

    expect(part?.type).toBe("text")

    if (part?.type !== "text") {
      throw new Error("expected text part")
    }

    expect(part.text).toContain('<tool_call name="search" id="call-1">')
    expect(part.text).toContain('{"query":"cats"}')
    expect(part.text).toContain("</tool_call>")
  })

  it("rewrites a tool message as a user tool_result message", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        content: [
          {
            output: { type: "text", value: "42 results" },
            toolCallId: "call-1",
            toolName: "search",
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    ]

    const [message] = convertToolHistoryToXml(prompt)

    expect(message?.role).toBe("user")

    if (message?.role !== "user") {
      throw new Error("expected user message")
    }

    const [part] = message.content

    if (part?.type !== "text") {
      throw new Error("expected text part")
    }

    expect(part.text).toContain('<tool_result name="search" id="call-1">')
    expect(part.text).toContain("42 results")
    expect(part.text).not.toContain("is_error")
  })

  it("marks error-json output with is_error and serializes the value", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        content: [
          {
            output: { type: "error-json", value: { message: "boom" } },
            toolCallId: "call-1",
            toolName: "search",
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    ]

    const text = firstUserText(convertToolHistoryToXml(prompt))

    expect(text).toContain('is_error="true"')
    expect(text).toContain('{"message":"boom"}')
  })

  it("renders execution-denied output as a denial with is_error", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        content: [
          {
            output: { reason: "not now", type: "execution-denied" },
            toolCallId: "call-1",
            toolName: "bash",
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    ]

    const text = firstUserText(convertToolHistoryToXml(prompt))

    expect(text).toContain('is_error="true"')
    expect(text).toContain("The user denied this tool call. not now")
  })

  it("renders content-type output with file placeholders", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        content: [
          {
            output: {
              type: "content",
              value: [
                { text: "here is the image", type: "text" },
                { data: "AAAA", mediaType: "image/png", type: "image-data" }
              ]
            },
            toolCallId: "call-1",
            toolName: "screenshot",
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    ]

    const text = firstUserText(convertToolHistoryToXml(prompt))

    expect(text).toContain("here is the image")
    expect(text).toContain("[attachment: image/png]")
    expect(text).not.toContain("is_error")
  })

  it("drops a tool message that has only approval-response parts", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        content: [
          { approvalId: "a1", approved: false, type: "tool-approval-response" }
        ],
        role: "tool"
      }
    ]

    expect(convertToolHistoryToXml(prompt)).toEqual([])
  })

  it("leaves a user message with a file part untouched (same reference)", () => {
    const userMessage: LanguageModelV3Prompt[number] = {
      content: [{ data: "AAAA", mediaType: "image/png", type: "file" }],
      role: "user"
    }
    const prompt: LanguageModelV3Prompt = [userMessage]

    const [out] = convertToolHistoryToXml(prompt)

    expect(out).toBe(userMessage)
  })
})

describe("appendToSystemPrompt", () => {
  it("appends to the first system message when one exists", () => {
    const prompt: LanguageModelV3Prompt = [
      { content: "BASE", role: "system" },
      { content: [{ text: "hi", type: "text" }], role: "user" }
    ]

    const [system, user] = appendToSystemPrompt(prompt, "EXTRA")

    expect(system).toEqual({ content: "BASE\n\nEXTRA", role: "system" })
    expect(user).toBe(prompt[1])
  })

  it("prepends a new system message when none exists", () => {
    const prompt: LanguageModelV3Prompt = [
      { content: [{ text: "hi", type: "text" }], role: "user" }
    ]

    const result = appendToSystemPrompt(prompt, "EXTRA")

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ content: "EXTRA", role: "system" })
    expect(result[1]).toBe(prompt[0])
  })
})
