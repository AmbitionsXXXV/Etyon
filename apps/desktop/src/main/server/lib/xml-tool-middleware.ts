import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart
} from "@ai-sdk/provider"
import type { LanguageModelMiddleware } from "ai"
import { generateId } from "ai"

import { logger } from "@/main/logger"
import {
  appendToSystemPrompt,
  buildXmlToolSystemPrompt,
  convertToolHistoryToXml,
  createXmlToolCallParser,
  XML_TOOL_PROMPT_HEADER
} from "@/main/server/lib/xml-tool-protocol"
import type {
  XmlToolCallParser,
  XmlToolParserEvent
} from "@/main/server/lib/xml-tool-protocol"

/**
 * `wrapLanguageModel` middleware that gives tool use to models with no native
 * function-calling API. It is inert unless {@link transformXmlToolParams}
 * injected the XML tool spec into the system prompt: the injected
 * {@link XML_TOOL_PROMPT_HEADER} is the only activation signal, so no shared
 * mutable state is needed and `wrapStream`/`wrapGenerate` (which run on the
 * *transformed* params) can detect XML mode independently.
 */

type StreamController =
  TransformStreamDefaultController<LanguageModelV3StreamPart>

/** True when a system message carries the injected XML tool spec. */
const promptHasXmlSentinel = (prompt: LanguageModelV3Prompt): boolean =>
  prompt.some(
    (message) =>
      message.role === "system" &&
      message.content.includes(XML_TOOL_PROMPT_HEADER)
  )

/**
 * Rewrites the call params for XML tool mode. Applied to every call so that
 * replayed agent-era history still reads correctly to a model without a native
 * tool API, even when no tools are offered on this call.
 *
 * - always converts prior tool-call / tool-result messages to XML text;
 * - drops provider-executed tools (they cannot run through this protocol);
 * - with no function tools or `toolChoice: none`, strips tools WITHOUT injecting
 *   the spec, so plain chat / summarization stays byte-identical and the stream
 *   wrapper stays inert;
 * - otherwise appends the XML tool spec to the system prompt and clears the
 *   native `tools` / `toolChoice` so the provider never sees them.
 */
export const transformXmlToolParams = (
  params: LanguageModelV3CallOptions
): LanguageModelV3CallOptions => {
  const prompt = convertToolHistoryToXml(params.prompt)

  const functionTools: LanguageModelV3FunctionTool[] = []
  let droppedProviderTools = 0

  for (const tool of params.tools ?? []) {
    if (tool.type === "function") {
      functionTools.push(tool)
    } else {
      droppedProviderTools += 1
    }
  }

  if (droppedProviderTools > 0) {
    logger.info("xml_tool_middleware_provider_tools_dropped", {
      count: droppedProviderTools
    })
  }

  if (functionTools.length === 0 || params.toolChoice?.type === "none") {
    return { ...params, prompt, toolChoice: undefined, tools: undefined }
  }

  const spec = buildXmlToolSystemPrompt(
    functionTools.map((tool) => ({
      description: tool.description,
      inputSchema: tool.inputSchema,
      name: tool.name
    })),
    { toolChoice: params.toolChoice }
  )

  return {
    ...params,
    prompt: appendToSystemPrompt(prompt, spec),
    toolChoice: undefined,
    tools: undefined
  }
}

const rewriteFinishReason = (
  finishReason: LanguageModelV3StreamPart & { type: "finish" },
  sawToolCall: boolean
): LanguageModelV3StreamPart => {
  if (sawToolCall && finishReason.finishReason.unified === "stop") {
    return {
      ...finishReason,
      finishReason: { ...finishReason.finishReason, unified: "tool-calls" }
    }
  }

  return finishReason
}

/**
 * A `TransformStream` over raw V3 stream parts that turns the model's inline
 * `<tool_call>` XML into real tool-call parts. State is per instance:
 *
 * - one parser per text block (created at `text-start`);
 * - the `text-start` part is HELD and forwarded only once the block produces
 *   real text, so a tool-call-only reply emits zero empty text parts;
 * - each parsed call emits the quadruple `tool-input-start` / `-delta` / `-end`
 *   / `tool-call` sharing one generated id, with the raw JSON body as `input`
 *   (a malformed body is still emitted so the SDK can self-correct);
 * - a `finish` whose reason is `stop` is rewritten to `tool-calls` when at least
 *   one call was synthesized, so the agent loop keeps going instead of exiting.
 */
export const createXmlToolStreamTransform = (): TransformStream<
  LanguageModelV3StreamPart,
  LanguageModelV3StreamPart
> => {
  let parser: XmlToolCallParser | null = null
  let currentTextId = ""
  let pendingTextStart: LanguageModelV3StreamPart | null = null
  let sawToolCall = false

  const emitToolCall = (
    controller: StreamController,
    toolName: string,
    input: string
  ): void => {
    sawToolCall = true
    const id = generateId()

    try {
      JSON.parse(input)
    } catch {
      logger.info("xml_tool_middleware_invalid_tool_json", { toolName })
    }

    controller.enqueue({ id, toolName, type: "tool-input-start" })
    controller.enqueue({ delta: input, id, type: "tool-input-delta" })
    controller.enqueue({ id, type: "tool-input-end" })
    controller.enqueue({ input, toolCallId: id, toolName, type: "tool-call" })
  }

  const emitEvents = (
    controller: StreamController,
    events: readonly XmlToolParserEvent[]
  ): void => {
    for (const event of events) {
      if (event.type === "text") {
        if (pendingTextStart) {
          controller.enqueue(pendingTextStart)
          pendingTextStart = null
        }

        controller.enqueue({
          delta: event.text,
          id: currentTextId,
          type: "text-delta"
        })
      } else {
        emitToolCall(controller, event.toolName, event.input)
      }
    }
  }

  const startBlock = (
    part: LanguageModelV3StreamPart & { type: "text-start" }
  ): XmlToolCallParser => {
    const created = createXmlToolCallParser()

    parser = created
    currentTextId = part.id
    pendingTextStart = part

    return created
  }

  return new TransformStream({
    flush(controller) {
      if (!parser) {
        return
      }

      emitEvents(controller, parser.flush())

      // The block emitted real text (start was forwarded) but the stream ended
      // without a text-end — close it so the block stays well-formed.
      if (pendingTextStart === null) {
        controller.enqueue({ id: currentTextId, type: "text-end" })
      }

      parser = null
      pendingTextStart = null
    },
    transform(part, controller) {
      if (part.type === "text-start") {
        startBlock(part)

        return
      }

      if (part.type === "text-delta") {
        const active = parser ?? startBlock({ id: part.id, type: "text-start" })

        emitEvents(controller, active.push(part.delta))

        return
      }

      if (part.type === "text-end") {
        if (parser) {
          emitEvents(controller, parser.flush())

          // Drop both start and end when the block produced no real text.
          if (pendingTextStart === null) {
            controller.enqueue(part)
          }

          parser = null
          pendingTextStart = null
        }

        return
      }

      if (part.type === "finish") {
        controller.enqueue(rewriteFinishReason(part, sawToolCall))

        return
      }

      controller.enqueue(part)
    }
  })
}

/**
 * Non-streaming counterpart of {@link createXmlToolStreamTransform}: parses each
 * text content part, rebuilds `content` (order preserved) as non-empty text
 * parts plus synthesized tool-call parts, and applies the same finish-reason
 * rewrite. Present because memory summarization runs through `generateText`.
 */
export const rewriteXmlGenerateResult = (
  result: LanguageModelV3GenerateResult
): LanguageModelV3GenerateResult => {
  const content: LanguageModelV3Content[] = []
  let sawToolCall = false

  for (const part of result.content) {
    if (part.type !== "text") {
      content.push(part)
      continue
    }

    const parser = createXmlToolCallParser()
    const events = [...parser.push(part.text), ...parser.flush()]

    for (const event of events) {
      if (event.type === "text") {
        if (event.text.length > 0) {
          content.push({ text: event.text, type: "text" })
        }
      } else {
        sawToolCall = true

        try {
          JSON.parse(event.input)
        } catch {
          logger.info("xml_tool_middleware_invalid_tool_json", {
            toolName: event.toolName
          })
        }

        content.push({
          input: event.input,
          toolCallId: generateId(),
          toolName: event.toolName,
          type: "tool-call"
        })
      }
    }
  }

  const finishReason =
    sawToolCall && result.finishReason.unified === "stop"
      ? { ...result.finishReason, unified: "tool-calls" as const }
      : result.finishReason

  return { ...result, content, finishReason }
}

/**
 * Builds the XML tool-calling middleware. See the module and function docs for
 * the activation contract (system-prompt sentinel) and the streaming/generate
 * rewrites.
 */
export const createXmlToolMiddleware = (): LanguageModelMiddleware => ({
  specificationVersion: "v3",
  transformParams: ({ params }) =>
    Promise.resolve(transformXmlToolParams(params)),
  wrapGenerate: async ({ doGenerate, params }) => {
    const result = await doGenerate()

    if (!promptHasXmlSentinel(params.prompt)) {
      return result
    }

    return rewriteXmlGenerateResult(result)
  },
  wrapStream: async ({ doStream, params }) => {
    const result = await doStream()

    if (!promptHasXmlSentinel(params.prompt)) {
      return result
    }

    return {
      ...result,
      stream: result.stream.pipeThrough(createXmlToolStreamTransform())
    }
  }
})
