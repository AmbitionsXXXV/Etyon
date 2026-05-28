import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { describe, expect, it } from "vite-plus/test"

import {
  collectFauxTextStream,
  createFauxGenerateTextResponse,
  createFauxGenerateToolCallResponse,
  createFauxProvider,
  createFauxTextResponse
} from "./faux-provider"

const readTextResponse = (
  stream: ReadableStream<LanguageModelV3StreamPart>
): Promise<string> => collectFauxTextStream(stream)

describe("faux provider", () => {
  it("serves deterministic stream responses in queue order", async () => {
    const faux = createFauxProvider({ modelId: "mock-model" })

    faux.setResponses([createFauxTextResponse("first")])
    faux.appendResponses(createFauxTextResponse("second"))

    const first = await faux.model.doStream({ prompt: [] })
    const second = await faux.model.doStream({ prompt: [] })

    expect(await readTextResponse(first.stream)).toBe("first")
    expect(await readTextResponse(second.stream)).toBe("second")
    expect(faux.model.doStreamCalls).toHaveLength(2)
  })

  it("replaces queued responses when setResponses is called again", async () => {
    const faux = createFauxProvider()

    faux.setResponses([createFauxTextResponse("stale")])
    faux.setResponses([createFauxTextResponse("fresh")])

    const response = await faux.model.doStream({ prompt: [] })

    expect(await readTextResponse(response.stream)).toBe("fresh")
  })

  it("serves deterministic generate responses in queue order", async () => {
    const faux = createFauxProvider({ modelId: "mock-model" })

    faux.setGenerateResponses([createFauxGenerateTextResponse("first")])
    faux.appendGenerateResponses(createFauxGenerateTextResponse("second"))

    const first = await faux.model.doGenerate({ prompt: [] })
    const second = await faux.model.doGenerate({ prompt: [] })

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

    const response = await faux.model.doGenerate({ prompt: [] })

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
      prompt: [],
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
})
