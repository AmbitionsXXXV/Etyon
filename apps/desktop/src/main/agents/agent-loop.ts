export type AgentLoopStopReason =
  | "aborted"
  | "error"
  | "final"
  | "max_turns"
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
}

export type AgentLoopModel = (
  context: AgentLoopModelContext
) => Promise<AgentLoopModelTurn> | AgentLoopModelTurn

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
}

export interface AgentLoopExecutedToolResult {
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

export type AgentLoopEventType =
  | "agent_loop_finished"
  | "agent_turn_started"
  | "assistant_message_appended"
  | "follow_up_message_appended"
  | "steering_message_appended"
  | "tool_execution_finished"
  | "tool_execution_started"
  | "tool_result_appended"

export interface AgentLoopEvent {
  isError?: boolean
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
  await onEvent?.(event)
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
  toolCall
})

const createActiveToolNameSet = (
  activeToolNames: readonly string[] | undefined
): ReadonlySet<string> | undefined =>
  activeToolNames ? new Set(activeToolNames) : undefined

const cloneAgentLoopResources = (
  resources: AgentLoopResources | undefined
): AgentLoopResources | undefined => (resources ? { ...resources } : undefined)

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
      input: toolCall.input,
      sourceIndex,
      tool,
      toolCall
    }
  }

  try {
    const hookResult = await beforeToolCall(toolCall, {
      messages,
      toolCall
    })

    if (hookResult.block) {
      return buildErrorResult({
        message: hookResult.reason ?? "Tool call was blocked.",
        sourceIndex,
        toolCall
      })
    }

    return {
      input: hookResult.input ?? toolCall.input,
      sourceIndex,
      tool,
      toolCall
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
    const hookResult = await afterToolCall(result, {
      messages,
      result
    })

    return {
      ...result,
      isError: hookResult.isError ?? result.isError,
      output: hookResult.output ?? result.output,
      terminate: hookResult.terminate ?? result.terminate
    }
  } catch (error) {
    return {
      ...result,
      isError: true,
      output: {
        error: getErrorMessage(error)
      },
      terminate: false
    }
  }
}

const executePreparedToolCall = async ({
  abortSignal,
  afterToolCall,
  messages,
  onEvent,
  prepared
}: {
  abortSignal: AbortSignal | undefined
  afterToolCall: RunAgentLoopOptions["afterToolCall"]
  messages: readonly AgentLoopMessage[]
  onEvent: RunAgentLoopOptions["onEvent"]
  prepared: PreparedToolCall
}): Promise<AgentLoopExecutedToolResult> => {
  const { input, sourceIndex, tool, toolCall } = prepared

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
    sourceIndex,
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    type: "tool_execution_started"
  })

  let result: AgentLoopExecutedToolResult

  try {
    const outputOrPromise = tool.execute(input, {
      abortSignal,
      messages,
      toolCall: {
        ...toolCall,
        input
      }
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
      toolCall: {
        ...toolCall,
        input
      }
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

  const finalizedResult = await finalizeToolResult({
    afterToolCall,
    messages,
    result
  })

  await emitAgentLoopEvent(onEvent, {
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

const executeToolBatch = async ({
  activeToolNames,
  abortSignal,
  afterToolCall,
  beforeToolCall,
  messages,
  onEvent,
  toolCalls,
  tools
}: {
  activeToolNames: readonly string[] | undefined
  abortSignal: AbortSignal | undefined
  afterToolCall: RunAgentLoopOptions["afterToolCall"]
  beforeToolCall: RunAgentLoopOptions["beforeToolCall"]
  messages: readonly AgentLoopMessage[]
  onEvent: RunAgentLoopOptions["onEvent"]
  toolCalls: readonly AgentLoopToolCall[]
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
      prepared
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
    const toolMessage: AgentLoopToolMessage = {
      isError: result.isError,
      output: result.output,
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
    messages.push(message)
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
}): Promise<readonly AgentLoopUserMessage[]> =>
  (await getMessages?.({
    messages,
    turnIndex
  })) ?? []

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
    messages,
    model,
    resources: cloneAgentLoopResources(resources),
    thinkingLevel,
    tools,
    turnIndex
  })

  return {
    activeToolNames: preparedNextTurn?.activeToolNames ?? activeToolNames,
    messages: preparedNextTurn?.messages
      ? [...preparedNextTurn.messages]
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
    messages,
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
    messages,
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
  tools
}: RunAgentLoopOptions): Promise<RunAgentLoopResult> => {
  let activeLoopToolNames = activeToolNames
  let activeModel = model
  let activeResources = cloneAgentLoopResources(resources)
  let activeThinkingLevel = thinkingLevel
  let activeTools = tools
  let messages = [...initialMessages]

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
      messages: [...messages],
      resources: cloneAgentLoopResources(activeResources),
      thinkingLevel: activeThinkingLevel,
      turnIndex
    })
    const toolCalls = [...(modelTurn.toolCalls ?? [])]
    const assistantMessage: AgentLoopAssistantMessage = {
      content: modelTurn.content,
      role: "assistant",
      toolCalls
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

    if (toolCalls.length === 0) {
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

    const toolResults = await executeToolBatch({
      activeToolNames: activeLoopToolNames,
      abortSignal,
      afterToolCall,
      beforeToolCall,
      messages,
      onEvent,
      toolCalls,
      tools: activeTools
    })

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
