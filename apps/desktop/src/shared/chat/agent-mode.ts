export const CHAT_AGENT_MODES = ["chat", "agent", "plan"] as const

export type ChatAgentMode = (typeof CHAT_AGENT_MODES)[number]

export const getChatAgentModeFromAgentsEnabled = (
  agentsEnabled: boolean
): ChatAgentMode => (agentsEnabled ? "agent" : "chat")

export const getNextChatAgentMode = (
  agentMode: ChatAgentMode
): ChatAgentMode => {
  const currentIndex = CHAT_AGENT_MODES.indexOf(agentMode)
  const nextIndex = (currentIndex + 1) % CHAT_AGENT_MODES.length

  return CHAT_AGENT_MODES[nextIndex] ?? CHAT_AGENT_MODES[0]
}

export const getChatAgentModeToggleDisabled = ({
  isRequestPending
}: {
  isRequestPending: boolean
}): boolean => isRequestPending

export const isChatAgentMode = (value: unknown): value is ChatAgentMode =>
  value === "agent" || value === "chat" || value === "plan"

// Plan mode runs the agent (tools enabled) like Agent mode, but pairs it with
// a planning system prompt that keeps the turn read-only.
export const getChatAgentModeAgentsEnabled = (mode: ChatAgentMode): boolean =>
  mode === "agent" || mode === "plan"

const PLAN_COMMAND_PATTERN = /^\/plan(?:\s+|$)/iu

export const isChatPlanCommandText = (text: string): boolean =>
  PLAN_COMMAND_PATTERN.test(text.trimStart())

export const stripChatPlanCommand = (text: string): string =>
  text.trimStart().replace(PLAN_COMMAND_PATTERN, "").trimStart()

const IMAGEN_COMMAND_PATTERN = /^\/imagen(?:\s+|$)/iu

export const isChatImagenCommandText = (text: string): boolean =>
  IMAGEN_COMMAND_PATTERN.test(text.trimStart())

export const stripChatImagenCommand = (text: string): string =>
  text.trimStart().replace(IMAGEN_COMMAND_PATTERN, "").trimStart()

export const CHAT_PLAN_MODE_SYSTEM_PROMPT = `You are operating in PLAN MODE.

Your job is to investigate and produce a clear, actionable implementation plan — not to make changes.

- Use only the read-only tools (read, ls, grep) to understand the project.
- Do NOT call the edit or write tools, and do not create, modify, or delete any files in this mode.
- Deliver a concise, step-by-step plan: which files to change, what each change does, and any risks or open questions.
- When the user is ready to carry out the plan, tell them to switch to Agent mode.`

export const getChatAgentModeSystemPrompt = (
  mode: ChatAgentMode | undefined
): null | string => (mode === "plan" ? CHAT_PLAN_MODE_SYSTEM_PROMPT : null)

// Turn-scoped prompt injected when the user runs the /imagen command. Unlike
// plan, imagen is not a persistent mode — it nudges the current agent turn to
// generate an image with the imagen tool.
export const CHAT_IMAGEN_SYSTEM_PROMPT = `The user invoked the /imagen command: they want you to generate an image.

- Use the imagen tool. Treat the message (after "/imagen") as the image request.
- Craft a vivid, specific prompt for the tool: subject, style, composition, lighting, mood. Enrich a terse request with sensible detail rather than asking follow-up questions.
- Choose reasonable defaults for size and quality unless the user specified them; only ask if the request is genuinely ambiguous.
- After the image is generated, describe in one sentence what you created. Do not repeat the full prompt.
- If the imagen tool is not available, tell the user an OpenAI provider must be configured and that the profile must allow writes.`
