import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage
} from "@ai-sdk/provider"
import { MockLanguageModelV3 } from "ai/test"

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
  appendGenerateResponses: (
    ...responses: LanguageModelV3GenerateResult[]
  ) => void
  appendResponses: (...responses: LanguageModelV3StreamResult[]) => void
  listLastStreamToolNames: () => string[]
  model: MockLanguageModelV3
  setGenerateResponses: (responses: LanguageModelV3GenerateResult[]) => void
  setResponses: (responses: LanguageModelV3StreamResult[]) => void
}

export type QueuedMockLanguageModel = FauxProvider

const createFauxReadableStream = <TChunk>(
  chunks: readonly TChunk[]
): ReadableStream<TChunk> =>
  new ReadableStream<TChunk>({
    start: (controller) => {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    }
  })

export const createFauxGenerateTextResponse = (
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
): LanguageModelV3GenerateResult => ({
  content: [
    {
      text,
      type: "text"
    }
  ],
  finishReason,
  response: {
    id,
    modelId,
    timestamp
  },
  usage,
  warnings: []
})

export const createFauxGenerateToolCallResponse = ({
  finishReason = {
    raw: "tool_calls",
    unified: "tool-calls"
  },
  id = "response-1",
  input,
  modelId = DEFAULT_MODEL_ID,
  timestamp = new Date("2026-05-24T00:00:00.000Z"),
  toolCallId,
  toolName,
  usage = EMPTY_USAGE
}: {
  finishReason?: LanguageModelV3FinishReason
  id?: string
  input: unknown
  modelId?: string
  timestamp?: Date
  toolCallId: string
  toolName: string
  usage?: LanguageModelV3Usage
}): LanguageModelV3GenerateResult => ({
  content: [
    {
      input: JSON.stringify(input),
      toolCallId,
      toolName,
      type: "tool-call"
    }
  ],
  finishReason,
  response: {
    id,
    modelId,
    timestamp
  },
  usage,
  warnings: []
})

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
  stream: createFauxReadableStream<LanguageModelV3StreamPart>([
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
  ])
})

export const createFauxToolCallResponse = ({
  finishReason = {
    raw: "tool_calls",
    unified: "tool-calls"
  },
  id = "response-1",
  input,
  modelId = DEFAULT_MODEL_ID,
  timestamp = new Date("2026-05-24T00:00:00.000Z"),
  toolCallId,
  toolName,
  usage = EMPTY_USAGE
}: {
  finishReason?: LanguageModelV3FinishReason
  id?: string
  input: unknown
  modelId?: string
  timestamp?: Date
  toolCallId: string
  toolName: string
  usage?: LanguageModelV3Usage
}): LanguageModelV3StreamResult => ({
  stream: createFauxReadableStream<LanguageModelV3StreamPart>([
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
      input: JSON.stringify(input),
      toolCallId,
      toolName,
      type: "tool-call"
    },
    {
      finishReason,
      type: "finish",
      usage
    }
  ])
})

export const createFauxToolInputDeltaResponse = ({
  finishReason = {
    raw: "tool_calls",
    unified: "tool-calls"
  },
  id = "response-1",
  input,
  inputChunks,
  modelId = DEFAULT_MODEL_ID,
  timestamp = new Date("2026-05-24T00:00:00.000Z"),
  toolCallId,
  toolName,
  usage = EMPTY_USAGE
}: {
  finishReason?: LanguageModelV3FinishReason
  id?: string
  input: unknown
  inputChunks?: readonly string[]
  modelId?: string
  timestamp?: Date
  toolCallId: string
  toolName: string
  usage?: LanguageModelV3Usage
}): LanguageModelV3StreamResult => {
  const serializedInput = JSON.stringify(input)
  const chunks = inputChunks ?? [serializedInput]

  return {
    stream: createFauxReadableStream<LanguageModelV3StreamPart>([
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
        id: toolCallId,
        toolName,
        type: "tool-input-start"
      },
      ...chunks.map(
        (delta): LanguageModelV3StreamPart => ({
          delta,
          id: toolCallId,
          type: "tool-input-delta"
        })
      ),
      {
        id: toolCallId,
        type: "tool-input-end"
      },
      {
        finishReason,
        type: "finish",
        usage
      }
    ])
  }
}

export const createFauxProviderToolResultResponse = ({
  finishReason = {
    raw: "stop",
    unified: "stop"
  },
  id = "response-1",
  input,
  isError = false,
  modelId = DEFAULT_MODEL_ID,
  output,
  timestamp = new Date("2026-05-24T00:00:00.000Z"),
  toolCallId,
  toolName,
  usage = EMPTY_USAGE
}: {
  finishReason?: LanguageModelV3FinishReason
  id?: string
  input: unknown
  isError?: boolean
  modelId?: string
  output: NonNullable<
    LanguageModelV3StreamPart & { type: "tool-result" }
  >["result"]
  timestamp?: Date
  toolCallId: string
  toolName: string
  usage?: LanguageModelV3Usage
}): LanguageModelV3StreamResult => ({
  stream: createFauxReadableStream<LanguageModelV3StreamPart>([
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
      input: JSON.stringify(input),
      providerExecuted: true,
      toolCallId,
      toolName,
      type: "tool-call"
    },
    {
      ...(isError ? { isError } : {}),
      result: output,
      toolCallId,
      toolName,
      type: "tool-result"
    },
    {
      finishReason,
      type: "finish",
      usage
    }
  ])
})

export const createFauxErrorResponse = (
  error: unknown,
  {
    finishReason = {
      raw: "error",
      unified: "error"
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
  stream: createFauxReadableStream<LanguageModelV3StreamPart>([
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
      error,
      type: "error"
    },
    {
      finishReason,
      type: "finish",
      usage
    }
  ])
})

export const createMockLanguageModel = ({
  generateResponses = [],
  modelId = DEFAULT_MODEL_ID,
  provider = DEFAULT_PROVIDER,
  streamResponses = []
}: {
  generateResponses?: readonly LanguageModelV3GenerateResult[]
  modelId?: string
  provider?: string
  streamResponses?: readonly LanguageModelV3StreamResult[]
} = {}): QueuedMockLanguageModel => {
  const generateResponseQueue = [...generateResponses]
  const responseQueue = [...streamResponses]
  const model = new MockLanguageModelV3({
    doGenerate: (_options: LanguageModelV3CallOptions) => {
      const response = generateResponseQueue.shift()

      if (!response) {
        throw new Error("Mock language model generate response queue is empty.")
      }

      return Promise.resolve(response)
    },
    doStream: (_options: LanguageModelV3CallOptions) => {
      const response = responseQueue.shift()

      if (!response) {
        throw new Error("Mock language model stream response queue is empty.")
      }

      return Promise.resolve(response)
    },
    modelId,
    provider
  })

  return {
    appendGenerateResponses: (...responses) => {
      generateResponseQueue.push(...responses)
    },
    appendResponses: (...responses) => {
      responseQueue.push(...responses)
    },
    listLastStreamToolNames: () =>
      (model.doStreamCalls.at(-1)?.tools ?? []).map((tool) => tool.name),
    model,
    setGenerateResponses: (responses) => {
      generateResponseQueue.length = 0
      generateResponseQueue.push(...responses)
    },
    setResponses: (responses) => {
      responseQueue.length = 0
      responseQueue.push(...responses)
    }
  }
}

export const createFauxProvider = ({
  modelId = DEFAULT_MODEL_ID,
  provider = DEFAULT_PROVIDER
}: {
  modelId?: string
  provider?: string
} = {}): FauxProvider =>
  createMockLanguageModel({
    modelId,
    provider
  })

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
