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
