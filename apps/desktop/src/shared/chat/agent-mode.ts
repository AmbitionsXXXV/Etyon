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

const WORKFLOW_COMMAND_PATTERN = /^\/workflow(?:\s+|$)/iu

export const isChatWorkflowCommandText = (text: string): boolean =>
  WORKFLOW_COMMAND_PATTERN.test(text.trimStart())

export const CHAT_PLAN_MODE_SYSTEM_PROMPT = `You are operating in PLAN MODE.

Your job is to investigate and produce a clear, actionable implementation plan — not to make changes.

- Only read-only tools are available here: read, ls, grep, todo_write, and read-only delegation when offered. File editing and shell tools are disabled in this mode.
- Investigate first: read the relevant files and understand the current behavior before proposing changes.
- When a decision materially forks the plan (technology choice, data model, scope), ask the user with the ask_user tool BEFORE finalizing the plan — 2-5 mutually exclusive options; never re-ask what they already said.
- When the plan is complete, call propose_plan with a short title and the full plan in markdown: ordered steps, files to change, what each change does, risks and open questions. Do not deliver the plan only as chat text.
- After the user's decision: "implement" → turn the plan into todos with todo_write first, then execute it step by step; "not_now" → acknowledge in one short sentence and stop — the plan stays saved for later.`

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

// Turn-scoped prompt injected when the user runs the /workflow command. Like
// imagen it is not a persistent mode — it nudges the current agent turn to
// orchestrate a multi-agent workflow with the workflow tool.
export const CHAT_WORKFLOW_SYSTEM_PROMPT = `The user invoked the /workflow command: they explicitly asked for a multi-agent workflow this turn.

- Default to running one: use the workflow tool, treating the message (after "/workflow") as the task to carry out.
- Author a small deterministic script that fans READ-ONLY investigator sub-agents across the project to research, review, or understand the task in parallel, then synthesize their findings into your answer.
- If the task looks too narrow to benefit from fanning out (a single focused question or file), do not silently skip the workflow: briefly recommend whether a workflow is worth it here and let the user decide before proceeding.
- After the workflow finishes, summarize what the investigators found and the synthesized result rather than replaying the raw script output.
- If the workflow tool is not available, tell the user the active profile must allow delegation.`
