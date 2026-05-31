type MaybePromise<TValue> = Promise<TValue> | TValue

export interface AgentStreamOptions {
  headers: Readonly<Record<string, string>>
  metadata: Readonly<Record<string, unknown>>
}

export interface AgentTurnState<TMessage = unknown, TTool = unknown> {
  messages: readonly TMessage[]
  model: string
  resolveProviderCredentials?: () => MaybePromise<unknown>
  streamOptions: Readonly<AgentStreamOptions>
  systemPrompt: string
  thinkingLevel?: string
  tools: Readonly<Record<string, TTool>>
}

export interface AgentTurnStatePromptContext<TMessage, TTool> {
  messages: readonly TMessage[]
  model: string
  streamOptions: Readonly<AgentStreamOptions>
  thinkingLevel?: string
  tools: Readonly<Record<string, TTool>>
}

export type AgentSystemPromptProvider<TMessage, TTool> = (
  context: AgentTurnStatePromptContext<TMessage, TTool>
) => MaybePromise<string>

export interface CreateAgentTurnStateOptions<TMessage, TTool> {
  messages: readonly TMessage[]
  model: string
  resolveProviderCredentials?: () => MaybePromise<unknown>
  streamOptions?: {
    headers?: Readonly<Record<string, string>>
    metadata?: Readonly<Record<string, unknown>>
  }
  systemPrompt: AgentSystemPromptProvider<TMessage, TTool> | string
  thinkingLevel?: string
  tools: Readonly<Record<string, TTool>>
}

const freezeRecord = <TValue>(
  record?: Readonly<Record<string, TValue>>
): Readonly<Record<string, TValue>> => Object.freeze({ ...record })

const deepFreezeSnapshot = <TValue>(
  value: TValue,
  seen = new WeakSet<object>()
): TValue => {
  if (typeof value !== "object" || value === null) {
    return value
  }

  if (seen.has(value)) {
    return value
  }

  seen.add(value)

  for (const key of Reflect.ownKeys(value)) {
    deepFreezeSnapshot((value as Record<PropertyKey, unknown>)[key], seen)
  }

  return Object.freeze(value)
}

const deepFreezeRecordSnapshot = <TValue>(
  record?: Readonly<Record<string, TValue>>
): Readonly<Record<string, TValue>> =>
  deepFreezeSnapshot(structuredClone({ ...record }))

const createMessageSnapshot = <TMessage>(
  messages: readonly TMessage[]
): readonly TMessage[] => deepFreezeSnapshot(structuredClone([...messages]))

const createAgentStreamOptions = (
  streamOptions?: CreateAgentTurnStateOptions<unknown, unknown>["streamOptions"]
): Readonly<AgentStreamOptions> =>
  Object.freeze({
    headers: deepFreezeRecordSnapshot(streamOptions?.headers),
    metadata: deepFreezeRecordSnapshot(streamOptions?.metadata)
  })

const resolveSystemPrompt = <TMessage, TTool>({
  messages,
  model,
  streamOptions,
  systemPrompt,
  thinkingLevel,
  tools
}: {
  messages: readonly TMessage[]
  model: string
  streamOptions: Readonly<AgentStreamOptions>
  systemPrompt: AgentSystemPromptProvider<TMessage, TTool> | string
  thinkingLevel?: string
  tools: Readonly<Record<string, TTool>>
}): MaybePromise<string> => {
  if (typeof systemPrompt === "string") {
    return systemPrompt
  }

  return systemPrompt({
    messages,
    model,
    streamOptions,
    thinkingLevel,
    tools
  })
}

export const createAgentTurnState = async <TMessage, TTool>(
  options: CreateAgentTurnStateOptions<TMessage, TTool>
): Promise<AgentTurnState<TMessage, TTool>> => {
  const messages = createMessageSnapshot(options.messages)
  const streamOptions = createAgentStreamOptions(options.streamOptions)
  const tools = freezeRecord(options.tools)
  const systemPrompt = await resolveSystemPrompt({
    messages,
    model: options.model,
    streamOptions,
    systemPrompt: options.systemPrompt,
    thinkingLevel: options.thinkingLevel,
    tools
  })

  return Object.freeze({
    messages,
    model: options.model,
    resolveProviderCredentials: options.resolveProviderCredentials,
    streamOptions,
    systemPrompt,
    thinkingLevel: options.thinkingLevel,
    tools
  })
}
