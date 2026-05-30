import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import type {
  AssistantModelMessage,
  JSONValue,
  LanguageModel,
  ModelMessage,
  TextStreamPart,
  ToolExecutionOptions,
  ToolSet
} from "ai"
import { generateText, stepCountIs, streamText } from "ai"

import type {
  AgentLoopMessage,
  AgentLoopModel,
  AgentLoopModelContext,
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

const DEFAULT_TOOL_RESULT_SUMMARY_PROCESSOR_INPUT_MAX_CHARS = 24_000

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
        let content = ""
        let finishReason: string | undefined
        const toolCalls: AgentLoopToolCall[] = []

        for await (const part of result.fullStream as AsyncIterable<
          TextStreamPart<ToolSet>
        >) {
          if (part.type === "text-delta") {
            content += part.text
            streamCallbacks?.onTextDelta?.(part.text)
            continue
          }

          if (part.type === "tool-call") {
            const toolCall = {
              input: part.input,
              toolCallId: part.toolCallId,
              toolName: part.toolName
            }

            toolCalls.push(toolCall)
            streamCallbacks?.onToolCall?.(toolCall)
            continue
          }

          if (part.type === "finish-step") {
            ;({ finishReason } = part)
            continue
          }

          if (part.type === "error") {
            throw part.error
          }
        }

        streamCallbacks?.onFinish?.()

        return {
          content,
          stopReason: toAgentLoopStopReason({
            aborted: Boolean(context.abortSignal?.aborted),
            finishReason
          }),
          toolCalls
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
