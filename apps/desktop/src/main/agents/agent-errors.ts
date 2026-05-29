export type AgentRuntimeErrorCode =
  | "branch_summary"
  | "busy"
  | "compaction"
  | "hook"
  | "provider"
  | "session"
  | "tool"

export interface AgentRuntimeErrorOptions {
  cause?: unknown
}

export class AgentRuntimeError extends Error {
  cause?: unknown
  code: AgentRuntimeErrorCode

  constructor(
    code: AgentRuntimeErrorCode,
    message: string,
    options: AgentRuntimeErrorOptions = {}
  ) {
    super(message)
    this.cause = options.cause
    this.code = code
    this.name = "AgentRuntimeError"
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const getAgentRuntimeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  if (isRecord(error)) {
    if (typeof error.error === "string") {
      return error.error
    }

    if (typeof error.message === "string") {
      return error.message
    }
  }

  return String(error)
}

export const toAgentRuntimeError = ({
  cause,
  code,
  message
}: {
  cause: unknown
  code: AgentRuntimeErrorCode
  message?: string
}): AgentRuntimeError => {
  if (cause instanceof AgentRuntimeError) {
    return cause
  }

  return new AgentRuntimeError(
    code,
    message ?? getAgentRuntimeErrorMessage(cause),
    {
      cause
    }
  )
}
