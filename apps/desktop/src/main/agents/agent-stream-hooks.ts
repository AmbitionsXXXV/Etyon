import { AgentRuntimeError } from "@/main/agents/agent-errors"

type MaybePromise<TValue> = Promise<TValue> | TValue
type HookList<THook> = THook | readonly THook[]

export type AgentProviderPayload = Record<string, unknown>
export type AgentProviderResponse = Record<string, unknown>

export interface AgentProviderRequestOptions {
  headers: Record<string, string>
  metadata: Record<string, unknown>
}

export interface AgentProviderRequestPatch {
  headers?: Record<string, null | string | undefined>
  metadata?: Record<string, null | unknown | undefined>
}

export interface AgentStreamRequestHookContext {
  payload: AgentProviderPayload
  requestOptions: AgentProviderRequestOptions
}

export interface AgentStreamResponseHookContext {
  response: AgentProviderResponse
}

export type BeforeProviderRequestHook = (
  context: AgentStreamRequestHookContext
) => MaybePromise<AgentProviderRequestPatch | undefined>

export type BeforeProviderPayloadHook = (
  context: AgentStreamRequestHookContext
) => MaybePromise<AgentProviderPayload | undefined>

export type AfterProviderResponseHook = (
  context: AgentStreamResponseHookContext
) => MaybePromise<void>

export interface AgentStreamHooks {
  afterProviderResponse?: HookList<AfterProviderResponseHook>
  beforeProviderPayload?: HookList<BeforeProviderPayloadHook>
  beforeProviderRequest?: HookList<BeforeProviderRequestHook>
}

export interface PrepareAgentStreamRequestOptions {
  hooks?: AgentStreamHooks
  payload: AgentProviderPayload
  requestOptions: AgentProviderRequestOptions
}

export interface PreparedAgentStreamRequest {
  payload: AgentProviderPayload
  requestOptions: AgentProviderRequestOptions
}

export interface ApplyAgentStreamResponseHooksOptions {
  hooks?: AgentStreamHooks
  response: AgentProviderResponse
}

const toHookList = <THook>(hooks?: HookList<THook>): readonly THook[] => {
  if (!hooks) {
    return []
  }

  return Array.isArray(hooks) ? (hooks as readonly THook[]) : [hooks as THook]
}

const wrapHookError = (error: unknown): AgentRuntimeError => {
  if (error instanceof AgentRuntimeError) {
    return error
  }

  return new AgentRuntimeError("hook", "Agent stream hook failed.", {
    cause: error
  })
}

const cloneRequestOptions = (
  requestOptions: AgentProviderRequestOptions
): AgentProviderRequestOptions => ({
  headers: {
    ...requestOptions.headers
  },
  metadata: {
    ...requestOptions.metadata
  }
})

const applyRecordPatch = <TValue>(
  record: Readonly<Record<string, TValue>>,
  patch?: Readonly<Record<string, null | TValue | undefined>>
): Record<string, TValue> => {
  if (!patch) {
    return {
      ...record
    }
  }

  const patchEntries = Object.entries(patch)
  const removedKeys = new Set(
    patchEntries
      .filter(([, value]) => value === null || value === undefined)
      .map(([key]) => key)
  )
  const nextRecord: Record<string, TValue> = {}

  for (const [key, value] of Object.entries(record)) {
    if (!removedKeys.has(key)) {
      nextRecord[key] = value
    }
  }

  for (const [key, value] of patchEntries) {
    if (value === null || value === undefined) {
      continue
    }

    nextRecord[key] = value
  }

  return nextRecord
}

const applyRequestPatch = (
  requestOptions: AgentProviderRequestOptions,
  patch?: AgentProviderRequestPatch
): AgentProviderRequestOptions => ({
  headers: applyRecordPatch(requestOptions.headers, patch?.headers),
  metadata: applyRecordPatch(requestOptions.metadata, patch?.metadata)
})

export const prepareAgentStreamRequest = async ({
  hooks,
  payload,
  requestOptions
}: PrepareAgentStreamRequestOptions): Promise<PreparedAgentStreamRequest> => {
  const nextPayload = {
    ...payload
  }
  let nextRequestOptions = cloneRequestOptions(requestOptions)

  try {
    for (const hook of toHookList(hooks?.beforeProviderRequest)) {
      const patch = await hook({
        payload: nextPayload,
        requestOptions: nextRequestOptions
      })
      nextRequestOptions = applyRequestPatch(
        nextRequestOptions,
        patch ?? undefined
      )
    }

    for (const hook of toHookList(hooks?.beforeProviderPayload)) {
      const patch = await hook({
        payload: nextPayload,
        requestOptions: nextRequestOptions
      })

      if (patch) {
        Object.assign(nextPayload, patch)
      }
    }
  } catch (error) {
    throw wrapHookError(error)
  }

  return {
    payload: nextPayload,
    requestOptions: nextRequestOptions
  }
}

export const applyAgentStreamResponseHooks = async ({
  hooks,
  response
}: ApplyAgentStreamResponseHooksOptions): Promise<void> => {
  try {
    for (const hook of toHookList(hooks?.afterProviderResponse)) {
      await hook({
        response
      })
    }
  } catch (error) {
    throw wrapHookError(error)
  }
}
