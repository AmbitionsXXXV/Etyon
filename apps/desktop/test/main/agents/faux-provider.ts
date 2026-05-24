import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage
} from "@ai-sdk/provider"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"

const DEFAULT_MODEL_ID = "faux-model"
const DEFAULT_PROVIDER = "faux-provider"
const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: undefined,
    total: 0
  },
  outputTokens: {
    reasoning: undefined,
    text: 0,
    total: 0
  }
}

export interface FauxProvider {
  appendResponses: (...responses: LanguageModelV3StreamResult[]) => void
  model: MockLanguageModelV3
  setResponses: (responses: LanguageModelV3StreamResult[]) => void
}

export const createFauxTextResponse = (
  text: string,
  {
    finishReason = {
      raw: "stop",
      unified: "stop"
    },
    id = "response-1",
    modelId = DEFAULT_MODEL_ID,
    timestamp = new Date("2026-05-24T00:00:00.000Z"),
    usage = EMPTY_USAGE
  }: {
    finishReason?: LanguageModelV3FinishReason
    id?: string
    modelId?: string
    timestamp?: Date
    usage?: LanguageModelV3Usage
  } = {}
): LanguageModelV3StreamResult => ({
  stream: simulateReadableStream<LanguageModelV3StreamPart>({
    chunks: [
      {
        type: "stream-start",
        warnings: []
      },
      {
        id,
        modelId,
        timestamp,
        type: "response-metadata"
      },
      {
        id: `${id}-text`,
        type: "text-start"
      },
      {
        delta: text,
        id: `${id}-text`,
        type: "text-delta"
      },
      {
        id: `${id}-text`,
        type: "text-end"
      },
      {
        finishReason,
        type: "finish",
        usage
      }
    ],
    initialDelayInMs: null
  })
})

export const createFauxProvider = ({
  modelId = DEFAULT_MODEL_ID,
  provider = DEFAULT_PROVIDER
}: {
  modelId?: string
  provider?: string
} = {}): FauxProvider => {
  const responseQueue: LanguageModelV3StreamResult[] = []
  const model = new MockLanguageModelV3({
    doStream: (_options: LanguageModelV3CallOptions) => {
      const response = responseQueue.shift()

      if (!response) {
        throw new Error("Faux provider response queue is empty.")
      }

      return Promise.resolve(response)
    },
    modelId,
    provider
  })

  return {
    appendResponses: (...responses) => {
      responseQueue.push(...responses)
    },
    model,
    setResponses: (responses) => {
      responseQueue.length = 0
      responseQueue.push(...responses)
    }
  }
}

export const collectFauxTextStream = async (
  stream: ReadableStream<LanguageModelV3StreamPart>
): Promise<string> => {
  const reader = stream.getReader()
  const chunks: string[] = []

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    if (value.type === "text-delta") {
      chunks.push(value.delta)
    }
  }

  return chunks.join("")
}
