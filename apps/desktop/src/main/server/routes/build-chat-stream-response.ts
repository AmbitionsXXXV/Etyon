import type { AppSettings, ParsedSkill } from "@etyon/rpc"
import type {
  LanguageModel,
  ModelMessage,
  UIMessage,
  UIMessageStreamWriter
} from "ai"
import {
  APICallError,
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream
} from "ai"

import {
  AGENT_LOOP_STEP_FUSE,
  runAgentLoop
} from "@/main/agents/minimal/agent-loop"
import type {
  AgentLoopOutcome,
  AgentLoopStep
} from "@/main/agents/minimal/agent-loop"
import {
  buildAgentSystemPrompt,
  buildAgentToolApproval,
  buildAgentToolset
} from "@/main/agents/minimal/agent-toolset"
import { createChatSmoothingTransform } from "@/main/agents/minimal/chat-stream-smoothing"
import { createReasoningTimingTap } from "@/main/agents/minimal/reasoning-timing-tap"
import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import {
  formatPromptTemplateInvocation,
  parseCommandArgs
} from "@/main/agents/prompt-templates"
import type { PromptTemplate } from "@/main/agents/prompt-templates"
import { releaseRun } from "@/main/agents/write-claims"
import { logger } from "@/main/logger"
import {
  resolveEffortProviderOptionsForSelection,
  resolveModel
} from "@/main/server/lib/providers"
import { formatSkillCommandInvocation, listSkills } from "@/main/skills"
import type { AgentPermissionMode } from "@/shared/agents/permission-mode"
import { resolveActiveProfile } from "@/shared/agents/profiles"
import {
  isChatPlanCommandText,
  stripChatPlanCommand
} from "@/shared/chat/agent-mode"
import type { ChatAgentMode } from "@/shared/chat/agent-mode"
import { attachRunOutcomeToLatestAssistantMessage } from "@/shared/chat/message-metadata"
import { CHAT_REQUEST_PHASE_DATA_TYPE } from "@/shared/chat/stream-data"
import type { ChatRequestPhaseData } from "@/shared/chat/stream-data"

const PROMPT_TEMPLATE_COMMAND_PATTERN = /^\/prompt(?:\s+|$)/iu
const PROMPT_TEMPLATE_FALLBACK_PROMPT =
  "Prompt template command was incomplete. Ask the user which template to use."
const SKILL_COMMAND_PATTERN = /^\/skill(?:\s+|$)/iu
const SKILL_COMMAND_FALLBACK_PROMPT =
  "Skill command was incomplete. Ask the user which skill and command to run."
const RESPONSES_ITEM_NOT_FOUND_PATTERN = /item with id .* not found/iu
const OFFICIAL_OPENAI_HOST_PATTERN = /^https:\/\/api\.openai\.com\//u

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/**
 * Matches the AI SDK's default `onError` (`getErrorMessage`, from the
 * ai-sdk provider utils package): stringify by type, no special-casing.
 * Kept in sync so unrecognized errors still read exactly as they did before.
 */
const describeGenericError = (error: unknown): string => {
  if (error === null || error === undefined) {
    return "unknown error"
  }

  if (typeof error === "string") {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  return JSON.stringify(error)
}

/**
 * The OpenAI Responses API lets a message reference a prior response item by
 * id instead of resending its content — a token-saving optimization that
 * assumes the provider still has that item stored server-side. Third-party
 * endpoints proxying the Responses API often don't persist items the way
 * OpenAI's own servers do, so a later turn's reference 404s even though
 * nothing the user did was wrong. Detected narrowly (custom host + this
 * exact upstream message) so unrelated API errors are never relabeled.
 */
export const describeChatStreamError = (error: unknown): string => {
  if (
    APICallError.isInstance(error) &&
    error.url.includes("/responses") &&
    !OFFICIAL_OPENAI_HOST_PATTERN.test(error.url) &&
    RESPONSES_ITEM_NOT_FOUND_PATTERN.test(error.message)
  ) {
    return `${error.message}\n\nThis endpoint (${error.url}) doesn't appear to persist OpenAI Responses API conversation state the way api.openai.com does, so referencing an earlier reply by id fails. Try switching this provider to "Chat Completions" API mode in Settings → Providers, which resends full message history instead of relying on stored items.`
  }

  return describeGenericError(error)
}

const stripPromptTemplateCommand = (text: string): string =>
  text.replace(PROMPT_TEMPLATE_COMMAND_PATTERN, "").trim()

const stripSkillCommand = (text: string): string =>
  text.replace(SKILL_COMMAND_PATTERN, "").trim()

const findPromptTemplate = ({
  name,
  promptTemplates
}: {
  name: string
  promptTemplates: readonly PromptTemplate[]
}): PromptTemplate | undefined =>
  promptTemplates.find((template) => template.name === name)

const resolvePromptTemplateCommandText = ({
  promptTemplates,
  text
}: {
  promptTemplates: readonly PromptTemplate[]
  text: string
}): null | string => {
  if (!PROMPT_TEMPLATE_COMMAND_PATTERN.test(text)) {
    return null
  }

  const commandBody = stripPromptTemplateCommand(text)

  if (commandBody.length === 0) {
    return PROMPT_TEMPLATE_FALLBACK_PROMPT
  }

  const [templateName = "", ...templateArgs] = parseCommandArgs(commandBody)
  const template = findPromptTemplate({
    name: templateName,
    promptTemplates
  })

  if (!template) {
    return PROMPT_TEMPLATE_FALLBACK_PROMPT
  }

  return formatPromptTemplateInvocation(template, templateArgs)
}

const findSkillByName = ({
  name,
  skills
}: {
  name: string
  skills: readonly ParsedSkill[]
}): ParsedSkill | undefined => skills.find((skill) => skill.name === name)

const splitSkillCommandArgs = (
  args: readonly string[]
): { args: string[]; selectedFlags: string[] } => {
  const selectedFlags: string[] = []
  const commandArgs: string[] = []
  let readingArgs = false

  for (const arg of args) {
    if (!readingArgs && arg === "--") {
      readingArgs = true
      continue
    }

    if (!readingArgs && arg.startsWith("-")) {
      selectedFlags.push(arg)
      continue
    }

    commandArgs.push(arg)
  }

  return {
    args: commandArgs,
    selectedFlags
  }
}

const validateSkillCommandFlags = ({
  command,
  selectedFlags
}: {
  command: ParsedSkill["commands"][number]
  selectedFlags: readonly string[]
}): null | string => {
  for (const selectedFlag of selectedFlags) {
    if (command.flags.includes(selectedFlag)) {
      continue
    }

    const availableFlags =
      command.flags.length > 0 ? command.flags.join(", ") : "none"

    return `Skill command flag not declared: ${selectedFlag}. Available flags: ${availableFlags}.`
  }

  return null
}

const resolveSkillCommandText = ({
  projectPath,
  skillCommandSkills,
  text
}: {
  projectPath: string
  skillCommandSkills: readonly ParsedSkill[] | undefined
  text: string
}): null | string => {
  if (!SKILL_COMMAND_PATTERN.test(text)) {
    return null
  }

  const commandBody = stripSkillCommand(text)

  if (commandBody.length === 0) {
    return SKILL_COMMAND_FALLBACK_PROMPT
  }

  const [skillName = "", commandName = "", ...rawArgs] =
    parseCommandArgs(commandBody)
  const skills =
    skillCommandSkills ?? listSkills({ projectPaths: [projectPath] })
  const skill = findSkillByName({
    name: skillName,
    skills
  })
  const command = skill?.commands.find((entry) => entry.name === commandName)

  if (!(skill && command)) {
    return SKILL_COMMAND_FALLBACK_PROMPT
  }

  const { args, selectedFlags } = splitSkillCommandArgs(rawArgs)
  const flagError = validateSkillCommandFlags({
    command,
    selectedFlags
  })

  if (flagError) {
    return flagError
  }

  return formatSkillCommandInvocation({
    args,
    command,
    selectedFlags,
    skill
  })
}

const resolvePlanCommandText = (text: string): null | string => {
  if (!isChatPlanCommandText(text)) {
    return null
  }

  const planBody = stripChatPlanCommand(text)

  // Strip the `/plan ` prefix so the model receives only the user's request;
  // plan-mode behavior is applied via the system prompt in the chat route.
  return planBody.length > 0 ? planBody : null
}

const applyCommandTextToModelMessage = (
  message: ModelMessage,
  commandText: string
): ModelMessage => {
  if (message.role !== "user") {
    return message
  }

  if (typeof message.content === "string") {
    return {
      ...message,
      content: commandText
    }
  }

  if (!Array.isArray(message.content)) {
    return message
  }

  let replacedFirstText = false
  const content = message.content.map((part) => {
    if (isRecord(part) && part.type === "text" && !replacedFirstText) {
      replacedFirstText = true

      return {
        ...part,
        text: commandText
      }
    }

    return part
  })

  return {
    ...message,
    content
  } as ModelMessage
}

const getModelMessageText = (message: ModelMessage): string => {
  if (message.role !== "user") {
    return ""
  }

  if (typeof message.content === "string") {
    return message.content
  }

  if (!Array.isArray(message.content)) {
    return ""
  }

  return message.content
    .map((part) =>
      isRecord(part) && part.type === "text" && typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("\n")
}

const applyComposerCommandsToLatestModelMessage = ({
  modelMessages,
  projectPath,
  promptTemplates,
  skillCommandSkills
}: {
  modelMessages: ModelMessage[]
  projectPath: string
  promptTemplates: readonly PromptTemplate[]
  skillCommandSkills: readonly ParsedSkill[] | undefined
}): ModelMessage[] => {
  const latestIndex = modelMessages.findLastIndex(
    (message) => message.role === "user"
  )

  if (latestIndex === -1) {
    return modelMessages
  }

  const latestMessage = modelMessages[latestIndex] as ModelMessage
  const text = getModelMessageText(latestMessage).trim()
  const commandText =
    resolvePromptTemplateCommandText({
      promptTemplates,
      text
    }) ??
    resolveSkillCommandText({
      projectPath,
      skillCommandSkills,
      text
    }) ??
    resolvePlanCommandText(text)

  if (commandText === null) {
    return modelMessages
  }

  return modelMessages.map((message, index) =>
    index === latestIndex
      ? applyCommandTextToModelMessage(message, commandText)
      : message
  )
}

export const writeRequestPhase = (
  writer: {
    write: (part: {
      data: ChatRequestPhaseData
      transient?: boolean
      type: typeof CHAT_REQUEST_PHASE_DATA_TYPE
    }) => void
  },
  phase: ChatRequestPhaseData["phase"]
): void => {
  writer.write({
    data: {
      phase
    },
    transient: true,
    type: CHAT_REQUEST_PHASE_DATA_TYPE
  })
}

// Temporary latency diagnostics: logs how long each stream takes to produce
// its first chunk, without altering the chunks themselves. Falls back to the
// untouched stream if the value isn't a real ReadableStream at runtime.
const tapFirstChunkLatency = <TChunk>(
  stream: ReadableStream<TChunk>,
  eventName: string,
  fields: Record<string, unknown>
): ReadableStream<TChunk> => {
  if (typeof stream.pipeThrough !== "function") {
    return stream
  }

  const chunkLog = logger.startEvent(eventName, fields)
  let loggedFirstChunk = false

  return stream.pipeThrough(
    new TransformStream<TChunk, TChunk>({
      transform(chunk, controller) {
        if (!loggedFirstChunk) {
          loggedFirstChunk = true
          chunkLog.end()
        }

        controller.enqueue(chunk)
      }
    })
  )
}

// The agent loop merges one stream per model round-trip; tapping only the
// first merged stream mirrors what tapFirstChunkLatency does for the plain
// path.
const withFirstChunkLatency = (
  writer: UIMessageStreamWriter<UIMessage>,
  fields: Record<string, unknown>
): UIMessageStreamWriter<UIMessage> => {
  let tapped = false

  return {
    merge: (stream) => {
      if (tapped) {
        writer.merge(stream)

        return
      }

      tapped = true
      writer.merge(tapFirstChunkLatency(stream, "chat_first_chunk", fields))
    },
    onError: writer.onError,
    write: (chunk) => {
      writer.write(chunk)
    }
  }
}

export interface BuildChatStreamResponseOptions {
  abortSignal: AbortSignal
  /** Effective chat agent mode for the turn; undefined behaves as "agent". */
  agentMode?: ChatAgentMode
  agentRunId?: string | null
  messages: UIMessage[]
  model: LanguageModel
  modelId: string | null
  modelMessages: ModelMessage[]
  moonshotReasoningForAssistantToolCalls: readonly string[]
  /** Best-effort per-step observer for the agent loop (event store). */
  onAgentStep?: (step: AgentLoopStep) => Promise<void> | void
  onFinishPersist: (
    messages: UIMessage[],
    agentOutcome: AgentLoopOutcome | null
  ) => Promise<void>
  permissionMode: AgentPermissionMode
  profileId?: string | null
  projectPath: string
  promptTemplates?: readonly PromptTemplate[]
  requestStartedAt: number
  sessionId: string
  settings: AppSettings
  skillCommandSkills?: readonly ParsedSkill[]
  systemPrompts: string[]
}

export const buildChatStreamResponse = ({
  abortSignal,
  agentMode,
  agentRunId,
  messages,
  model,
  modelId,
  modelMessages,
  moonshotReasoningForAssistantToolCalls,
  onAgentStep,
  onFinishPersist,
  permissionMode,
  profileId,
  projectPath,
  promptTemplates = [],
  requestStartedAt,
  sessionId,
  settings,
  skillCommandSkills,
  systemPrompts
}: BuildChatStreamResponseOptions): Response => {
  const preparedModelMessages = applyComposerCommandsToLatestModelMessage({
    modelMessages,
    projectPath,
    promptTemplates,
    skillCommandSkills
  })
  // Long-term memory is resolved before this point now (a cheap digest read
  // in prepareAgentChatContext, not a live search), so systemPrompts already
  // reflects it — nothing left to fetch here before the model call.
  const effectiveSystemPrompts = systemPrompts.filter(
    (prompt) => prompt.length > 0
  )
  let agentLoopOutcome: AgentLoopOutcome | null = null
  // The loop writes its final `finish` chunk before `runAgentLoop` resolves, so
  // onFinish can fire before `agentLoopOutcome` is assigned (an aborted run
  // would then persist without its exitReason). onFinish awaits this instead.
  const { promise: executeSettled, resolve: settleExecute } =
    Promise.withResolvers<null>()
  const reasoningTimingTap = createReasoningTimingTap()

  return createUIMessageStreamResponse({
    // A client abort cancels the HTTP branch; consuming a tee'd copy keeps the
    // source stream (and message assembly) running to the loop's abort exit, so
    // onFinish still receives the partial assistant message and can stamp
    // exitReason "aborted" + persist it instead of dropping the exchange.
    consumeSseStream: consumeStream,
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        try {
          await executeChatStream(writer)
        } finally {
          settleExecute(null)
        }
      },
      onError: describeChatStreamError,
      onEnd: async ({ isAborted, messages: nextMessages }) => {
        await executeSettled

        // The run (and every delegated child under it) has settled, so drop this
        // run's file-write ownership claims. Cheap in-memory cleanup done before
        // persistence so it runs even if persistence throws.
        if (agentRunId) {
          releaseRun(agentRunId)
        }

        const workTimeMs = Date.now() - requestStartedAt
        // Belt and braces: a run torn down before the loop could settle (e.g.
        // aborted before the first model call) still records why it stopped.
        const exitReason =
          agentLoopOutcome?.exitReason ?? (isAborted ? "aborted" : undefined)

        await onFinishPersist(
          attachRunOutcomeToLatestAssistantMessage(nextMessages, {
            exitReason,
            thoughtDurationsMs: reasoningTimingTap.getDurationsMs(),
            workTimeMs
          }),
          agentLoopOutcome
        )
      },
      originalMessages: messages
    })
  })

  async function executeChatStream(
    writer: UIMessageStreamWriter<UIMessage>
  ): Promise<void> {
    writeRequestPhase(writer, "model-start")

    if (!settings.agents.enabled) {
      const effortProviderOptions = resolveEffortProviderOptionsForSelection(
        settings.ai,
        modelId
      )
      const { runWithMoonshotReasoningContext } =
        await import("@/shared/providers/moonshot-reasoning")
      const result = await runWithMoonshotReasoningContext(
        moonshotReasoningForAssistantToolCalls,
        () =>
          Promise.resolve(
            streamText({
              abortSignal,
              experimental_transform: createChatSmoothingTransform(),
              ...(effectiveSystemPrompts.length > 0
                ? { instructions: effectiveSystemPrompts.join("\n\n") }
                : {}),
              ...(effortProviderOptions
                ? { providerOptions: effortProviderOptions }
                : {}),
              messages: preparedModelMessages,
              model
            })
          )
      )

      writer.merge(
        tapFirstChunkLatency(
          reasoningTimingTap.wrap(
            toUIMessageStream({
              originalMessages: messages,
              sendReasoning: true,
              stream: result.stream
            })
          ),
          "chat_first_chunk",
          { agent_mode: false, session_id: sessionId }
        )
      )

      return
    }

    writeRequestPhase(writer, "agent-turn")

    const agentStreamSetupLog = logger.startEvent("chat_agent_stream_setup", {
      agent_run_id: agentRunId,
      session_id: sessionId
    })
    const profile = resolveActiveProfile(settings.agents, profileId ?? null)
    // A profile's preferred model overrides the session model, matching
    // the model resolution the Mastra agent previously did per request.
    const agentModel =
      profile.preferredModel.length > 0
        ? resolveModel(profile.preferredModel)
        : model
    const agentEffortProviderOptions = resolveEffortProviderOptionsForSelection(
      settings.ai,
      profile.preferredModel.length > 0 ? profile.preferredModel : modelId
    )
    const agentTools = buildAgentToolset({
      agentMode: agentMode ?? "agent",
      agentRunId: agentRunId ?? null,
      chatSessionId: sessionId,
      modelId,
      permissionMode,
      profile,
      projectPath,
      writer
    })
    const workspaceRules = settings.agents.autoLoadWorkspaceRules
      ? await getWorkspaceCore(projectPath).readWorkspaceRules()
      : null
    const agentSystem = [
      buildAgentSystemPrompt(profile),
      ...(workspaceRules
        ? [
            `## Workspace rules (from ${workspaceRules.relativePath})\n\n${workspaceRules.content}`
          ]
        : []),
      ...effectiveSystemPrompts
    ].join("\n\n")

    agentStreamSetupLog.end()

    // The prepared model messages carry composer command transforms,
    // dangling-tool-call repair, and pending approval responses — the
    // AI SDK executes approved tool calls at the start of the next stream.
    agentLoopOutcome = await runAgentLoop({
      abortSignal,
      describeError: describeChatStreamError,
      maxSteps: AGENT_LOOP_STEP_FUSE,
      messages: preparedModelMessages,
      model: agentModel,
      ...(onAgentStep ? { onStepFinish: onAgentStep } : {}),
      ...(agentEffortProviderOptions
        ? { providerOptions: agentEffortProviderOptions }
        : {}),
      system: agentSystem,
      tapUiStream: reasoningTimingTap.wrap,
      toolApproval: buildAgentToolApproval({ permissionMode, projectPath }),
      tools: agentTools,
      transform: createChatSmoothingTransform(),
      writer: withFirstChunkLatency(writer, {
        agent_mode: true,
        agent_run_id: agentRunId,
        session_id: sessionId
      })
    })
  }
}
