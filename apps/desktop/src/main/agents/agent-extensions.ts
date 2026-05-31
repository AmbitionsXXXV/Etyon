import { pathToFileURL } from "node:url"

import type { AgentSettings, MemorySettings } from "@etyon/rpc"
import type { ModelMessage } from "ai"
import type * as z from "zod"

import type {
  AgentLoopAfterToolCallContext,
  AgentLoopAfterToolCallResult,
  AgentLoopBeforeToolCallContext,
  AgentLoopBeforeToolCallResult,
  AgentLoopExecutedToolResult,
  AgentLoopToolCall
} from "@/main/agents/agent-loop"
import { mergeAgentStreamHooks } from "@/main/agents/agent-stream-hooks"
import type { AgentStreamHooks } from "@/main/agents/agent-stream-hooks"
import type { AgentWorkspace } from "@/main/agents/agent-workspace"
import type {
  AgentToolCapability,
  AgentToolOwner,
  AgentToolRiskLevel
} from "@/main/agents/tool-manifest"
import { AGENT_TOOL_NAMES } from "@/main/agents/types"
import type { AppDatabase } from "@/main/db"

type AgentExternalToolOwner = Exclude<AgentToolOwner, "builtin">

export interface AgentExtensionToolExecutionContext {
  abortSignal?: AbortSignal
  chatSessionId?: string
  db?: AppDatabase
  memorySettings?: MemorySettings
  messages: ModelMessage[]
  projectPath: string
  settings: AgentSettings
  toolCallId: string
  workspace: AgentWorkspace
}

export interface AgentExtensionToolDefinition<TInput = unknown> {
  capabilities?: readonly AgentToolCapability[]
  description: string
  execute: (
    input: TInput,
    context: AgentExtensionToolExecutionContext
  ) => Promise<unknown> | unknown
  inputSchema: z.ZodType<TInput>
  name: string
  owner?: AgentExternalToolOwner
  profiles?: readonly string[]
  requiredSkillCapabilities?: readonly string[]
  requiresApproval?:
    | boolean
    | ((
        input: TInput,
        context: AgentExtensionToolExecutionContext
      ) => boolean | Promise<boolean>)
  riskLevel?: AgentToolRiskLevel
}

export interface AgentExtensionStreamHooksDefinition extends AgentStreamHooks {
  profiles?: readonly string[]
  requiredSkillCapabilities?: readonly string[]
}

export interface AgentExtensionToolHooks {
  afterToolCall?: (
    result: AgentLoopExecutedToolResult,
    context: AgentLoopAfterToolCallContext
  ) => AgentLoopAfterToolCallResult | Promise<AgentLoopAfterToolCallResult>
  beforeToolCall?: (
    toolCall: AgentLoopToolCall,
    context: AgentLoopBeforeToolCallContext
  ) => AgentLoopBeforeToolCallResult | Promise<AgentLoopBeforeToolCallResult>
}

export interface AgentExtensionToolHooksDefinition extends AgentExtensionToolHooks {
  profiles?: readonly string[]
  requiredSkillCapabilities?: readonly string[]
}

export type AgentExtensionLifecycleEvent =
  | {
      childRunId: string
      extensionId: string
      includeApprovalTools: boolean
      parentRunId: string
      parentToolCallId: string
      profileId: string
      task: string
      type: "delegation_started"
    }
  | {
      childRunId: string
      error?: string
      extensionId: string
      parentRunId: string
      parentToolCallId: string
      profileId: string
      status: "failed" | "succeeded"
      summary?: string
      truncated?: boolean
      type: "delegation_finished"
    }
  | {
      extensionId: string
      parentRunId: string
      parentToolCallId: string
      profileId: string
      reason: string
      task: string
      type: "delegation_rejected"
    }
  | {
      extensionId: string
      toolName: string
      type: "tool_registered"
    }
  | {
      extensionId: string
      input: unknown
      toolCallId: string
      toolName: string
      type: "tool_call_started"
    }
  | {
      extensionId: string
      output: unknown
      toolCallId: string
      toolName: string
      type: "tool_call_finished"
    }
  | {
      error: string
      extensionId: string
      toolCallId: string
      toolName: string
      type: "tool_call_failed"
    }

export type AgentExtensionLifecycleEventType =
  | "*"
  | AgentExtensionLifecycleEvent["type"]

export type AgentExtensionLifecycleHandler = (
  event: AgentExtensionLifecycleEvent
) => Promise<void> | void

export interface AgentExtensionRegistrationContext {
  on: (
    type: AgentExtensionLifecycleEventType,
    handler: AgentExtensionLifecycleHandler
  ) => void
  registerStreamHooks: (definition: AgentExtensionStreamHooksDefinition) => void
  registerToolHooks: (definition: AgentExtensionToolHooksDefinition) => void
  registerTool: <TInput>(
    definition: AgentExtensionToolDefinition<TInput>
  ) => void
}

export interface AgentExtension {
  id: string
  register: (context: AgentExtensionRegistrationContext) => Promise<void> | void
}

export type AgentExtensionFactory = () =>
  | AgentExtension
  | Promise<AgentExtension>

export interface AgentToolPackage {
  id: string
  owner: AgentExternalToolOwner
  streamHooks?: readonly AgentExtensionStreamHooksDefinition[]
  toolHooks?: readonly AgentExtensionToolHooksDefinition[]
  tools?: readonly AgentExtensionToolDefinition<unknown>[]
}

export interface AgentExtensionRegisteredTool<
  TInput = unknown
> extends AgentExtensionToolDefinition<TInput> {
  capabilities: readonly AgentToolCapability[]
  extensionId: string
  owner: AgentExternalToolOwner
  riskLevel: AgentToolRiskLevel
}

export interface AgentExtensionRegisteredStreamHooks extends AgentExtensionStreamHooksDefinition {
  extensionId: string
}

export interface AgentExtensionRegisteredToolHooks extends AgentExtensionToolHooksDefinition {
  extensionId: string
}

export interface AgentExtensionRunner {
  emit: (event: AgentExtensionLifecycleEvent) => Promise<void>
  getStreamHooks: (
    options: ListAgentExtensionToolsOptions
  ) => AgentStreamHooks | undefined
  getToolHooks: (
    options: ListAgentExtensionToolsOptions
  ) => AgentExtensionToolHooks | undefined
  listTools: (
    options: ListAgentExtensionToolsOptions
  ) => AgentExtensionRegisteredTool[]
}

export interface CreateAgentExtensionRunnerOptions {
  extensions?: readonly (AgentExtension | AgentExtensionFactory)[]
  toolPackages?: readonly AgentToolPackage[]
}

export interface ListAgentExtensionToolsOptions {
  includeApprovalTools?: boolean
  profileId: string
  skillCapabilities?: readonly string[]
}

export interface LoadAgentExtensionsOptions {
  importer?: (path: string) => Promise<unknown>
  paths: readonly string[]
}

interface RegisteredLifecycleHandler {
  handler: AgentExtensionLifecycleHandler
  type: AgentExtensionLifecycleEventType
}

interface ExtensionVisibilityFilter {
  profiles?: readonly string[]
  requiredSkillCapabilities?: readonly string[]
}

interface RegisterAgentToolDefinitionOptions {
  definition: AgentExtensionToolDefinition<unknown>
  extensionId: string
  owner: AgentExternalToolOwner
  registeredToolNames: Set<string>
  toolDefinitions: AgentExtensionRegisteredTool[]
}

const EXTENSION_TOOL_NAME_PATTERN = /^[A-Za-z_][\w-]{0,63}$/u
const BUILTIN_TOOL_NAMES = new Set<string>(AGENT_TOOL_NAMES)
const DEFAULT_EXTENSION_TOOL_OWNER = "skill" as const
const DEFAULT_EXTENSION_TOOL_RISK_LEVEL = "medium" as const

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const assertExtensionToolName = (name: string): void => {
  if (!EXTENSION_TOOL_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid agent extension tool name: ${name}`)
  }

  if (BUILTIN_TOOL_NAMES.has(name)) {
    throw new Error(`Agent extension tool shadows built-in tool: ${name}`)
  }
}

const registerAgentToolDefinition = ({
  definition,
  extensionId,
  owner,
  registeredToolNames,
  toolDefinitions
}: RegisterAgentToolDefinitionOptions): void => {
  assertExtensionToolName(definition.name)

  if (registeredToolNames.has(definition.name)) {
    throw new Error(
      `Duplicate agent extension tool registered: ${definition.name}`
    )
  }

  registeredToolNames.add(definition.name)
  toolDefinitions.push({
    ...definition,
    capabilities: [...(definition.capabilities ?? [])],
    extensionId,
    owner: definition.owner ?? owner,
    riskLevel: definition.riskLevel ?? DEFAULT_EXTENSION_TOOL_RISK_LEVEL
  })
}

const resolveExtension = async (
  extension: AgentExtension | AgentExtensionFactory
): Promise<AgentExtension> =>
  typeof extension === "function" ? await extension() : extension

const getExtensionFromModule = (
  module: unknown
): AgentExtension | AgentExtensionFactory => {
  if (typeof module === "function") {
    return module as AgentExtensionFactory
  }

  if (typeof module !== "object" || module === null) {
    throw new Error("Agent extension module must export an extension.")
  }

  const exports = module as {
    default?: unknown
    extension?: unknown
  }
  const candidate = exports.default ?? exports.extension

  if (typeof candidate === "function") {
    return candidate as AgentExtensionFactory
  }

  if (typeof candidate === "object" && candidate !== null) {
    return candidate as AgentExtension
  }

  throw new Error("Agent extension module must export default or extension.")
}

const importExtensionModule = (extensionPath: string): Promise<unknown> =>
  import(pathToFileURL(extensionPath).href)

const matchesProfile = (
  definition: ExtensionVisibilityFilter,
  profileId: string
): boolean => !definition.profiles || definition.profiles.includes(profileId)

const matchesSkillCapabilities = (
  definition: ExtensionVisibilityFilter,
  skillCapabilities: readonly string[] | undefined
): boolean => {
  if (!definition.requiredSkillCapabilities?.length) {
    return true
  }

  const capabilitySet = new Set(skillCapabilities)

  return definition.requiredSkillCapabilities.every((capability) =>
    capabilitySet.has(capability)
  )
}

const hasApprovalBoundary = (
  definition: Pick<
    AgentExtensionRegisteredTool,
    "requiresApproval" | "riskLevel"
  >
): boolean =>
  Boolean(definition.requiresApproval) || definition.riskLevel !== "safe"

const matchesApprovalScope = (
  definition: Pick<
    AgentExtensionRegisteredTool,
    "requiresApproval" | "riskLevel"
  >,
  includeApprovalTools = true
): boolean => includeApprovalTools || !hasApprovalBoundary(definition)

export const mergeAgentExtensionToolHooks = (
  definitions: readonly AgentExtensionToolHooks[]
): AgentExtensionToolHooks | undefined => {
  const beforeToolCallDefinitions = definitions.filter(
    (definition) => definition.beforeToolCall
  )
  const afterToolCallDefinitions = definitions.filter(
    (definition) => definition.afterToolCall
  )

  if (
    beforeToolCallDefinitions.length === 0 &&
    afterToolCallDefinitions.length === 0
  ) {
    return undefined
  }

  return {
    ...(beforeToolCallDefinitions.length > 0
      ? {
          beforeToolCall: async (toolCall, context) => {
            let effectiveInput = toolCall.input
            let hasInputPatch = false

            for (const definition of beforeToolCallDefinitions) {
              const effectiveToolCall: AgentLoopToolCall = {
                input: effectiveInput,
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName
              }
              const result = await definition.beforeToolCall?.(
                effectiveToolCall,
                {
                  ...context,
                  toolCall: effectiveToolCall
                }
              )

              if (!result) {
                continue
              }

              if (result.block || result.suspend) {
                return result
              }

              if ("input" in result) {
                hasInputPatch = true
                effectiveInput = result.input
              }
            }

            return hasInputPatch ? { input: effectiveInput } : {}
          }
        }
      : {}),
    ...(afterToolCallDefinitions.length > 0
      ? {
          afterToolCall: async (result, context) => {
            let effectiveIsError = result.isError
            let effectiveOutput = result.output
            let effectiveTerminate = result.terminate
            let hasPatch = false

            for (const definition of afterToolCallDefinitions) {
              const effectiveResult: AgentLoopExecutedToolResult = {
                isError: effectiveIsError,
                output: effectiveOutput,
                sourceIndex: result.sourceIndex,
                terminate: effectiveTerminate,
                toolCall: result.toolCall
              }

              if (result.deferred !== undefined) {
                effectiveResult.deferred = result.deferred
              }

              const hookResult = await definition.afterToolCall?.(
                effectiveResult,
                {
                  ...context,
                  result: effectiveResult
                }
              )

              if (!hookResult) {
                continue
              }

              hasPatch = true
              effectiveIsError = hookResult.isError ?? effectiveIsError
              effectiveOutput = hookResult.output ?? effectiveOutput
              effectiveTerminate = hookResult.terminate ?? effectiveTerminate
            }

            if (!hasPatch) {
              return {}
            }

            return {
              isError: effectiveIsError,
              output: effectiveOutput,
              terminate: effectiveTerminate
            }
          }
        }
      : {})
  }
}

export const createAgentExtensionRunner = async ({
  extensions = [],
  toolPackages = []
}: CreateAgentExtensionRunnerOptions = {}): Promise<AgentExtensionRunner> => {
  const handlers: RegisteredLifecycleHandler[] = []
  const streamHookDefinitions: AgentExtensionRegisteredStreamHooks[] = []
  const toolHookDefinitions: AgentExtensionRegisteredToolHooks[] = []
  const toolDefinitions: AgentExtensionRegisteredTool[] = []
  const registeredToolNames = new Set<string>()

  for (const toolPackage of toolPackages) {
    for (const streamHookDefinition of toolPackage.streamHooks ?? []) {
      streamHookDefinitions.push({
        ...streamHookDefinition,
        extensionId: toolPackage.id
      })
    }

    for (const toolHookDefinition of toolPackage.toolHooks ?? []) {
      toolHookDefinitions.push({
        ...toolHookDefinition,
        extensionId: toolPackage.id
      })
    }

    for (const toolDefinition of toolPackage.tools ?? []) {
      registerAgentToolDefinition({
        definition: toolDefinition,
        extensionId: toolPackage.id,
        owner: toolPackage.owner,
        registeredToolNames,
        toolDefinitions
      })
    }
  }

  for (const extensionInput of extensions) {
    const extension = await resolveExtension(extensionInput)

    await extension.register({
      on: (type, handler) => {
        handlers.push({
          handler,
          type
        })
      },
      registerStreamHooks: (definition) => {
        streamHookDefinitions.push({
          ...definition,
          extensionId: extension.id
        })
      },
      registerToolHooks: (definition) => {
        toolHookDefinitions.push({
          ...definition,
          extensionId: extension.id
        })
      },
      registerTool: (definition) => {
        registerAgentToolDefinition({
          definition: definition as AgentExtensionToolDefinition<unknown>,
          extensionId: extension.id,
          owner: DEFAULT_EXTENSION_TOOL_OWNER,
          registeredToolNames,
          toolDefinitions
        })
      }
    })
  }

  const runner: AgentExtensionRunner = {
    emit: async (event) => {
      for (const { handler, type } of handlers) {
        if (type === "*" || type === event.type) {
          await handler(event)
        }
      }
    },
    getStreamHooks: ({ profileId, skillCapabilities }) =>
      mergeAgentStreamHooks(
        ...streamHookDefinitions.filter(
          (definition) =>
            matchesProfile(definition, profileId) &&
            matchesSkillCapabilities(definition, skillCapabilities)
        )
      ),
    getToolHooks: ({ profileId, skillCapabilities }) =>
      mergeAgentExtensionToolHooks(
        toolHookDefinitions.filter(
          (definition) =>
            matchesProfile(definition, profileId) &&
            matchesSkillCapabilities(definition, skillCapabilities)
        )
      ),
    listTools: ({
      includeApprovalTools = true,
      profileId,
      skillCapabilities
    }) =>
      toolDefinitions.filter(
        (toolDefinition) =>
          matchesProfile(toolDefinition, profileId) &&
          matchesSkillCapabilities(toolDefinition, skillCapabilities) &&
          matchesApprovalScope(toolDefinition, includeApprovalTools)
      )
  }

  for (const toolDefinition of toolDefinitions) {
    await runner.emit({
      extensionId: toolDefinition.extensionId,
      toolName: toolDefinition.name,
      type: "tool_registered"
    })
  }

  return runner
}

export const mergeAgentExtensionRunners = (
  ...runners: readonly (AgentExtensionRunner | undefined)[]
): AgentExtensionRunner | undefined => {
  const activeRunners = runners.filter(
    (runner): runner is AgentExtensionRunner => runner !== undefined
  )

  if (activeRunners.length === 0) {
    return undefined
  }

  if (activeRunners.length === 1) {
    return activeRunners[0]
  }

  return {
    emit: async (event) => {
      for (const runner of activeRunners) {
        await runner.emit(event)
      }
    },
    getStreamHooks: (options) =>
      mergeAgentStreamHooks(
        ...activeRunners.map((runner) => runner.getStreamHooks(options))
      ),
    getToolHooks: (options) =>
      mergeAgentExtensionToolHooks(
        activeRunners.flatMap((runner) => {
          const hooks = runner.getToolHooks(options)

          return hooks ? [hooks] : []
        })
      ),
    listTools: (options) => {
      const tools = activeRunners.flatMap((runner) => runner.listTools(options))
      const toolNames = new Set<string>()

      for (const toolDefinition of tools) {
        if (toolNames.has(toolDefinition.name)) {
          throw new Error(
            `Duplicate agent extension tool registered: ${toolDefinition.name}`
          )
        }

        toolNames.add(toolDefinition.name)
      }

      return tools
    }
  }
}

export const loadAgentExtensions = async ({
  importer = importExtensionModule,
  paths
}: LoadAgentExtensionsOptions): Promise<AgentExtensionRunner> => {
  const modules = await Promise.all(paths.map((path) => importer(path)))

  return await createAgentExtensionRunner({
    extensions: modules.map(getExtensionFromModule)
  })
}

export const toAgentExtensionErrorMessage = getErrorMessage
