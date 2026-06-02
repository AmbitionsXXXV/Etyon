import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import type {
  AssistantModelMessage,
  InferUIMessageChunk,
  JSONValue,
  LanguageModel,
  ModelMessage,
  TextStreamPart,
  ToolExecutionOptions,
  ToolSet,
  UIMessage
} from "ai"
import { generateText, stepCountIs, streamText } from "ai"

import type {
  AgentLoopMessage,
  AgentLoopModel,
  AgentLoopModelContext,
  AgentLoopModelToolResult,
  AgentLoopToolCall,
  AgentLoopTool
} from "@/main/agents/agent-loop"
import type { AgentToolResultSummaryProcessor } from "@/main/agents/truncate"
import {
  formatToolResultSummaryAnnotation,
  summarizeToolResult
} from "@/main/agents/truncate"

export interface AiSdkAgentLoopModelStreamCallbacks {
  onFinish?: () => void
  onTextDelta?: (text: string) => void
  onToolCall?: (toolCall: AgentLoopToolCall) => void
  onToolResult?: (toolResult: AgentLoopModelToolResult) => Promise<void> | void
  onUiChunk?: (chunk: AiSdkUiMessageChunk) => void
}

export interface CreateAiSdkAgentLoopModelOptions {
  headers?: Readonly<Record<string, string>>
  metadata?: Readonly<Record<string, unknown>>
  model: LanguageModel
  mode?: "generate" | "stream"
  streamCallbacks?: AiSdkAgentLoopModelStreamCallbacks
  system?: string
  tools?: ToolSet
}

export interface CreateAiSdkAgentLoopToolsOptions {
  metadata?: Readonly<Record<string, unknown>>
  tools: ToolSet
}

export interface CreateAiSdkToolResultSummaryProcessorOptions {
  headers?: Readonly<Record<string, string>>
  maxInputChars?: number
  metadata?: Readonly<Record<string, unknown>>
  model: LanguageModel
}

interface PendingStreamToolInput {
  chunks: string[]
  toolName: string
}

interface CollectAiSdkStreamTurnOptions {
  stream: AsyncIterable<TextStreamPart<ToolSet>>
  streamCallbacks?: AiSdkAgentLoopModelStreamCallbacks
}

const DEFAULT_TOOL_RESULT_SUMMARY_PROCESSOR_INPUT_MAX_CHARS = 24_000

type AiSdkUiMessageChunk = InferUIMessageChunk<UIMessage>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  isRecord(value) && Symbol.asyncIterator in value

const collectAsyncIterable = async (
  iterable: AsyncIterable<unknown>
): Promise<unknown[]> => {
  const values: unknown[] = []

  for await (const value of iterable) {
    values.push(value)
  }

  return values
}

const toJsonValue = (value: unknown): JSONValue | null => {
  if (value === undefined) {
    return null
  }

  try {
    return structuredClone(value) as JSONValue
  } catch {
    return null
  }
}

const parseStreamedToolInput = (input: string): unknown => {
  if (!input) {
    return {}
  }

  try {
    return JSON.parse(input)
  } catch {
    return input
  }
}

const compactUiChunk = (chunk: AiSdkUiMessageChunk): AiSdkUiMessageChunk =>
  Object.fromEntries(
    Object.entries(chunk).filter(([, value]) => value !== undefined)
  ) as AiSdkUiMessageChunk

const getUiChunkErrorText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

const emitUiChunk = ({
  chunk,
  streamCallbacks
}: {
  chunk: AiSdkUiMessageChunk
  streamCallbacks?: AiSdkAgentLoopModelStreamCallbacks
}): void => {
  streamCallbacks?.onUiChunk?.(compactUiChunk(chunk))
}

const emitContentUiChunkForTextStreamPart = ({
  part,
  streamCallbacks
}: {
  part: TextStreamPart<ToolSet>
  streamCallbacks?: AiSdkAgentLoopModelStreamCallbacks
}): boolean => {
  switch (part.type) {
    case "abort": {
      emitUiChunk({
        chunk: {
          reason: part.reason,
          type: "abort"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    case "file": {
      emitUiChunk({
        chunk: {
          mediaType: part.file.mediaType,
          providerMetadata: part.providerMetadata,
          type: "file",
          url: `data:${part.file.mediaType};base64,${part.file.base64}`
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    case "finish-step": {
      emitUiChunk({
        chunk: {
          type: "finish-step"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    case "reasoning-delta": {
      emitUiChunk({
        chunk: {
          delta: part.text,
          id: part.id,
          providerMetadata: part.providerMetadata,
          type: "reasoning-delta"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    case "reasoning-end": {
      emitUiChunk({
        chunk: {
          id: part.id,
          providerMetadata: part.providerMetadata,
          type: "reasoning-end"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    case "reasoning-start": {
      emitUiChunk({
        chunk: {
          id: part.id,
          providerMetadata: part.providerMetadata,
          type: "reasoning-start"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    case "source": {
      if (part.sourceType === "document") {
        emitUiChunk({
          chunk: {
            filename: part.filename,
            mediaType: part.mediaType,
            providerMetadata: part.providerMetadata,
            sourceId: part.id,
            title: part.title,
            type: "source-document"
          } as AiSdkUiMessageChunk,
          streamCallbacks
        })
        return true
      }

      emitUiChunk({
        chunk: {
          providerMetadata: part.providerMetadata,
          sourceId: part.id,
          title: part.title,
          type: "source-url",
          url: part.url
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    case "start-step": {
      emitUiChunk({
        chunk: {
          type: "start-step"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    case "text-delta": {
      emitUiChunk({
        chunk: {
          delta: part.text,
          id: part.id,
          providerMetadata: part.providerMetadata,
          type: "text-delta"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    case "text-end": {
      emitUiChunk({
        chunk: {
          id: part.id,
          providerMetadata: part.providerMetadata,
          type: "text-end"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    case "text-start": {
      emitUiChunk({
        chunk: {
          id: part.id,
          providerMetadata: part.providerMetadata,
          type: "text-start"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      return true
    }
    default: {
      return false
    }
  }
}

const emitToolUiChunkForTextStreamPart = ({
  part,
  streamCallbacks
}: {
  part: TextStreamPart<ToolSet>
  streamCallbacks?: AiSdkAgentLoopModelStreamCallbacks
}): void => {
  switch (part.type) {
    case "tool-approval-request": {
      emitUiChunk({
        chunk: {
          approvalId: part.approvalId,
          toolCallId: part.toolCall.toolCallId,
          type: "tool-approval-request"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      break
    }
    case "tool-call": {
      if (part.invalid) {
        emitUiChunk({
          chunk: {
            dynamic: part.dynamic,
            errorText: getUiChunkErrorText(part.error),
            input: part.input,
            providerExecuted: part.providerExecuted,
            providerMetadata: part.providerMetadata,
            title: part.title,
            toolCallId: part.toolCallId,
            toolMetadata: part.toolMetadata,
            toolName: part.toolName,
            type: "tool-input-error"
          } as AiSdkUiMessageChunk,
          streamCallbacks
        })
        break
      }

      emitUiChunk({
        chunk: {
          dynamic: part.dynamic,
          input: part.input,
          providerExecuted: part.providerExecuted,
          providerMetadata: part.providerMetadata,
          title: part.title,
          toolCallId: part.toolCallId,
          toolMetadata: part.toolMetadata,
          toolName: part.toolName,
          type: "tool-input-available"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      break
    }
    case "tool-error": {
      emitUiChunk({
        chunk: {
          dynamic: part.dynamic,
          errorText: getUiChunkErrorText(part.error),
          providerExecuted: part.providerExecuted,
          providerMetadata: part.providerMetadata,
          toolCallId: part.toolCallId,
          toolMetadata: part.toolMetadata,
          type: "tool-output-error"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      break
    }
    case "tool-input-delta": {
      emitUiChunk({
        chunk: {
          inputTextDelta: part.delta,
          toolCallId: part.id,
          type: "tool-input-delta"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      break
    }
    case "tool-input-start": {
      emitUiChunk({
        chunk: {
          dynamic: part.dynamic,
          providerExecuted: part.providerExecuted,
          providerMetadata: part.providerMetadata,
          title: part.title,
          toolCallId: part.id,
          toolMetadata: part.toolMetadata,
          toolName: part.toolName,
          type: "tool-input-start"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      break
    }
    case "tool-output-denied": {
      emitUiChunk({
        chunk: {
          toolCallId: part.toolCallId,
          type: "tool-output-denied"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      break
    }
    case "tool-result": {
      emitUiChunk({
        chunk: {
          dynamic: part.dynamic,
          output: part.output,
          preliminary: part.preliminary,
          providerExecuted: part.providerExecuted,
          providerMetadata: part.providerMetadata,
          toolCallId: part.toolCallId,
          toolMetadata: part.toolMetadata,
          type: "tool-output-available"
        } as AiSdkUiMessageChunk,
        streamCallbacks
      })
      break
    }
    default: {
      break
    }
  }
}

const emitUiChunkForTextStreamPart = ({
  part,
  streamCallbacks
}: {
  part: TextStreamPart<ToolSet>
  streamCallbacks?: AiSdkAgentLoopModelStreamCallbacks
}): void => {
  if (
    emitContentUiChunkForTextStreamPart({
      part,
      streamCallbacks
    })
  ) {
    return
  }

  emitToolUiChunkForTextStreamPart({
    part,
    streamCallbacks
  })
}

const isExistingToolResultOutput = (
  output: unknown
): output is ToolResultOutput =>
  isRecord(output) && output.type === "execution-denied"

const toToolResultOutput = ({
  isError,
  output
}: {
  isError: boolean
  output: unknown
}): ToolResultOutput => {
  if (isExistingToolResultOutput(output)) {
    return output
  }

  if (typeof output === "string") {
    return {
      type: isError ? "error-text" : "text",
      value: output
    }
  }

  const jsonValue = toJsonValue(output)

  if (isError) {
    return jsonValue === null
      ? {
          type: "error-text",
          value: String(output)
        }
      : {
          type: "error-json",
          value: jsonValue
        }
  }

  return jsonValue === null
    ? {
        type: "text",
        value: String(output)
      }
    : {
        type: "json",
        value: jsonValue
      }
}

const getModelMessageText = (message: ModelMessage): string => {
  if (typeof message.content === "string") {
    return message.content
  }

  if (!Array.isArray(message.content)) {
    return JSON.stringify(message.content)
  }

  const contentParts: unknown[] = [...message.content]

  return contentParts
    .map((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("")
}

const getToolResultOutputValue = (output: unknown): unknown => {
  if (!isRecord(output) || typeof output.type !== "string") {
    return output
  }

  if ("value" in output) {
    return output.value
  }

  return output
}

const isErrorToolResultOutput = (output: unknown): boolean =>
  isRecord(output) &&
  typeof output.type === "string" &&
  output.type.startsWith("error-")

export const convertModelMessagesToAgentLoopMessages = (
  messages: readonly ModelMessage[]
): AgentLoopMessage[] =>
  messages.flatMap((message): AgentLoopMessage[] => {
    if (message.role === "assistant") {
      const content = getModelMessageText(message)
      const contentParts: unknown[] = Array.isArray(message.content)
        ? [...message.content]
        : []
      const toolCalls = contentParts.flatMap((part) => {
        if (
          !isRecord(part) ||
          part.type !== "tool-call" ||
          typeof part.toolCallId !== "string" ||
          typeof part.toolName !== "string"
        ) {
          return []
        }

        return [
          {
            input: part.input,
            toolCallId: part.toolCallId,
            toolName: part.toolName
          }
        ]
      })

      if (!content && toolCalls.length === 0) {
        return []
      }

      return [
        {
          content,
          role: "assistant",
          toolCalls
        }
      ]
    }

    if (message.role === "tool" && Array.isArray(message.content)) {
      const contentParts: unknown[] = [...message.content]

      return contentParts.flatMap((part) => {
        if (
          !isRecord(part) ||
          part.type !== "tool-result" ||
          typeof part.toolCallId !== "string" ||
          typeof part.toolName !== "string"
        ) {
          return []
        }

        return [
          {
            isError: isErrorToolResultOutput(part.output),
            output: getToolResultOutputValue(part.output),
            role: "tool",
            toolCallId: part.toolCallId,
            toolName: part.toolName
          }
        ]
      })
    }

    if (message.role === "system" || message.role === "user") {
      return [
        {
          content: getModelMessageText(message),
          role: message.role
        }
      ]
    }

    return []
  })

export const convertAgentLoopMessagesToModelMessages = (
  messages: readonly AgentLoopMessage[]
): ModelMessage[] =>
  messages.map((message): ModelMessage => {
    if (message.role === "assistant") {
      const content: AssistantModelMessage["content"] = [
        ...(message.content
          ? [
              {
                text: message.content,
                type: "text" as const
              }
            ]
          : []),
        ...message.toolCalls.map((toolCall) => ({
          input: toolCall.input,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          type: "tool-call" as const
        }))
      ]

      return {
        content: content.length > 0 ? content : "",
        role: "assistant"
      }
    }

    if (message.role === "tool") {
      return {
        content: [
          {
            output: toToolResultOutput({
              isError: message.isError,
              output: message.output
            }),
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            type: "tool-result"
          }
        ],
        role: "tool"
      }
    }

    return {
      content: message.content,
      role: message.role
    }
  })

const createModelOnlyToolSet = (tools: ToolSet | undefined): ToolSet => {
  if (!tools) {
    return {}
  }

  const modelTools: ToolSet = {}

  for (const [toolName, toolDefinition] of Object.entries(tools)) {
    const {
      execute: _execute,
      needsApproval: _needsApproval,
      onInputAvailable: _onInputAvailable,
      onInputDelta: _onInputDelta,
      onInputStart: _onInputStart,
      ...modelTool
    } = toolDefinition

    modelTools[toolName] = modelTool
  }

  return modelTools
}

const getActiveAiSdkToolNames = ({
  context,
  tools
}: {
  context: AgentLoopModelContext
  tools: ToolSet
}): string[] => {
  const toolNames = new Set(Object.keys(tools))

  return context.availableToolNames.filter((toolName) =>
    toolNames.has(toolName)
  )
}

const getExperimentalContext = ({
  context,
  metadata
}: {
  context: AgentLoopModelContext
  metadata?: Readonly<Record<string, unknown>>
}): Record<string, unknown> => ({
  ...metadata,
  ...context.resources,
  turnIndex: context.turnIndex
})

const toAgentLoopStopReason = ({
  aborted,
  finishReason
}: {
  aborted: boolean
  finishReason?: string
}): "aborted" | "error" | "stop" => {
  if (aborted) {
    return "aborted"
  }

  return finishReason === "error" ? "error" : "stop"
}

const createStreamToolCallAccumulator = (
  streamCallbacks?: AiSdkAgentLoopModelStreamCallbacks
) => {
  const emittedStreamToolCallIds = new Set<string>()
  const pendingStreamToolInputs = new Map<string, PendingStreamToolInput>()
  const toolCalls: AgentLoopToolCall[] = []
  const toolCallsById = new Map<string, AgentLoopToolCall>()
  const appendToolCall = (toolCall: AgentLoopToolCall): void => {
    if (emittedStreamToolCallIds.has(toolCall.toolCallId)) {
      return
    }

    emittedStreamToolCallIds.add(toolCall.toolCallId)
    pendingStreamToolInputs.delete(toolCall.toolCallId)
    toolCalls.push(toolCall)
    toolCallsById.set(toolCall.toolCallId, toolCall)
    streamCallbacks?.onToolCall?.(toolCall)
  }

  return {
    appendDelta: ({ delta, id }: { delta: string; id: string }) => {
      pendingStreamToolInputs.get(id)?.chunks.push(delta)
    },
    appendToolCall,
    endInput: (id: string) => {
      const pendingInput = pendingStreamToolInputs.get(id)

      if (!pendingInput) {
        return
      }

      appendToolCall({
        input: parseStreamedToolInput(pendingInput.chunks.join("")),
        toolCallId: id,
        toolName: pendingInput.toolName
      })
    },
    startInput: ({ id, toolName }: { id: string; toolName: string }) => {
      pendingStreamToolInputs.set(id, {
        chunks: [],
        toolName
      })
    },
    getToolCall: (toolCallId: string): AgentLoopToolCall | undefined =>
      toolCallsById.get(toolCallId),
    toolCalls
  }
}

export const collectAiSdkStreamTurn = async ({
  stream,
  streamCallbacks
}: CollectAiSdkStreamTurnOptions): Promise<{
  content: string
  finishReason?: string
  toolCalls: AgentLoopToolCall[]
  toolResults: AgentLoopModelToolResult[]
}> => {
  let content = ""
  let finishReason: string | undefined
  const toolCallAccumulator = createStreamToolCallAccumulator(streamCallbacks)
  const toolResults: AgentLoopModelToolResult[] = []
  const appendToolResult = async (
    toolResult: AgentLoopModelToolResult
  ): Promise<void> => {
    const existingToolCall = toolCallAccumulator.getToolCall(
      toolResult.toolCallId
    )
    const effectiveToolResult = {
      ...toolResult,
      input: toolResult.input ?? existingToolCall?.input
    }

    toolCallAccumulator.appendToolCall({
      input: effectiveToolResult.input,
      toolCallId: effectiveToolResult.toolCallId,
      toolName: effectiveToolResult.toolName
    })
    toolResults.push(effectiveToolResult)
    await streamCallbacks?.onToolResult?.(effectiveToolResult)
  }

  for await (const part of stream) {
    emitUiChunkForTextStreamPart({
      part,
      streamCallbacks
    })

    switch (part.type) {
      case "text-delta": {
        content += part.text
        streamCallbacks?.onTextDelta?.(part.text)
        break
      }
      case "tool-input-start": {
        toolCallAccumulator.startInput({
          id: part.id,
          toolName: part.toolName
        })
        break
      }
      case "tool-input-delta": {
        toolCallAccumulator.appendDelta({
          delta: part.delta,
          id: part.id
        })
        break
      }
      case "tool-input-end": {
        toolCallAccumulator.endInput(part.id)
        break
      }
      case "tool-call": {
        toolCallAccumulator.appendToolCall({
          input: part.input,
          toolCallId: part.toolCallId,
          toolName: part.toolName
        })
        break
      }
      case "tool-result": {
        await appendToolResult({
          input: part.input,
          isError: false,
          output: part.output,
          toolCallId: part.toolCallId,
          toolName: part.toolName
        })
        break
      }
      case "tool-error": {
        await appendToolResult({
          input: part.input,
          isError: true,
          output: part.error,
          toolCallId: part.toolCallId,
          toolName: part.toolName
        })
        break
      }
      case "tool-output-denied": {
        await appendToolResult({
          input: undefined,
          isError: true,
          output: {
            reason: "Provider denied tool output.",
            type: "execution-denied"
          },
          toolCallId: part.toolCallId,
          toolName: part.toolName
        })
        break
      }
      case "finish-step": {
        ;({ finishReason } = part)
        break
      }
      case "error": {
        throw part.error
      }
      default: {
        break
      }
    }
  }

  streamCallbacks?.onFinish?.()

  return {
    content,
    finishReason,
    toolCalls: toolCallAccumulator.toolCalls,
    toolResults
  }
}

export const createAiSdkToolResultSummaryProcessor =
  ({
    headers,
    maxInputChars = DEFAULT_TOOL_RESULT_SUMMARY_PROCESSOR_INPUT_MAX_CHARS,
    metadata,
    model
  }: CreateAiSdkToolResultSummaryProcessorOptions): AgentToolResultSummaryProcessor =>
  async ({ content, deterministicSummary, maxSummaryChars }) => {
    const inputSummary = summarizeToolResult(content, maxInputChars)
    const inputAnnotation = formatToolResultSummaryAnnotation(inputSummary, {
      label: "processor input"
    })
    const result = await generateText({
      experimental_context: {
        ...metadata,
        summaryProcessor: "tool-result"
      },
      headers,
      messages: [
        {
          content: [
            "Summarize this tool output for the next Etyon code-agent step.",
            `Keep the summary under ${maxSummaryChars} characters.`,
            "Preserve file paths, commands, errors, counts, changed symbols, and decisions.",
            "Do not include generic commentary.",
            "",
            `Original size: ${deterministicSummary.totalChars} characters.`,
            inputAnnotation,
            "",
            inputSummary.content
          ]
            .filter(Boolean)
            .join("\n"),
          role: "user"
        }
      ],
      model
    })

    return result.text
  }

export const createAiSdkAgentLoopModel =
  ({
    headers,
    metadata,
    model,
    mode = "generate",
    streamCallbacks,
    system,
    tools
  }: CreateAiSdkAgentLoopModelOptions): AgentLoopModel =>
  async (context) => {
    const modelTools = createModelOnlyToolSet(tools)
    const commonOptions = {
      abortSignal: context.abortSignal,
      activeTools: getActiveAiSdkToolNames({
        context,
        tools: modelTools
      }),
      experimental_context: getExperimentalContext({
        context,
        metadata
      }),
      headers,
      messages: convertAgentLoopMessagesToModelMessages(context.messages),
      model,
      stopWhen: stepCountIs(1),
      ...(system ? { system } : {}),
      tools: modelTools
    }

    try {
      if (mode === "stream") {
        const result = streamText(commonOptions)
        const streamTurn = await collectAiSdkStreamTurn({
          stream: result.fullStream as AsyncIterable<TextStreamPart<ToolSet>>,
          streamCallbacks
        })

        return {
          content: streamTurn.content,
          stopReason: toAgentLoopStopReason({
            aborted: Boolean(context.abortSignal?.aborted),
            finishReason: streamTurn.finishReason
          }),
          toolCalls: streamTurn.toolCalls,
          toolResults: streamTurn.toolResults
        }
      }

      const result = await generateText({
        ...commonOptions
      })

      return {
        content: result.text,
        stopReason: toAgentLoopStopReason({
          aborted: Boolean(context.abortSignal?.aborted),
          finishReason: result.finishReason
        }),
        toolCalls: result.toolCalls.map((toolCall) => ({
          input: toolCall.input,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName
        })),
        toolResults: result.toolResults.map((toolResult) => ({
          input: toolResult.input,
          isError: false,
          output: toolResult.output,
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName
        }))
      }
    } catch (error) {
      if (context.abortSignal?.aborted) {
        return {
          content: "",
          stopReason: "aborted",
          toolCalls: []
        }
      }

      throw error
    }
  }

export const createAiSdkAgentLoopTools = ({
  metadata,
  tools
}: CreateAiSdkAgentLoopToolsOptions): Record<string, AgentLoopTool> =>
  Object.fromEntries(
    Object.entries(tools).map(([toolName, toolDefinition]) => [
      toolName,
      {
        execute: async (input, context) => {
          const { execute } = toolDefinition

          if (!execute) {
            throw new Error(`Tool is not executable: ${toolName}`)
          }

          const output = await execute(input, {
            abortSignal: context.abortSignal,
            experimental_context: {
              ...metadata,
              toolName,
              ...(context.toolCall.input === input
                ? {}
                : { originalInput: input })
            },
            messages: convertAgentLoopMessagesToModelMessages(context.messages),
            toolCallId: context.toolCall.toolCallId
          } satisfies ToolExecutionOptions)

          return isAsyncIterable(output)
            ? await collectAsyncIterable(output)
            : output
        }
      }
    ])
  )
