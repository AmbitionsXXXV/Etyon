import type { AppSettings } from "@etyon/rpc"
import { StartBestOfNInputSchema } from "@etyon/rpc/schemas/worktrees"
import type { UIMessage } from "ai"
import type { z } from "zod"

import { getAutomationSessionConflict } from "@/main/agents/automation/agent-state"
import { listChatMessages } from "@/main/chat-messages"
import type { AppDatabase } from "@/main/db"
import { isImageOutputModelSelection } from "@/main/server/lib/providers"
import {
  resolveActiveProfile,
  resolveProfileRoster
} from "@/shared/agents/profiles"

interface ChatSubmissionInput {
  automationPrompt?: unknown
  automationRunId?: unknown
  bestOfN?: unknown
  permissionMode?: unknown
  profileId?: string
  sessionId: string
  submittedMessages: UIMessage[]
}
interface SubmissionFailure {
  error: string
  ok: false
  status: 400 | 409
}
type BestOfNRequest = z.infer<typeof StartBestOfNInputSchema>

export const resolveImageRequestModel = ({
  bestOfN,
  imageMode,
  modelId,
  settings
}: {
  bestOfN?: BestOfNRequest
  imageMode: unknown
  modelId: string | null
  settings: AppSettings
}): string | null =>
  imageMode === true &&
  !bestOfN &&
  modelId &&
  isImageOutputModelSelection(settings.ai, modelId)
    ? modelId
    : null

const prepareAutomationMessages = async (
  db: AppDatabase,
  input: ChatSubmissionInput
): Promise<{ messages: UIMessage[]; ok: true } | SubmissionFailure> => {
  if (
    input.permissionMode !== "default" &&
    input.permissionMode !== "acceptEdits"
  ) {
    return { error: "invalid_automation_permission", ok: false, status: 400 }
  }
  if (
    typeof input.automationPrompt !== "string" ||
    !input.automationPrompt.trim() ||
    input.automationPrompt.length > 32_000 ||
    typeof input.automationRunId !== "string" ||
    !input.automationRunId ||
    input.automationRunId.length > 100
  ) {
    return { error: "invalid_automation_request", ok: false, status: 400 }
  }
  if (await getAutomationSessionConflict(db, input.sessionId)) {
    return { error: "chat_session_busy", ok: false, status: 409 }
  }
  const messages = await listChatMessages({ db, sessionId: input.sessionId })
  return {
    messages: [
      ...messages,
      {
        id: `automation-${input.automationRunId}`,
        metadata: { automationRunId: input.automationRunId },
        parts: [{ text: input.automationPrompt, type: "text" }],
        role: "user"
      }
    ],
    ok: true
  }
}

const prepareBestOfNRequest = (
  settings: AppSettings,
  input: ChatSubmissionInput
): { ok: true; request: BestOfNRequest } | SubmissionFailure => {
  const parsed = StartBestOfNInputSchema.safeParse({
    ...(typeof input.bestOfN === "object" && input.bestOfN !== null
      ? input.bestOfN
      : {}),
    sessionId: input.sessionId
  })
  if (!parsed.success || input.automationRunId !== undefined) {
    return { error: "invalid_best_of_n_request", ok: false, status: 400 }
  }
  const parent = resolveActiveProfile(settings.agents)
  const hasWritableDelegate = resolveProfileRoster(settings.agents).some(
    (profile) =>
      profile.available &&
      !profile.readonly &&
      parent.allowedDelegateProfileIds.includes(profile.id)
  )
  if (parent.readonly || !parent.allowDelegation || !hasWritableDelegate) {
    return { error: "best_of_n_delegation_unavailable", ok: false, status: 400 }
  }
  return { ok: true, request: parsed.data }
}

export const prepareChatSubmission = async ({
  db,
  input,
  settings
}: {
  db: AppDatabase
  input: ChatSubmissionInput
  settings: AppSettings
}): Promise<
  | SubmissionFailure
  | {
      bestOfNRequest?: BestOfNRequest
      messages: UIMessage[]
      ok: true
      settings: AppSettings
    }
> => {
  if (
    input.profileId &&
    !resolveProfileRoster(settings.agents).some(
      (profile) => profile.id === input.profileId && profile.available
    )
  ) {
    return { error: "agent_profile_unavailable", ok: false, status: 400 }
  }
  const effectiveSettings = input.profileId
    ? {
        ...settings,
        agents: { ...settings.agents, defaultProfileId: input.profileId }
      }
    : settings
  let messages = input.submittedMessages
  if (
    input.automationPrompt !== undefined ||
    input.automationRunId !== undefined
  ) {
    const automation = await prepareAutomationMessages(db, input)
    if (!automation.ok) {
      return automation
    }
    ;({ messages } = automation)
  }
  if (!Array.isArray(messages)) {
    return { error: "invalid_chat_messages", ok: false, status: 400 }
  }
  let bestOfNRequest: BestOfNRequest | undefined
  if (input.bestOfN !== undefined) {
    const bestOfN = prepareBestOfNRequest(effectiveSettings, input)
    if (!bestOfN.ok) {
      return bestOfN
    }
    bestOfNRequest = bestOfN.request
  }
  return { bestOfNRequest, messages, ok: true, settings: effectiveSettings }
}
