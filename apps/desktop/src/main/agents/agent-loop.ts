export type AgentLoopStopReason =
  | "aborted"
  | "error"
  | "final"
  | "max_turns"
  | "suspended"
  | "terminated"
  | "user_stopped"

const AGENT_LOOP_ABORTED_MESSAGE = "Agent loop aborted."

export type AgentLoopToolExecutionMode = "parallel" | "sequential"
export type AgentLoopResources = Readonly<Record<string, unknown>>

export interface AgentLoopToolCall {
  input: unknown
  toolCallId: string
  toolName: string
}

export interface AgentLoopUserMessage {
  content: string
  role: "system" | "user"
}

export interface AgentLoopAssistantMessage {
  content: string
  role: "assistant"
  toolCalls: AgentLoopToolCall[]
}

export interface AgentLoopToolMessage {
  isError: boolean
  output: unknown
  role: "tool"
  toolCallId: string
  toolName: string
}

export interface AgentLoopModelToolResult {
  input: unknown
  isError: boolean
  output: unknown
  toolCallId: string
  toolName: string
}

export type AgentLoopMessage =
  | AgentLoopAssistantMessage
  | AgentLoopToolMessage
  | AgentLoopUserMessage

export interface AgentLoopModelContext {
  abortSignal?: AbortSignal
  availableToolNames: readonly string[]
  messages: readonly AgentLoopMessage[]
  resources?: AgentLoopResources
  thinkingLevel?: string
  turnIndex: number
}

export interface AgentLoopModelTurn {
  content: string
  stopReason?: "aborted" | "error" | "stop"
  toolCalls?: readonly AgentLoopToolCall[]
  toolResults?: readonly AgentLoopModelToolResult[]
}

export type AgentLoopModel = (
  context: AgentLoopModelContext
) => Promise<AgentLoopModelTurn> | AgentLoopModelTurn

export type AgentLoopModelStreamPart =
  | {
      text: string
      type: "text-delta"
    }
  | {
      toolCall: AgentLoopToolCall
      type: "tool-call"
    }
  | {
      toolResult: AgentLoopModelToolResult
      type: "tool-result"
    }
  | {
      stopReason?: AgentLoopModelTurn["stopReason"]
      type: "finish"
    }

export type AgentLoopModelStream =
  | AsyncIterable<AgentLoopModelStreamPart>
  | ReadableStream<AgentLoopModelStreamPart>

export interface CreateAgentLoopStreamModelOptions {
  stream: (
    context: AgentLoopModelContext
  ) => AgentLoopModelStream | Promise<AgentLoopModelStream>
}

export interface AgentLoopToolExecutionContext {
  abortSignal?: AbortSignal
  messages: readonly AgentLoopMessage[]
  toolCall: AgentLoopToolCall
}

export interface AgentLoopTool {
  execute: (
    input: unknown,
    context: AgentLoopToolExecutionContext
  ) => Promise<unknown> | unknown
  executionMode?: AgentLoopToolExecutionMode
}

export interface AgentLoopBeforeToolCallContext {
  messages: readonly AgentLoopMessage[]
  toolCall: AgentLoopToolCall
}

export interface AgentLoopBeforeToolCallResult {
  block?: boolean
  input?: unknown
  reason?: string
  suspend?: boolean
}

export interface AgentLoopExecutedToolResult {
  deferred?: boolean
  isError: boolean
  output: unknown
  sourceIndex: number
  terminate: boolean
  toolCall: AgentLoopToolCall
}

export interface AgentLoopAfterToolCallContext {
  messages: readonly AgentLoopMessage[]
  result: AgentLoopExecutedToolResult
}

export interface AgentLoopAfterToolCallResult {
  isError?: boolean
  output?: unknown
  terminate?: boolean
}

export interface AgentLoopToolRetryContext {
  attempt: number
  maxRetries: number
  messages: readonly AgentLoopMessage[]
  result: AgentLoopExecutedToolResult
  toolCall: AgentLoopToolCall
}

export interface AgentLoopToolRetryPolicy {
  maxRetries: number
  shouldRetry?: (
    context: AgentLoopToolRetryContext
  ) => Promise<boolean> | boolean
}

export type AgentLoopEventType =
  | "agent_loop_finished"
  | "agent_turn_started"
  | "assistant_message_appended"
  | "follow_up_message_appended"
  | "steering_message_appended"
  | "tool_execution_finished"
  | "tool_execution_retrying"
  | "tool_execution_started"
  | "tool_result_appended"

export interface AgentLoopEvent {
  attempt?: number
  isError?: boolean
  maxRetries?: number
  output?: unknown
  sourceIndex?: number
  stopReason?: AgentLoopStopReason
  terminate?: boolean
  toolCallId?: string
  toolName?: string
  turnIndex?: number
  turns?: number
  type: AgentLoopEventType
}

export interface RunAgentLoopOptions {
  abortSignal?: AbortSignal
  activeToolNames?: readonly string[]
  afterToolCall?: (
    result: AgentLoopExecutedToolResult,
    context: AgentLoopAfterToolCallContext
  ) => AgentLoopAfterToolCallResult | Promise<AgentLoopAfterToolCallResult>
  beforeToolCall?: (
    toolCall: AgentLoopToolCall,
    context: AgentLoopBeforeToolCallContext
  ) => AgentLoopBeforeToolCallResult | Promise<AgentLoopBeforeToolCallResult>
  getFollowUpMessages?: (context: {
    messages: readonly AgentLoopMessage[]
    turnIndex: number
  }) =>
    | Promise<readonly AgentLoopUserMessage[]>
    | readonly AgentLoopUserMessage[]
  getSteeringMessages?: (context: {
    messages: readonly AgentLoopMessage[]
    turnIndex: number
  }) =>
    | Promise<readonly AgentLoopUserMessage[]>
    | readonly AgentLoopUserMessage[]
  maxTurns: number
  messages: readonly AgentLoopMessage[]
  model: AgentLoopModel
  onEvent?: (event: AgentLoopEvent) => Promise<void> | void
  prepareNextTurn?: (context: {
    activeToolNames?: readonly string[]
    availableToolNames: readonly string[]
    messages: readonly AgentLoopMessage[]
    model: AgentLoopModel
    resources?: AgentLoopResources
    thinkingLevel?: string
    tools: Record<string, AgentLoopTool>
    turnIndex: number
  }) =>
    | Promise<{
        activeToolNames?: readonly string[]
        messages?: readonly AgentLoopMessage[]
        model?: AgentLoopModel
        resources?: AgentLoopResources
        thinkingLevel?: string
        tools?: Record<string, AgentLoopTool>
      }>
    | {
        activeToolNames?: readonly string[]
        messages?: readonly AgentLoopMessage[]
        model?: AgentLoopModel
        resources?: AgentLoopResources
        thinkingLevel?: string
        tools?: Record<string, AgentLoopTool>
      }
  resources?: AgentLoopResources
  shouldStopAfterTurn?: (context: {
    messages: readonly AgentLoopMessage[]
    turnIndex: number
  }) => Promise<boolean> | boolean
  thinkingLevel?: string
  toolRetry?: AgentLoopToolRetryPolicy
  tools: Record<string, AgentLoopTool>
}

export interface RunAgentLoopResult {
  messages: AgentLoopMessage[]
  stopReason: AgentLoopStopReason
  turns: number
}

interface PreparedToolCall {
  input: unknown
  sourceIndex: number
  tool: AgentLoopTool
  toolCall: AgentLoopToolCall
}

interface AgentLoopNextTurnState {
  activeToolNames?: readonly string[]
  messages: AgentLoopMessage[]
  model: AgentLoopModel
  resources?: AgentLoopResources
  thinkingLevel?: string
  tools: Record<string, AgentLoopTool>
}

interface AgentLoopModelStreamState {
  content: string
  stopReason?: AgentLoopModelTurn["stopReason"]
  toolCalls: AgentLoopToolCall[]
  toolResults: AgentLoopModelToolResult[]
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const createAgentLoopAbortError = (): Error =>
  new Error(AGENT_LOOP_ABORTED_MESSAGE)

const isPromiseLike = <TValue>(value: unknown): value is PromiseLike<TValue> =>
  typeof value === "object" &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function"

const emitAgentLoopEvent = async (
  onEvent: RunAgentLoopOptions["onEvent"],
  event: AgentLoopEvent
): Promise<void> => {
  await onEvent?.(structuredClone(event) as AgentLoopEvent)
}

const waitForPromiseWithAbortSignal = async <TValue>({
  abortSignal,
  promise
}: {
  abortSignal?: AbortSignal
  promise: PromiseLike<TValue>
}): Promise<TValue> => {
  if (!abortSignal) {
    return promise
  }

  if (abortSignal.aborted) {
    throw createAgentLoopAbortError()
  }

  const { promise: abortPromise, reject } = Promise.withResolvers<never>()
  const rejectAborted = (): void => {
    reject(createAgentLoopAbortError())
  }

  abortSignal.addEventListener("abort", rejectAborted, {
    once: true
  })

  try {
    return await Promise.race([promise, abortPromise])
  } finally {
    abortSignal.removeEventListener("abort", rejectAborted)
  }
}

const cloneAgentLoopResources = (
  resources: AgentLoopResources | undefined
): AgentLoopResources | undefined =>
  resources ? (structuredClone(resources) as AgentLoopResources) : undefined

const cloneAgentLoopMessages = (
  messages: readonly AgentLoopMessage[]
): AgentLoopMessage[] => structuredClone(messages) as AgentLoopMessage[]

const cloneAgentLoopValue = <TValue>(value: TValue): TValue =>
  structuredClone(value) as TValue

const cloneAgentLoopToolCall = (
  toolCall: AgentLoopToolCall
): AgentLoopToolCall => cloneAgentLoopValue(toolCall)

const cloneAgentLoopToolCalls = (
  toolCalls: readonly AgentLoopToolCall[]
): AgentLoopToolCall[] => toolCalls.map(cloneAgentLoopToolCall)

const cloneAgentLoopUserMessages = (
  userMessages: readonly AgentLoopUserMessage[]
): AgentLoopUserMessage[] =>
  structuredClone(userMessages) as AgentLoopUserMessage[]

const cloneAgentLoopExecutedToolResult = (
  result: AgentLoopExecutedToolResult
): AgentLoopExecutedToolResult => cloneAgentLoopValue(result)

const createAgentLoopModelStreamState = (): AgentLoopModelStreamState => ({
  content: "",
  toolCalls: [],
  toolResults: []
})

const appendAgentLoopModelToolResult = ({
  state,
  toolResult
}: {
  state: {
    toolCalls: AgentLoopToolCall[]
    toolResults: AgentLoopModelToolResult[]
  }
  toolResult: AgentLoopModelToolResult
}): void => {
  if (
    !state.toolCalls.some(
      (toolCall) => toolCall.toolCallId === toolResult.toolCallId
    )
  ) {
    state.toolCalls.push({
      input: cloneAgentLoopValue(toolResult.input),
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName
    })
  }

  state.toolResults.push(cloneAgentLoopValue(toolResult))
}

const applyAgentLoopModelStreamPart = (
  state: AgentLoopModelStreamState,
  part: AgentLoopModelStreamPart
): void => {
  switch (part.type) {
    case "finish": {
      state.stopReason = part.stopReason
      break
    }
    case "text-delta": {
      state.content += part.text
      break
    }
    case "tool-call": {
      state.toolCalls.push(cloneAgentLoopToolCall(part.toolCall))
      break
    }
    case "tool-result": {
      appendAgentLoopModelToolResult({
        state,
        toolResult: cloneAgentLoopValue(part.toolResult)
      })
      break
    }
    default: {
      throw new Error("Unknown agent loop model stream part.")
    }
  }
}

const createAgentLoopModelTurnFromStreamState = ({
  content,
  stopReason,
  toolCalls,
  toolResults
}: AgentLoopModelStreamState): AgentLoopModelTurn => ({
  content,
  ...(stopReason ? { stopReason } : {}),
  toolCalls,
  toolResults
})

const isReadableAgentLoopModelStream = (
  stream: AgentLoopModelStream
): stream is ReadableStream<AgentLoopModelStreamPart> => {
  const maybeReadableStream = stream as { getReader?: unknown }

  return typeof maybeReadableStream.getReader === "function"
}

const readReadableAgentLoopModelStream = async ({
  abortSignal,
  stream
}: {
  abortSignal?: AbortSignal
  stream: ReadableStream<AgentLoopModelStreamPart>
}): Promise<AgentLoopModelTurn> => {
  const reader = stream.getReader()
  const state = createAgentLoopModelStreamState()

  if (abortSignal?.aborted) {
    await reader.cancel(createAgentLoopAbortError())
    reader.releaseLock()

    return createAgentLoopModelTurnFromStreamState({
      ...state,
      stopReason: "aborted"
    })
  }

  const abort = abortSignal ? Promise.withResolvers<"aborted">() : undefined
  const abortListener = (): void => {
    void reader.cancel(createAgentLoopAbortError())
    abort?.resolve("aborted")
  }

  abortSignal?.addEventListener("abort", abortListener, {
    once: true
  })

  try {
    while (true) {
      const readResult = abort
        ? await Promise.race([reader.read(), abort.promise])
        : await reader.read()

      if (readResult === "aborted") {
        return createAgentLoopModelTurnFromStreamState({
          ...state,
          stopReason: "aborted"
        })
      }

      if (readResult.done) {
        return createAgentLoopModelTurnFromStreamState(state)
      }

      applyAgentLoopModelStreamPart(state, readResult.value)

      if (state.stopReason) {
        return createAgentLoopModelTurnFromStreamState(state)
      }
    }
  } finally {
    abortSignal?.removeEventListener("abort", abortListener)
    reader.releaseLock()
  }
}

const readAsyncIterableAgentLoopModelStream = async ({
  abortSignal,
  stream
}: {
  abortSignal?: AbortSignal
  stream: AsyncIterable<AgentLoopModelStreamPart>
}): Promise<AgentLoopModelTurn> => {
  const iterator = stream[Symbol.asyncIterator]()
  const state = createAgentLoopModelStreamState()

  if (abortSignal?.aborted) {
    await iterator.return?.()

    return createAgentLoopModelTurnFromStreamState({
      ...state,
      stopReason: "aborted"
    })
  }

  const abort = abortSignal ? Promise.withResolvers<"aborted">() : undefined
  const abortListener = (): void => {
    void iterator.return?.()
    abort?.resolve("aborted")
  }

  abortSignal?.addEventListener("abort", abortListener, {
    once: true
  })

  try {
    while (true) {
      const nextResult = abort
        ? await Promise.race([iterator.next(), abort.promise])
        : await iterator.next()

      if (nextResult === "aborted") {
        return createAgentLoopModelTurnFromStreamState({
          ...state,
          stopReason: "aborted"
        })
      }

      if (nextResult.done) {
        return createAgentLoopModelTurnFromStreamState(state)
      }

      applyAgentLoopModelStreamPart(state, nextResult.value)

      if (state.stopReason) {
        return createAgentLoopModelTurnFromStreamState(state)
      }
    }
  } finally {
    abortSignal?.removeEventListener("abort", abortListener)
  }
}

export const createAgentLoopStreamModel =
  ({ stream }: CreateAgentLoopStreamModelOptions): AgentLoopModel =>
  async (context) => {
    let modelStream: AgentLoopModelStream

    try {
      modelStream = await waitForPromiseWithAbortSignal({
        abortSignal: context.abortSignal,
        promise: Promise.resolve(stream(context))
      })
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

    return isReadableAgentLoopModelStream(modelStream)
      ? readReadableAgentLoopModelStream({
          abortSignal: context.abortSignal,
          stream: modelStream
        })
      : readAsyncIterableAgentLoopModelStream({
          abortSignal: context.abortSignal,
          stream: modelStream
        })
  }

const buildErrorResult = ({
  message,
  sourceIndex,
  toolCall
}: {
  message: string
  sourceIndex: number
  toolCall: AgentLoopToolCall
}): AgentLoopExecutedToolResult => ({
  isError: true,
  output: {
    error: message
  },
  sourceIndex,
  terminate: false,
  toolCall: cloneAgentLoopToolCall(toolCall)
})

const createActiveToolNameSet = (
  activeToolNames: readonly string[] | undefined
): ReadonlySet<string> | undefined =>
  activeToolNames ? new Set(activeToolNames) : undefined

const getAvailableToolNames = ({
  activeToolNames,
  tools
}: {
  activeToolNames?: readonly string[]
  tools: Record<string, AgentLoopTool>
}): string[] => {
  const toolNames = Object.keys(tools)
  const activeToolNameSet = createActiveToolNameSet(activeToolNames)

  return activeToolNameSet
    ? toolNames.filter((toolName) => activeToolNameSet.has(toolName))
    : toolNames
}

const prepareToolCall = async ({
  activeToolNames,
  beforeToolCall,
  messages,
  sourceIndex,
  toolCall,
  tools
}: {
  activeToolNames: readonly string[] | undefined
  beforeToolCall: RunAgentLoopOptions["beforeToolCall"]
  messages: readonly AgentLoopMessage[]
  sourceIndex: number
  toolCall: AgentLoopToolCall
  tools: Record<string, AgentLoopTool>
}): Promise<AgentLoopExecutedToolResult | PreparedToolCall> => {
  const activeToolNameSet = createActiveToolNameSet(activeToolNames)

  if (activeToolNameSet && !activeToolNameSet.has(toolCall.toolName)) {
    return buildErrorResult({
      message: `Tool is not active: ${toolCall.toolName}`,
      sourceIndex,
      toolCall
    })
  }

  const tool = tools[toolCall.toolName]

  if (!tool) {
    return buildErrorResult({
      message: `Unknown tool: ${toolCall.toolName}`,
      sourceIndex,
      toolCall
    })
  }

  if (!beforeToolCall) {
    return {
      input: cloneAgentLoopValue(toolCall.input),
      sourceIndex,
      tool,
      toolCall: cloneAgentLoopToolCall(toolCall)
    }
  }

  try {
    const hookResult = await beforeToolCall(cloneAgentLoopToolCall(toolCall), {
      messages: cloneAgentLoopMessages(messages),
      toolCall: cloneAgentLoopToolCall(toolCall)
    })

    if (hookResult.block) {
      return buildErrorResult({
        message: hookResult.reason ?? "Tool call was blocked.",
        sourceIndex,
        toolCall
      })
    }

    if (hookResult.suspend) {
      return {
        deferred: true,
        isError: false,
        output: {
          reason: hookResult.reason ?? "Tool call was suspended."
        },
        sourceIndex,
        terminate: true,
        toolCall: cloneAgentLoopToolCall(toolCall)
      }
    }

    return {
      input:
        hookResult.input === undefined
          ? cloneAgentLoopValue(toolCall.input)
          : cloneAgentLoopValue(hookResult.input),
      sourceIndex,
      tool,
      toolCall: cloneAgentLoopToolCall(toolCall)
    }
  } catch (error) {
    return buildErrorResult({
      message: getErrorMessage(error),
      sourceIndex,
      toolCall
    })
  }
}

const isPreparedToolCall = (
  value: AgentLoopExecutedToolResult | PreparedToolCall
): value is PreparedToolCall => "tool" in value

const finalizeToolResult = async ({
  afterToolCall,
  messages,
  result
}: {
  afterToolCall: RunAgentLoopOptions["afterToolCall"]
  messages: readonly AgentLoopMessage[]
  result: AgentLoopExecutedToolResult
}): Promise<AgentLoopExecutedToolResult> => {
  if (!afterToolCall) {
    return result
  }

  try {
    const hookResult = await afterToolCall(
      cloneAgentLoopExecutedToolResult(result),
      {
        messages: cloneAgentLoopMessages(messages),
        result: cloneAgentLoopExecutedToolResult(result)
      }
    )
    const output =
      hookResult.output === undefined
        ? result.output
        : cloneAgentLoopValue(hookResult.output)

    return {
      ...result,
      isError: hookResult.isError ?? result.isError,
      output,
      terminate: hookResult.terminate ?? result.terminate,
      toolCall: cloneAgentLoopToolCall(result.toolCall)
    }
  } catch (error) {
    return {
      ...result,
      isError: true,
      output: {
        error: getErrorMessage(error)
      },
      terminate: false,
      toolCall: cloneAgentLoopToolCall(result.toolCall)
    }
  }
}

const getBoundedToolRetryMaxRetries = (
  toolRetry: AgentLoopToolRetryPolicy | undefined
): number => Math.max(0, Math.floor(toolRetry?.maxRetries ?? 0))

const shouldRetryToolResult = async ({
  attempt,
  messages,
  result,
  toolRetry
}: {
  attempt: number
  messages: readonly AgentLoopMessage[]
  result: AgentLoopExecutedToolResult
  toolRetry: AgentLoopToolRetryPolicy | undefined
}): Promise<boolean> => {
  if (!result.isError) {
    return false
  }

  const maxRetries = getBoundedToolRetryMaxRetries(toolRetry)

  if (attempt > maxRetries) {
    return false
  }

  if (!toolRetry?.shouldRetry) {
    return true
  }

  try {
    return await toolRetry.shouldRetry({
      attempt,
      maxRetries,
      messages: cloneAgentLoopMessages(messages),
      result: cloneAgentLoopExecutedToolResult(result),
      toolCall: cloneAgentLoopToolCall(result.toolCall)
    })
  } catch {
    return false
  }
}

const executePreparedToolCall = async ({
  abortSignal,
  afterToolCall,
  messages,
  onEvent,
  prepared,
  toolRetry
}: {
  abortSignal: AbortSignal | undefined
  afterToolCall: RunAgentLoopOptions["afterToolCall"]
  messages: readonly AgentLoopMessage[]
  onEvent: RunAgentLoopOptions["onEvent"]
  prepared: PreparedToolCall
  toolRetry: RunAgentLoopOptions["toolRetry"]
}): Promise<AgentLoopExecutedToolResult> => {
  const { input, sourceIndex, tool, toolCall } = prepared
  let attempt = 0

  while (true) {
    attempt += 1

    if (abortSignal?.aborted) {
      return buildErrorResult({
        message: AGENT_LOOP_ABORTED_MESSAGE,
        sourceIndex,
        toolCall: {
          ...toolCall,
          input
        }
      })
    }

    await emitAgentLoopEvent(onEvent, {
      attempt,
      sourceIndex,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      type: "tool_execution_started"
    })

    let result: AgentLoopExecutedToolResult

    try {
      const toolInput = cloneAgentLoopValue(input)
      const outputOrPromise = tool.execute(toolInput, {
        abortSignal,
        messages: cloneAgentLoopMessages(messages),
        toolCall: cloneAgentLoopToolCall({
          ...toolCall,
          input: toolInput
        })
      })
      const output = isPromiseLike<unknown>(outputOrPromise)
        ? await waitForPromiseWithAbortSignal({
            abortSignal,
            promise: outputOrPromise
          })
        : outputOrPromise

      result = {
        isError: false,
        output,
        sourceIndex,
        terminate: false,
        toolCall: cloneAgentLoopToolCall({
          ...toolCall,
          input
        })
      }
    } catch (error) {
      result = buildErrorResult({
        message: getErrorMessage(error),
        sourceIndex,
        toolCall: {
          ...toolCall,
          input
        }
      })
    }

    if (
      await shouldRetryToolResult({
        attempt,
        messages,
        result,
        toolRetry
      })
    ) {
      await emitAgentLoopEvent(onEvent, {
        attempt,
        isError: result.isError,
        maxRetries: getBoundedToolRetryMaxRetries(toolRetry),
        output: result.output,
        sourceIndex,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        type: "tool_execution_retrying"
      })
      continue
    }

    const finalizedResult = await finalizeToolResult({
      afterToolCall,
      messages,
      result
    })

    await emitAgentLoopEvent(onEvent, {
      attempt,
      isError: finalizedResult.isError,
      output: finalizedResult.output,
      sourceIndex,
      terminate: finalizedResult.terminate,
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      type: "tool_execution_finished"
    })

    return finalizedResult
  }
}

const executeToolBatch = async ({
  activeToolNames,
  abortSignal,
  afterToolCall,
  beforeToolCall,
  messages,
  onEvent,
  toolCalls,
  toolRetry,
  tools
}: {
  activeToolNames: readonly string[] | undefined
  abortSignal: AbortSignal | undefined
  afterToolCall: RunAgentLoopOptions["afterToolCall"]
  beforeToolCall: RunAgentLoopOptions["beforeToolCall"]
  messages: readonly AgentLoopMessage[]
  onEvent: RunAgentLoopOptions["onEvent"]
  toolCalls: readonly AgentLoopToolCall[]
  toolRetry: RunAgentLoopOptions["toolRetry"]
  tools: Record<string, AgentLoopTool>
}): Promise<AgentLoopExecutedToolResult[]> => {
  const preparedResults: (AgentLoopExecutedToolResult | PreparedToolCall)[] = []

  for (const [sourceIndex, toolCall] of toolCalls.entries()) {
    preparedResults.push(
      await prepareToolCall({
        activeToolNames,
        beforeToolCall,
        messages,
        sourceIndex,
        toolCall,
        tools
      })
    )
  }

  const hasSequentialTool = preparedResults.some(
    (prepared) =>
      isPreparedToolCall(prepared) &&
      prepared.tool.executionMode === "sequential"
  )
  const executePrepared = (prepared: PreparedToolCall) =>
    executePreparedToolCall({
      abortSignal,
      afterToolCall,
      messages,
      onEvent,
      prepared,
      toolRetry
    })
  const results = [...preparedResults]

  if (hasSequentialTool) {
    for (const [index, prepared] of preparedResults.entries()) {
      if (isPreparedToolCall(prepared)) {
        results[index] = await executePrepared(prepared)
      }
    }

    return results as AgentLoopExecutedToolResult[]
  }

  await Promise.all(
    preparedResults.map(async (prepared, index) => {
      if (isPreparedToolCall(prepared)) {
        results[index] = await executePrepared(prepared)
      }
    })
  )

  return results as AgentLoopExecutedToolResult[]
}

const appendToolResults = async ({
  messages,
  onEvent,
  results
}: {
  messages: AgentLoopMessage[]
  onEvent: RunAgentLoopOptions["onEvent"]
  results: readonly AgentLoopExecutedToolResult[]
}): Promise<void> => {
  for (const result of results) {
    if (result.deferred) {
      continue
    }

    const toolMessage: AgentLoopToolMessage = {
      isError: result.isError,
      output: cloneAgentLoopValue(result.output),
      role: "tool",
      toolCallId: result.toolCall.toolCallId,
      toolName: result.toolCall.toolName
    }

    messages.push(toolMessage)
    await emitAgentLoopEvent(onEvent, {
      isError: result.isError,
      output: result.output,
      sourceIndex: result.sourceIndex,
      terminate: result.terminate,
      toolCallId: result.toolCall.toolCallId,
      toolName: result.toolCall.toolName,
      type: "tool_result_appended"
    })
  }
}

const getToolCallKey = (toolCallId: string): string => toolCallId

const createProvidedToolExecutionResults = ({
  toolCalls,
  toolResults
}: {
  toolCalls: readonly AgentLoopToolCall[]
  toolResults: readonly AgentLoopModelToolResult[]
}): AgentLoopExecutedToolResult[] => {
  const toolCallsById = new Map(
    toolCalls.map((toolCall, sourceIndex) => [
      getToolCallKey(toolCall.toolCallId),
      {
        sourceIndex,
        toolCall
      }
    ])
  )

  return toolResults.map((toolResult, resultIndex) => {
    const matchedToolCall = toolCallsById.get(
      getToolCallKey(toolResult.toolCallId)
    )

    return {
      isError: toolResult.isError,
      output: cloneAgentLoopValue(toolResult.output),
      sourceIndex:
        matchedToolCall?.sourceIndex ?? toolCalls.length + resultIndex,
      terminate: false,
      toolCall: cloneAgentLoopToolCall(
        matchedToolCall?.toolCall ?? {
          input: toolResult.input,
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName
        }
      )
    }
  })
}

const getExecutableToolCallEntries = ({
  providedToolResults,
  toolCalls
}: {
  providedToolResults: readonly AgentLoopModelToolResult[]
  toolCalls: readonly AgentLoopToolCall[]
}): { sourceIndex: number; toolCall: AgentLoopToolCall }[] => {
  const providedToolCallIds = new Set(
    providedToolResults.map((toolResult) =>
      getToolCallKey(toolResult.toolCallId)
    )
  )

  return toolCalls.flatMap((toolCall, sourceIndex) =>
    providedToolCallIds.has(getToolCallKey(toolCall.toolCallId))
      ? []
      : [
          {
            sourceIndex,
            toolCall
          }
        ]
  )
}

const appendAgentLoopUserMessages = async ({
  eventType,
  messages,
  onEvent,
  turnIndex,
  userMessages
}: {
  eventType: "follow_up_message_appended" | "steering_message_appended"
  messages: AgentLoopMessage[]
  onEvent: RunAgentLoopOptions["onEvent"]
  turnIndex: number
  userMessages: readonly AgentLoopUserMessage[]
}): Promise<void> => {
  for (const message of userMessages) {
    messages.push(cloneAgentLoopValue(message))
    await emitAgentLoopEvent(onEvent, {
      turnIndex,
      type: eventType
    })
  }
}

const getAgentLoopUserMessages = async ({
  getMessages,
  messages,
  turnIndex
}: {
  getMessages:
    | RunAgentLoopOptions["getFollowUpMessages"]
    | RunAgentLoopOptions["getSteeringMessages"]
  messages: readonly AgentLoopMessage[]
  turnIndex: number
}): Promise<readonly AgentLoopUserMessage[]> => {
  const userMessages = await getMessages?.({
    messages: cloneAgentLoopMessages(messages),
    turnIndex
  })

  return userMessages ? cloneAgentLoopUserMessages(userMessages) : []
}

const prepareAgentLoopNextTurn = async ({
  activeToolNames,
  messages,
  model,
  prepareNextTurn,
  resources,
  thinkingLevel,
  tools,
  turnIndex
}: {
  activeToolNames: readonly string[] | undefined
  messages: AgentLoopMessage[]
  model: AgentLoopModel
  prepareNextTurn: RunAgentLoopOptions["prepareNextTurn"]
  resources: AgentLoopResources | undefined
  thinkingLevel: string | undefined
  tools: Record<string, AgentLoopTool>
  turnIndex: number
}): Promise<AgentLoopNextTurnState> => {
  const availableToolNames = getAvailableToolNames({
    activeToolNames,
    tools
  })
  const preparedNextTurn = await prepareNextTurn?.({
    activeToolNames,
    availableToolNames,
    messages: cloneAgentLoopMessages(messages),
    model,
    resources: cloneAgentLoopResources(resources),
    thinkingLevel,
    tools,
    turnIndex
  })

  return {
    activeToolNames: preparedNextTurn?.activeToolNames ?? activeToolNames,
    messages: preparedNextTurn?.messages
      ? cloneAgentLoopMessages(preparedNextTurn.messages)
      : messages,
    model: preparedNextTurn?.model ?? model,
    resources:
      preparedNextTurn?.resources === undefined
        ? resources
        : cloneAgentLoopResources(preparedNextTurn.resources),
    thinkingLevel: preparedNextTurn?.thinkingLevel ?? thinkingLevel,
    tools: preparedNextTurn?.tools ?? tools
  }
}

const shouldStopAgentLoopTurn = async ({
  messages,
  shouldStopAfterTurn,
  turnIndex
}: {
  messages: readonly AgentLoopMessage[]
  shouldStopAfterTurn: RunAgentLoopOptions["shouldStopAfterTurn"]
  turnIndex: number
}): Promise<boolean> =>
  (await shouldStopAfterTurn?.({
    messages: cloneAgentLoopMessages(messages),
    turnIndex
  })) ?? false

const finishAgentLoop = async ({
  messages,
  onEvent,
  stopReason,
  turns
}: {
  messages: AgentLoopMessage[]
  onEvent: RunAgentLoopOptions["onEvent"]
  stopReason: AgentLoopStopReason
  turns: number
}): Promise<RunAgentLoopResult> => {
  await emitAgentLoopEvent(onEvent, {
    stopReason,
    turns,
    type: "agent_loop_finished"
  })

  return {
    messages: cloneAgentLoopMessages(messages),
    stopReason,
    turns
  }
}

export const runAgentLoop = async ({
  abortSignal,
  activeToolNames,
  afterToolCall,
  beforeToolCall,
  getFollowUpMessages,
  getSteeringMessages,
  maxTurns,
  messages: initialMessages,
  model,
  onEvent,
  prepareNextTurn,
  resources,
  shouldStopAfterTurn,
  thinkingLevel,
  toolRetry,
  tools
}: RunAgentLoopOptions): Promise<RunAgentLoopResult> => {
  let activeLoopToolNames = activeToolNames
  let activeModel = model
  let activeResources = cloneAgentLoopResources(resources)
  let activeThinkingLevel = thinkingLevel
  let activeTools = tools
  let messages = cloneAgentLoopMessages(initialMessages)

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    if (abortSignal?.aborted) {
      return finishAgentLoop({
        messages,
        onEvent,
        stopReason: "aborted",
        turns: turnIndex
      })
    }

    await emitAgentLoopEvent(onEvent, {
      turnIndex,
      type: "agent_turn_started"
    })

    const availableToolNames = getAvailableToolNames({
      activeToolNames: activeLoopToolNames,
      tools: activeTools
    })
    const modelTurn = await activeModel({
      abortSignal,
      availableToolNames,
      messages: cloneAgentLoopMessages(messages),
      resources: cloneAgentLoopResources(activeResources),
      thinkingLevel: activeThinkingLevel,
      turnIndex
    })
    const providedToolResults = cloneAgentLoopValue([
      ...(modelTurn.toolResults ?? [])
    ])
    const toolCalls = cloneAgentLoopToolCalls(modelTurn.toolCalls ?? [])
    for (const toolResult of providedToolResults) {
      if (
        !toolCalls.some(
          (toolCall) => toolCall.toolCallId === toolResult.toolCallId
        )
      ) {
        toolCalls.push({
          input: cloneAgentLoopValue(toolResult.input),
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName
        })
      }
    }
    const assistantMessage: AgentLoopAssistantMessage = {
      content: modelTurn.content,
      role: "assistant",
      toolCalls: cloneAgentLoopToolCalls(toolCalls)
    }

    messages.push(assistantMessage)
    await emitAgentLoopEvent(onEvent, {
      turnIndex,
      type: "assistant_message_appended"
    })

    if (
      modelTurn.stopReason === "aborted" ||
      modelTurn.stopReason === "error"
    ) {
      return finishAgentLoop({
        messages,
        onEvent,
        stopReason: modelTurn.stopReason,
        turns: turnIndex + 1
      })
    }

    if (toolCalls.length === 0 && providedToolResults.length === 0) {
      const followUpMessages = await getAgentLoopUserMessages({
        getMessages: getFollowUpMessages,
        messages,
        turnIndex
      })

      if (followUpMessages.length > 0) {
        await appendAgentLoopUserMessages({
          eventType: "follow_up_message_appended",
          messages,
          onEvent,
          turnIndex,
          userMessages: followUpMessages
        })

        continue
      }

      return finishAgentLoop({
        messages,
        onEvent,
        stopReason: "final",
        turns: turnIndex + 1
      })
    }

    const providedExecutionResults = createProvidedToolExecutionResults({
      toolCalls,
      toolResults: providedToolResults
    })
    const executableToolCallEntries = getExecutableToolCallEntries({
      providedToolResults,
      toolCalls
    })
    const batchToolResults =
      executableToolCallEntries.length === 0
        ? []
        : await executeToolBatch({
            activeToolNames: activeLoopToolNames,
            abortSignal,
            afterToolCall,
            beforeToolCall,
            messages,
            onEvent,
            toolCalls: executableToolCallEntries.map((entry) => entry.toolCall),
            toolRetry,
            tools: activeTools
          })
    const executedToolResults = batchToolResults.map((result, resultIndex) => ({
      ...result,
      sourceIndex:
        executableToolCallEntries[resultIndex]?.sourceIndex ??
        result.sourceIndex
    }))
    const toolResults = [
      ...providedExecutionResults,
      ...executedToolResults
    ].toSorted((first, second) => first.sourceIndex - second.sourceIndex)

    await appendToolResults({
      messages,
      onEvent,
      results: toolResults
    })

    if (abortSignal?.aborted) {
      return finishAgentLoop({
        messages,
        onEvent,
        stopReason: "aborted",
        turns: turnIndex + 1
      })
    }

    if (toolResults.some((result) => result.deferred)) {
      return finishAgentLoop({
        messages,
        onEvent,
        stopReason: "suspended",
        turns: turnIndex + 1
      })
    }

    if (toolResults.every((result) => result.terminate)) {
      return finishAgentLoop({
        messages,
        onEvent,
        stopReason: "terminated",
        turns: turnIndex + 1
      })
    }

    const steeringMessages = await getAgentLoopUserMessages({
      getMessages: getSteeringMessages,
      messages,
      turnIndex
    })

    await appendAgentLoopUserMessages({
      eventType: "steering_message_appended",
      messages,
      onEvent,
      turnIndex,
      userMessages: steeringMessages
    })

    const {
      activeToolNames: nextActiveToolNames,
      messages: nextMessages,
      model: nextModel,
      resources: nextResources,
      thinkingLevel: nextThinkingLevel,
      tools: nextTools
    } = await prepareAgentLoopNextTurn({
      activeToolNames: activeLoopToolNames,
      messages,
      model: activeModel,
      prepareNextTurn,
      resources: activeResources,
      thinkingLevel: activeThinkingLevel,
      tools: activeTools,
      turnIndex
    })
    activeLoopToolNames = nextActiveToolNames
    activeModel = nextModel
    activeResources = nextResources
    activeThinkingLevel = nextThinkingLevel
    activeTools = nextTools
    messages = nextMessages

    const shouldStop = await shouldStopAgentLoopTurn({
      messages,
      shouldStopAfterTurn,
      turnIndex
    })

    if (shouldStop) {
      return finishAgentLoop({
        messages,
        onEvent,
        stopReason: "user_stopped",
        turns: turnIndex + 1
      })
    }
  }

  return finishAgentLoop({
    messages,
    onEvent,
    stopReason: "max_turns",
    turns: maxTurns
  })
}
