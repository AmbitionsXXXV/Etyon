import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { describe, expect, it } from "vite-plus/test"

import {
  collectFauxTextStream,
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
})
