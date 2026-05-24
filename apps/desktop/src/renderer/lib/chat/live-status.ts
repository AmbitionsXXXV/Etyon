import {
  ANT_THINKING_CLOSE_TAG,
  ANT_THINKING_OPEN_TAG
} from "@/renderer/lib/chat/tool-ui"
import type { ChatRequestPhase } from "@/shared/chat/stream-data"

const TERMINAL_TOOL_NAMES = new Set(["bash", "rtkCommand", "runCheck", "shell"])

export type AssistantLiveStatusKind =
  | "agent-turn"
  | "memory-loading"
  | "model-start"
  | "receiving"
  | "thinking"
  | "tool-running"
  | "waiting"

interface LiveStatusMessagePart {
  input?: unknown
  state?: string
  text?: string
  toolCallId?: string
  type: string
}

interface LiveStatusMessage {
  parts: LiveStatusMessagePart[]
  role: string
}

const getMessageText = (message: LiveStatusMessage): string =>
  message.parts
    .filter(
      (part): part is LiveStatusMessagePart & { text: string } =>
        part.type === "text" && "text" in part
    )
    .map((part) => part.text)
    .join("")

const hasOpenAntThinkingTag = (text: string): boolean => {
  const openIndex = text.indexOf(ANT_THINKING_OPEN_TAG)

  if (openIndex === -1) {
    return false
  }

  const closeIndex = text.indexOf(ANT_THINKING_CLOSE_TAG, openIndex)

  return closeIndex === -1
}

const hasStreamingReasoningPart = (parts: LiveStatusMessagePart[]): boolean =>
  parts.some(
    (part) =>
      part.type === "reasoning" &&
      (part.state === "streaming" || part.state === undefined)
  )

const getToolNameFromPart = (part: LiveStatusMessagePart): string => {
  if (part.type === "dynamic-tool") {
    return "dynamic-tool"
  }

  if (part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length)
  }

  return ""
}

const hasActiveToolPart = (parts: LiveStatusMessagePart[]): boolean =>
  parts.some((part) => {
    if (!part.type.startsWith("tool-") && part.type !== "dynamic-tool") {
      return false
    }

    return (
      part.state === "input-streaming" ||
      part.state === "input-available" ||
      part.state === "approval-requested"
    )
  })

const hasTerminalToolActivity = (parts: LiveStatusMessagePart[]): boolean =>
  parts.some((part) => {
    if (
      !(part.state === "input-streaming" || part.state === "input-available")
    ) {
      return false
    }

    return TERMINAL_TOOL_NAMES.has(getToolNameFromPart(part))
  })

const resolveSubmittedLiveStatus = (
  requestPhase: ChatRequestPhase | null | undefined
): AssistantLiveStatusKind => {
  if (requestPhase === "memory-loading") {
    return "memory-loading"
  }

  if (requestPhase === "model-start") {
    return "model-start"
  }

  if (requestPhase === "agent-turn") {
    return "agent-turn"
  }

  return "waiting"
}

export const resolveAssistantLiveStatus = ({
  latestMessage,
  requestPhase,
  status
}: {
  latestMessage?: LiveStatusMessage
  requestPhase?: ChatRequestPhase | null
  status: "streaming" | "submitted"
}): AssistantLiveStatusKind => {
  if (status === "submitted") {
    return resolveSubmittedLiveStatus(requestPhase)
  }

  if (!latestMessage || latestMessage.role !== "assistant") {
    return requestPhase === "model-start" ? "model-start" : "receiving"
  }

  const { parts } = latestMessage
  const messageText = getMessageText(latestMessage).trim()

  if (hasStreamingReasoningPart(parts) || hasOpenAntThinkingTag(messageText)) {
    return "thinking"
  }

  if (hasTerminalToolActivity(parts)) {
    return "tool-running"
  }

  if (hasActiveToolPart(parts) && messageText === "") {
    return "tool-running"
  }

  if (messageText === "" && hasActiveToolPart(parts)) {
    return "tool-running"
  }

  return "receiving"
}

export const ASSISTANT_LIVE_STATUS_LABEL_KEY = {
  "agent-turn": "chat.live.agentTurn",
  "memory-loading": "chat.live.memoryLoading",
  "model-start": "chat.live.modelStart",
  receiving: "chat.live.receiving",
  thinking: "chat.live.thinking",
  "tool-running": "chat.live.toolRunning",
  waiting: "chat.live.waiting"
} as const satisfies Record<AssistantLiveStatusKind, string>
