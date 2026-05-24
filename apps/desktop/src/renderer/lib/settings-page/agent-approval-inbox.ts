import type { PendingAgentApproval } from "@etyon/rpc"

export interface AgentApprovalInboxItem {
  id: string
  inputPreview: string
  meta: string[]
  title: string
}

const APPROVAL_INPUT_PREVIEW_MAX_LENGTH = 180

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const getString = (
  value: Record<string, unknown>,
  key: string
): string | undefined =>
  typeof value[key] === "string" ? (value[key] as string) : undefined

export const formatApprovalInputPreview = (input: unknown): string => {
  if (!isRecord(input)) {
    return String(input ?? "").slice(0, APPROVAL_INPUT_PREVIEW_MAX_LENGTH)
  }

  const knownPreview =
    getString(input, "command") ??
    getString(input, "path") ??
    getString(input, "query") ??
    getString(input, "task")

  if (knownPreview) {
    return knownPreview.slice(0, APPROVAL_INPUT_PREVIEW_MAX_LENGTH)
  }

  try {
    return JSON.stringify(input).slice(0, APPROVAL_INPUT_PREVIEW_MAX_LENGTH)
  } catch {
    return String(input).slice(0, APPROVAL_INPUT_PREVIEW_MAX_LENGTH)
  }
}

export const buildAgentApprovalInboxItem = (
  approval: PendingAgentApproval
): AgentApprovalInboxItem => ({
  id: approval.approvalId ?? approval.id,
  inputPreview: formatApprovalInputPreview(approval.input),
  meta: [approval.profileId, approval.runStatus, approval.state],
  title: approval.toolName
})
