import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart
} from "@ai-sdk/provider"
import { describe, expect, it } from "vite-plus/test"

import {
  collectFauxTextStream,
  createFauxErrorResponse,
  createFauxGenerateToolCallResponse,
  createFauxGenerateTextResponse,
  createFauxProvider,
  createFauxTextResponse,
  createFauxToolInputDeltaResponse,
  createMockLanguageModel
} from "./faux-provider"

const createCallOptions = (): LanguageModelV3CallOptions =>
  ({
    prompt: []
  }) as LanguageModelV3CallOptions

const collectStreamParts = async (
  stream: ReadableStream<LanguageModelV3StreamPart>
): Promise<LanguageModelV3StreamPart[]> => {
  const reader = stream.getReader()
  const parts: LanguageModelV3StreamPart[] = []

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      return parts
    }

    parts.push(value)
  }
}

describe("faux provider fixtures", () => {
  it("keeps faux provider stream queue compatibility", async () => {
    const faux = createFauxProvider({ modelId: "mock-model" })

    faux.setResponses([createFauxTextResponse("first")])
    faux.appendResponses(createFauxTextResponse("second"))

    const first = await faux.model.doStream(createCallOptions())
    const second = await faux.model.doStream(createCallOptions())

    expect(await collectFauxTextStream(first.stream)).toBe("first")
    expect(await collectFauxTextStream(second.stream)).toBe("second")
    expect(faux.model.doStreamCalls).toHaveLength(2)
  })

  it("replaces queued stream responses when setResponses is called again", async () => {
    const faux = createFauxProvider()

    faux.setResponses([createFauxTextResponse("stale")])
    faux.setResponses([createFauxTextResponse("fresh")])

    const response = await faux.model.doStream(createCallOptions())

    expect(await collectFauxTextStream(response.stream)).toBe("fresh")
  })

  it("keeps faux provider generate queue compatibility", async () => {
    const faux = createFauxProvider({ modelId: "mock-model" })

    faux.setGenerateResponses([createFauxGenerateTextResponse("first")])
    faux.appendGenerateResponses(createFauxGenerateTextResponse("second"))

    const first = await faux.model.doGenerate(createCallOptions())
    const second = await faux.model.doGenerate(createCallOptions())

    expect(first.content).toEqual([
      {
        text: "first",
        type: "text"
      }
    ])
    expect(second.content).toEqual([
      {
        text: "second",
        type: "text"
      }
    ])
    expect(faux.model.doGenerateCalls).toHaveLength(2)
  })

  it("serves generated tool-call responses", async () => {
    const faux = createFauxProvider({ modelId: "mock-model" })

    faux.setGenerateResponses([
      createFauxGenerateToolCallResponse({
        input: {
          path: "package.json"
        },
        toolCallId: "tool-call-1",
        toolName: "readFile"
      })
    ])

    const response = await faux.model.doGenerate(createCallOptions())

    expect(response.content).toEqual([
      {
        input: '{"path":"package.json"}',
        toolCallId: "tool-call-1",
        toolName: "readFile",
        type: "tool-call"
      }
    ])
  })

  it("lists tool names from the latest stream call", async () => {
    const faux = createFauxProvider()

    faux.setResponses([createFauxTextResponse("tools")])

    await faux.model.doStream({
      ...createCallOptions(),
      tools: [
        {
          inputSchema: {
            type: "object"
          },
          name: "readFile",
          type: "function"
        },
        {
          inputSchema: {
            type: "object"
          },
          name: "writeFile",
          type: "function"
        }
      ]
    })

    expect(faux.listLastStreamToolNames()).toEqual(["readFile", "writeFile"])
  })

  it("queues mock language model stream and generate responses", async () => {
    const mock = createMockLanguageModel({
      generateResponses: [createFauxGenerateTextResponse("generated")],
      streamResponses: [createFauxTextResponse("first")]
    })
    const firstStream = await mock.model.doStream(createCallOptions())

    mock.appendResponses(createFauxTextResponse("second"))

    const secondStream = await mock.model.doStream(createCallOptions())
    const generated = await mock.model.doGenerate(createCallOptions())

    expect(await collectFauxTextStream(firstStream.stream)).toBe("first")
    expect(await collectFauxTextStream(secondStream.stream)).toBe("second")
    expect(generated.content).toEqual([
      {
        text: "generated",
        type: "text"
      }
    ])
    await expect(mock.model.doStream(createCallOptions())).rejects.toThrow(
      "Mock language model stream response queue is empty."
    )
  })

  it("creates tool input delta and error stream fixtures", async () => {
    const toolResponse = createFauxToolInputDeltaResponse({
      input: {
        path: "package.json"
      },
      inputChunks: ['{"path":', '"package.json"}'],
      toolCallId: "tool-call-1",
      toolName: "read"
    })
    const errorResponse = createFauxErrorResponse(new Error("model failed"))

    await expect(collectStreamParts(toolResponse.stream)).resolves.toEqual([
      {
        type: "stream-start",
        warnings: []
      },
      expect.objectContaining({
        type: "response-metadata"
      }),
      {
        id: "tool-call-1",
        toolName: "read",
        type: "tool-input-start"
      },
      {
        delta: '{"path":',
        id: "tool-call-1",
        type: "tool-input-delta"
      },
      {
        delta: '"package.json"}',
        id: "tool-call-1",
        type: "tool-input-delta"
      },
      {
        id: "tool-call-1",
        type: "tool-input-end"
      },
      expect.objectContaining({
        finishReason: {
          raw: "tool_calls",
          unified: "tool-calls"
        },
        type: "finish"
      })
    ])
    await expect(collectStreamParts(errorResponse.stream)).resolves.toEqual([
      {
        type: "stream-start",
        warnings: []
      },
      expect.objectContaining({
        type: "response-metadata"
      }),
      {
        error: new Error("model failed"),
        type: "error"
      },
      expect.objectContaining({
        finishReason: {
          raw: "error",
          unified: "error"
        },
        type: "finish"
      })
    ])
  })
})
