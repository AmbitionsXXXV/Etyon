import type { AppSettings, ParsedSkill } from "@etyon/rpc"
import { handleChatStream } from "@mastra/ai-sdk"
import { RequestContext } from "@mastra/core/request-context"
import type { LanguageModel, ModelMessage, UIMessage } from "ai"
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText
} from "ai"

import {
  FILE_AGENT_ID,
  fileAgentMastra
} from "@/main/agents/minimal/file-agent"
import {
  formatPromptTemplateInvocation,
  parseCommandArgs
} from "@/main/agents/prompt-templates"
import type { PromptTemplate } from "@/main/agents/prompt-templates"
import { formatSkillCommandInvocation, listSkills } from "@/main/skills"
import {
  isChatPlanCommandText,
  stripChatPlanCommand
} from "@/shared/chat/agent-mode"
import { attachWorkTimeToLatestAssistantMessage } from "@/shared/chat/message-metadata"
import { CHAT_REQUEST_PHASE_DATA_TYPE } from "@/shared/chat/stream-data"
import type { ChatRequestPhaseData } from "@/shared/chat/stream-data"

const LONG_TERM_MEMORY_RETRIEVAL_TIMEOUT_MS = 2500
const PROMPT_TEMPLATE_COMMAND_PATTERN = /^\/prompt(?:\s+|$)/iu
const PROMPT_TEMPLATE_FALLBACK_PROMPT =
  "Prompt template command was incomplete. Ask the user which template to use."
const SKILL_COMMAND_PATTERN = /^\/skill(?:\s+|$)/iu
const SKILL_COMMAND_FALLBACK_PROMPT =
  "Skill command was incomplete. Ask the user which skill and command to run."

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

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
  systemPrompts: string[]
  trigger?: "regenerate-message" | "submit-message"
}

export const buildChatStreamResponse = ({
  abortSignal,
  buildLongTermMemorySystem,
  messages,
  model,
  modelId,
  modelMessages,
  moonshotReasoningForAssistantToolCalls,
  onFinishPersist,
  projectPath,
  promptTemplates = [],
  requestStartedAt,
  settings,
  shouldRetrieveLongTermMemory,
  skillCommandSkills,
  systemPrompts,
  trigger,
  memoryRetrievalTimeoutMs = LONG_TERM_MEMORY_RETRIEVAL_TIMEOUT_MS
}: BuildChatStreamResponseOptions): Response => {
  const preparedModelMessages = applyComposerCommandsToLatestModelMessage({
    modelMessages,
    projectPath,
    promptTemplates,
    skillCommandSkills
  })

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
          ...systemPrompts,
          longTermMemorySystem
        ].filter((prompt) => prompt.length > 0)

        writeRequestPhase(writer, "model-start")

        if (!settings.agents.enabled) {
          const { runWithMoonshotReasoningContext } =
            await import("@/shared/providers/moonshot-reasoning")
          const result = await runWithMoonshotReasoningContext(
            moonshotReasoningForAssistantToolCalls,
            () =>
              Promise.resolve(
                streamText({
                  abortSignal,
                  ...(effectiveSystemPrompts.length > 0
                    ? { system: effectiveSystemPrompts.join("\n\n") }
                    : {}),
                  messages: preparedModelMessages,
                  model
                })
              )
          )

          writer.merge(
            result.toUIMessageStream({
              originalMessages: messages,
              sendReasoning: true
            })
          )

          return
        }

        writeRequestPhase(writer, "agent-turn")

        const agentStream = await handleChatStream({
          agentId: FILE_AGENT_ID,
          mastra: fileAgentMastra,
          params: {
            abortSignal,
            maxSteps: settings.agents.maxSteps,
            // The Mastra bridge converts UIMessages itself and detects
            // approval responses in the trailing assistant message.
            messages: messages as never,
            requestContext: new RequestContext(
              Object.entries({
                ...(modelId ? { modelId } : {}),
                projectPath
              })
            ),
            ...(effectiveSystemPrompts.length > 0
              ? { system: effectiveSystemPrompts.join("\n\n") }
              : {}),
            ...(trigger ? { trigger } : {})
          },
          sendReasoning: true,
          version: "v6"
        })

        // The bridge stream and Etyon share the AI SDK v6 UIMessageChunk
        // wire format; the cast bridges its vendored type declarations.
        writer.merge(agentStream as never)
      },
      onFinish: async ({ messages: nextMessages }) => {
        const workTimeMs = Date.now() - requestStartedAt

        await onFinishPersist(
          attachWorkTimeToLatestAssistantMessage(nextMessages, workTimeMs)
        )
      },
      originalMessages: messages
    })
  })
}
