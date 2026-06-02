import type { AppSettings, ParsedSkill } from "@etyon/rpc"
import type { LanguageModel, ModelMessage, UIMessage } from "ai"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"

import {
  getLatestUserMessageBoundary,
  mergeAgentEventProjectionIntoChatMessages
} from "@/main/agents/agent-chat-projection"
import { listAgentEvents } from "@/main/agents/agent-event-store"
import type { streamAgentChat } from "@/main/agents/agent-runtime"
import { createAgentRuntimeState } from "@/main/agents/agent-state"
import type { AgentRuntimeState } from "@/main/agents/agent-state"
import { CODE_AGENT_READONLY_TOOL_ALIASES } from "@/main/agents/code-agent-tool-aliases"
import {
  formatPromptTemplateInvocation,
  parseCommandArgs
} from "@/main/agents/prompt-templates"
import type { PromptTemplate } from "@/main/agents/prompt-templates"
import { formatSkillCommandInvocation, listSkills } from "@/main/skills"
import { attachWorkTimeToLatestAssistantMessage } from "@/shared/chat/message-metadata"
import { CHAT_REQUEST_PHASE_DATA_TYPE } from "@/shared/chat/stream-data"
import type { ChatRequestPhaseData } from "@/shared/chat/stream-data"

type StreamAgentChatResult = Awaited<ReturnType<typeof streamAgentChat>>
type StreamAgentChatOptions = Parameters<typeof streamAgentChat>[0]

const LONG_TERM_MEMORY_RETRIEVAL_TIMEOUT_MS = 2500
const PLAN_COMMAND_PATTERN = /^\/plan(?:\s+|$)/iu
const PLAN_MODE_FALLBACK_PROMPT = "Create a structured implementation plan."
const PLAN_MODE_ACTIVE_TOOL_NAMES = [
  ...CODE_AGENT_READONLY_TOOL_ALIASES,
  "requestAccess"
] as const
const PLAN_MODE_SYSTEM_PROMPT = [
  "[PLAN MODE ACTIVE]",
  "Use read-only project evidence first.",
  "Return a numbered plan with action, files, and risk level for each item."
].join("\n")
const PROMPT_TEMPLATE_COMMAND_PATTERN = /^\/prompt(?:\s+|$)/iu
const PROMPT_TEMPLATE_FALLBACK_PROMPT =
  "Prompt template command was incomplete. Ask the user which template to use."
const SKILL_COMMAND_PATTERN = /^\/skill(?:\s+|$)/iu
const SKILL_COMMAND_FALLBACK_PROMPT =
  "Skill command was incomplete. Ask the user which skill and command to run."

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const stripPlanCommand = (text: string): string =>
  text.replace(PLAN_COMMAND_PATTERN, "").trim()

const stripPromptTemplateCommand = (text: string): string =>
  text.replace(PROMPT_TEMPLATE_COMMAND_PATTERN, "").trim()

const stripSkillCommand = (text: string): string =>
  text.replace(SKILL_COMMAND_PATTERN, "").trim()

const getUiMessageText = (message: UIMessage): string =>
  message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
    .trim()

const isPlanModeRequest = (messages: UIMessage[]): boolean => {
  const latestUserMessage = messages.findLast(
    (message) => message.role === "user"
  )

  return latestUserMessage
    ? PLAN_COMMAND_PATTERN.test(getUiMessageText(latestUserMessage))
    : false
}

const stripPlanCommandFromModelMessage = (
  message: ModelMessage
): ModelMessage => {
  if (message.role !== "user") {
    return message
  }

  if (typeof message.content === "string") {
    return {
      ...message,
      content: stripPlanCommand(message.content) || PLAN_MODE_FALLBACK_PROMPT
    }
  }

  if (!Array.isArray(message.content)) {
    return message
  }

  let stripped = false
  const content = message.content.map((part) => {
    if (
      stripped ||
      !isRecord(part) ||
      part.type !== "text" ||
      typeof part.text !== "string" ||
      !PLAN_COMMAND_PATTERN.test(part.text)
    ) {
      return part
    }

    stripped = true

    return {
      ...part,
      text: stripPlanCommand(part.text) || PLAN_MODE_FALLBACK_PROMPT
    }
  })

  return stripped
    ? {
        ...message,
        content
      }
    : message
}

const stripPlanCommandFromLatestModelMessage = (
  modelMessages: ModelMessage[]
): ModelMessage[] => {
  const latestUserMessageIndex = modelMessages.findLastIndex(
    (message) => message.role === "user"
  )

  if (latestUserMessageIndex === -1) {
    return modelMessages
  }

  return modelMessages.map((message, index) =>
    index === latestUserMessageIndex
      ? stripPlanCommandFromModelMessage(message)
      : message
  )
}

const findPromptTemplate = ({
  name,
  promptTemplates
}: {
  name: string
  promptTemplates: readonly PromptTemplate[]
}): PromptTemplate | null => {
  const normalizedName = name.toLowerCase()

  return (
    promptTemplates.find(
      (template) => template.name.toLowerCase() === normalizedName
    ) ?? null
  )
}

const resolvePromptTemplateCommandText = ({
  promptTemplates,
  text
}: {
  promptTemplates: readonly PromptTemplate[]
  text: string
}): string => {
  const commandText = stripPromptTemplateCommand(text)

  if (commandText.length === 0) {
    return PROMPT_TEMPLATE_FALLBACK_PROMPT
  }

  try {
    const [templateName, ...args] = parseCommandArgs(commandText)

    if (!templateName) {
      return PROMPT_TEMPLATE_FALLBACK_PROMPT
    }

    const template = findPromptTemplate({
      name: templateName,
      promptTemplates
    })

    if (!template) {
      return `Prompt template not found: ${templateName}. Ask the user to choose an available template.`
    }

    return formatPromptTemplateInvocation(template, args)
  } catch (error) {
    return `Prompt template command could not be parsed: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}

const applyPromptTemplateCommandToModelMessage = ({
  message,
  promptTemplates
}: {
  message: ModelMessage
  promptTemplates: readonly PromptTemplate[]
}): ModelMessage => {
  if (message.role !== "user") {
    return message
  }

  if (typeof message.content === "string") {
    if (!PROMPT_TEMPLATE_COMMAND_PATTERN.test(message.content)) {
      return message
    }

    return {
      ...message,
      content: resolvePromptTemplateCommandText({
        promptTemplates,
        text: message.content
      })
    }
  }

  if (!Array.isArray(message.content)) {
    return message
  }

  let replaced = false
  const content = message.content.map((part) => {
    if (
      replaced ||
      !isRecord(part) ||
      part.type !== "text" ||
      typeof part.text !== "string" ||
      !PROMPT_TEMPLATE_COMMAND_PATTERN.test(part.text)
    ) {
      return part
    }

    replaced = true

    return {
      ...part,
      text: resolvePromptTemplateCommandText({
        promptTemplates,
        text: part.text
      })
    }
  })

  return replaced
    ? {
        ...message,
        content
      }
    : message
}

const applyPromptTemplateCommandToLatestModelMessage = ({
  modelMessages,
  promptTemplates
}: {
  modelMessages: ModelMessage[]
  promptTemplates: readonly PromptTemplate[]
}): ModelMessage[] => {
  const latestUserMessageIndex = modelMessages.findLastIndex(
    (message) => message.role === "user"
  )

  if (latestUserMessageIndex === -1) {
    return modelMessages
  }

  return modelMessages.map((message, index) =>
    index === latestUserMessageIndex
      ? applyPromptTemplateCommandToModelMessage({
          message,
          promptTemplates
        })
      : message
  )
}

const findSkillByName = ({
  name,
  skills
}: {
  name: string
  skills: readonly ParsedSkill[]
}): ParsedSkill | null => {
  const normalizedName = name.toLowerCase()

  return (
    skills.find(
      (skill) => skill.visible && skill.name.toLowerCase() === normalizedName
    ) ?? null
  )
}

const findSkillCommandByName = ({
  commandName,
  skill
}: {
  commandName: string
  skill: ParsedSkill
}): ParsedSkill["commands"][number] | null => {
  const normalizedCommandName = commandName.toLowerCase()

  return (
    skill.commands.find(
      (command) => command.name.toLowerCase() === normalizedCommandName
    ) ?? null
  )
}

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
}): string | null => {
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
  skills,
  text
}: {
  skills: readonly ParsedSkill[]
  text: string
}): string => {
  const commandText = stripSkillCommand(text)

  if (commandText.length === 0) {
    return SKILL_COMMAND_FALLBACK_PROMPT
  }

  try {
    const [skillName, commandName, ...rawArgs] = parseCommandArgs(commandText)

    if (!skillName || !commandName) {
      return SKILL_COMMAND_FALLBACK_PROMPT
    }

    const skill = findSkillByName({
      name: skillName,
      skills
    })

    if (!skill) {
      return `Skill not found: ${skillName}. Ask the user to choose an available skill.`
    }

    const command = findSkillCommandByName({
      commandName,
      skill
    })

    if (!command) {
      return `Skill command not found: ${skillName} ${commandName}. Ask the user to choose an available command.`
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
  } catch (error) {
    return `Skill command could not be parsed: ${
      error instanceof Error ? error.message : String(error)
    }`
  }
}

const applySkillCommandToModelMessage = ({
  message,
  skills
}: {
  message: ModelMessage
  skills: readonly ParsedSkill[]
}): ModelMessage => {
  if (message.role !== "user") {
    return message
  }

  if (typeof message.content === "string") {
    if (!SKILL_COMMAND_PATTERN.test(message.content)) {
      return message
    }

    return {
      ...message,
      content: resolveSkillCommandText({
        skills,
        text: message.content
      })
    }
  }

  if (!Array.isArray(message.content)) {
    return message
  }

  let replaced = false
  const content = message.content.map((part) => {
    if (
      replaced ||
      !isRecord(part) ||
      part.type !== "text" ||
      typeof part.text !== "string" ||
      !SKILL_COMMAND_PATTERN.test(part.text)
    ) {
      return part
    }

    replaced = true

    return {
      ...part,
      text: resolveSkillCommandText({
        skills,
        text: part.text
      })
    }
  })

  return replaced
    ? {
        ...message,
        content
      }
    : message
}

const modelMessageHasSkillCommand = (message: ModelMessage): boolean => {
  if (typeof message.content === "string") {
    return SKILL_COMMAND_PATTERN.test(message.content)
  }

  if (!Array.isArray(message.content)) {
    return false
  }

  const contentParts: unknown[] = message.content

  return contentParts.some(
    (part) =>
      isRecord(part) &&
      part.type === "text" &&
      typeof part.text === "string" &&
      SKILL_COMMAND_PATTERN.test(part.text)
  )
}

const applySkillCommandToLatestModelMessage = ({
  modelMessages,
  projectPath,
  skillCommandSkills
}: {
  modelMessages: ModelMessage[]
  projectPath: string
  skillCommandSkills?: readonly ParsedSkill[]
}): ModelMessage[] => {
  const latestUserMessageIndex = modelMessages.findLastIndex(
    (message) => message.role === "user"
  )

  if (latestUserMessageIndex === -1) {
    return modelMessages
  }

  const latestUserMessage = modelMessages[latestUserMessageIndex]

  if (!modelMessageHasSkillCommand(latestUserMessage)) {
    return modelMessages
  }

  const skills =
    skillCommandSkills ??
    listSkills({
      projectPaths: [projectPath]
    })

  return modelMessages.map((message, index) =>
    index === latestUserMessageIndex
      ? applySkillCommandToModelMessage({
          message,
          skills
        })
      : message
  )
}

const applyPlanModeRequest = ({
  messages,
  modelMessages,
  settings,
  systemPrompts
}: {
  messages: UIMessage[]
  modelMessages: ModelMessage[]
  settings: AppSettings
  systemPrompts: string[]
}): {
  activeToolNames?: readonly string[]
  modelMessages: ModelMessage[]
  settings: AppSettings
  systemPrompts: string[]
} => {
  if (!isPlanModeRequest(messages)) {
    return {
      activeToolNames: undefined,
      modelMessages,
      settings,
      systemPrompts
    }
  }

  return {
    activeToolNames: PLAN_MODE_ACTIVE_TOOL_NAMES,
    modelMessages: stripPlanCommandFromLatestModelMessage(modelMessages),
    settings: {
      ...settings,
      agents: {
        ...settings.agents,
        allowSubagentDelegation: false,
        defaultProfileId: "plan",
        enabled: true
      }
    },
    systemPrompts: [...systemPrompts, PLAN_MODE_SYSTEM_PROMPT]
  }
}

const writeRequestPhase = (
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

const writeAgentRuntimePhase = (
  writer: Parameters<typeof writeRequestPhase>[0],
  runtimeState: AgentRuntimeState
): (() => void) =>
  runtimeState.subscribe(({ phase }) => {
    if (phase === "turn") {
      writeRequestPhase(writer, "agent-turn")
    }
  })

interface BuildLongTermMemorySystemOptions {
  abortSignal: AbortSignal
}

const createAbortSignalAny = (signals: readonly AbortSignal[]): AbortSignal => {
  const abortSignal = AbortSignal as typeof AbortSignal & {
    any: (signals: readonly AbortSignal[]) => AbortSignal
  }

  return abortSignal.any(signals)
}

const readLongTermMemorySystem = async ({
  abortSignal,
  buildLongTermMemorySystem,
  timeoutMs
}: {
  abortSignal: AbortSignal
  buildLongTermMemorySystem: (
    options: BuildLongTermMemorySystemOptions
  ) => Promise<string>
  timeoutMs: number
}): Promise<string> => {
  if (abortSignal.aborted || timeoutMs <= 0) {
    return ""
  }

  const memoryAbortSignal = createAbortSignalAny([
    abortSignal,
    AbortSignal.timeout(timeoutMs)
  ])

  try {
    return await buildLongTermMemorySystem({
      abortSignal: memoryAbortSignal
    })
  } catch (error) {
    if (memoryAbortSignal.aborted) {
      return ""
    }

    throw error
  }
}

export interface BuildChatStreamResponseOptions {
  abortSignal: AbortSignal
  buildLongTermMemorySystem: (
    options: BuildLongTermMemorySystemOptions
  ) => Promise<string>
  chatLifecycleBranch?: StreamAgentChatOptions["chatLifecycleBranch"]
  extensionRunner?: StreamAgentChatOptions["extensionRunner"]
  messages: UIMessage[]
  memoryRetrievalTimeoutMs?: number
  model: LanguageModel
  modelId: string | null
  modelMessages: ModelMessage[]
  moonshotReasoningForAssistantToolCalls: readonly string[]
  onFinishPersist: (messages: UIMessage[]) => Promise<void>
  projectPath: string
  promptTemplates?: readonly PromptTemplate[]
  requestStartedAt: number
  sessionId: string
  settings: AppSettings
  shouldRetrieveLongTermMemory: boolean
  skillCommandSkills?: readonly ParsedSkill[]
  skillCapabilities?: readonly string[]
  streamAgentChat: (
    options: Parameters<typeof streamAgentChat>[0]
  ) => Promise<StreamAgentChatResult>
  systemPrompts: string[]
  db: Parameters<typeof streamAgentChat>[0]["db"]
}

export const buildChatStreamResponse = ({
  abortSignal,
  buildLongTermMemorySystem,
  chatLifecycleBranch,
  db,
  extensionRunner,
  messages,
  model,
  modelId,
  modelMessages,
  moonshotReasoningForAssistantToolCalls,
  onFinishPersist,
  projectPath,
  promptTemplates = [],
  requestStartedAt,
  sessionId,
  settings,
  shouldRetrieveLongTermMemory,
  skillCommandSkills,
  skillCapabilities,
  streamAgentChat: runStreamAgentChat,
  systemPrompts,
  memoryRetrievalTimeoutMs = LONG_TERM_MEMORY_RETRIEVAL_TIMEOUT_MS
}: BuildChatStreamResponseOptions): Response => {
  const planModeRequest = applyPlanModeRequest({
    messages,
    modelMessages: applySkillCommandToLatestModelMessage({
      modelMessages: applyPromptTemplateCommandToLatestModelMessage({
        modelMessages,
        promptTemplates
      }),
      projectPath,
      skillCommandSkills
    }),
    settings,
    systemPrompts
  })
  let agentRunId: null | string = null

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        if (shouldRetrieveLongTermMemory) {
          writeRequestPhase(writer, "memory-loading")
        }

        const longTermMemorySystem = shouldRetrieveLongTermMemory
          ? await readLongTermMemorySystem({
              abortSignal,
              buildLongTermMemorySystem,
              timeoutMs: memoryRetrievalTimeoutMs
            })
          : ""
        const effectiveSystemPrompts = [
          ...planModeRequest.systemPrompts,
          longTermMemorySystem
        ].filter((prompt) => prompt.length > 0)

        writeRequestPhase(writer, "model-start")

        const runtimeState = createAgentRuntimeState()
        const unsubscribeRuntimeState = writeAgentRuntimePhase(
          writer,
          runtimeState
        )
        const { runWithMoonshotReasoningContext } =
          await import("@/shared/providers/moonshot-reasoning")
        let result: StreamAgentChatResult

        try {
          result = await runWithMoonshotReasoningContext(
            moonshotReasoningForAssistantToolCalls,
            () =>
              runStreamAgentChat({
                abortSignal,
                activeToolNames: planModeRequest.activeToolNames,
                chatLifecycleBranch,
                db,
                extensionRunner,
                messages: planModeRequest.modelMessages,
                model,
                modelId,
                projectPath,
                runtimeState,
                sessionId,
                settings: planModeRequest.settings,
                skillCapabilities,
                systemPrompts: effectiveSystemPrompts
              })
          )
        } finally {
          unsubscribeRuntimeState()
        }

        ;({ agentRunId } = result)

        writer.merge(
          result.toUIMessageStream({
            originalMessages: messages,
            sendReasoning: true
          })
        )
      },
      onFinish: async ({ messages: nextMessages }) => {
        const workTimeMs = Date.now() - requestStartedAt
        const messagesWithWorkTime = attachWorkTimeToLatestAssistantMessage(
          nextMessages,
          workTimeMs
        )
        const userBoundaryMessageCount =
          getLatestUserMessageBoundary(messagesWithWorkTime)
        const projectedMessages = agentRunId
          ? mergeAgentEventProjectionIntoChatMessages({
              events: await listAgentEvents({
                db,
                runId: agentRunId
              }),
              messages: messagesWithWorkTime,
              originalMessageCount: userBoundaryMessageCount,
              runId: agentRunId
            })
          : messagesWithWorkTime

        await onFinishPersist(projectedMessages)
      },
      originalMessages: messages
    })
  })
}
