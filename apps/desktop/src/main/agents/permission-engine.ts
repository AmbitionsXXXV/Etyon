import path from "node:path"

import type { AgentToolName } from "@/main/agents/types"

export type AgentPermissionAction = "allow" | "ask" | "deny"

export type AgentPermissionRisk = "high" | "low" | "medium"

export interface AgentPermissionDecision {
  action: AgentPermissionAction
  reason: string
  risk: AgentPermissionRisk
  ruleId: string
}

export interface EvaluateAgentToolPermissionOptions {
  input: unknown
  name: AgentToolName
  workspaceRoot: string
}

const COMMAND_INSTALL_PATTERN =
  /\b(?:bun|deno|npm|pnpm|vp|yarn)\s+(?:add|install|i)\b/u
const COMMAND_NETWORK_PATTERN = /\b(?:curl|wget|fetch|http|https)\b/u
const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/u,
  /\bgit\s+checkout\s+--\b/u,
  /\bgit\s+reset\s+--hard\b/u,
  /\bsudo\b/u
] as const
const READONLY_AGENT_TOOLS = new Set<AgentToolName>([
  "agentEventsSearch",
  "agentRunInspect",
  "gitDiff",
  "listProjectTree",
  "readFile",
  "searchFiles"
])
const SAFE_CHECK_COMMAND_PATTERN =
  /^(?:rtk\s+)?vp\s+run\s+[\w@/:#.-]+\s*(?:run\s+[\w@/:#.-]+)?$/u
const SECRET_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa"
])
const SECRET_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx"])
const SECRET_SEGMENTS = new Set([".ssh", "secrets"])
const SAFE_COMMAND_TIMEOUT_MS = 120_000

const buildDecision = ({
  action,
  reason,
  risk,
  ruleId
}: AgentPermissionDecision): AgentPermissionDecision => ({
  action,
  reason,
  risk,
  ruleId
})

const getInputBoolean = (input: unknown, key: string): boolean =>
  typeof input === "object" &&
  input !== null &&
  key in input &&
  Boolean((input as Record<string, unknown>)[key])

const getInputNumber = (input: unknown, key: string): number | undefined => {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return undefined
  }

  const value = (input as Record<string, unknown>)[key]

  return typeof value === "number" ? value : undefined
}

const getInputString = (input: unknown, key: string): string | undefined => {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return undefined
  }

  const value = (input as Record<string, unknown>)[key]

  return typeof value === "string" ? value : undefined
}

const isInsideWorkspace = (
  requestedPath: string,
  workspaceRoot: string
): boolean => {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  const resolvedPath = path.resolve(normalizedWorkspaceRoot, requestedPath)

  return (
    resolvedPath === normalizedWorkspaceRoot ||
    resolvedPath.startsWith(`${normalizedWorkspaceRoot}${path.sep}`)
  )
}

const isSecretPath = (requestedPath: string): boolean => {
  const normalizedPath = requestedPath.replaceAll("\\", "/").toLowerCase()
  const basename = path.posix.basename(normalizedPath)
  const extension = path.posix.extname(normalizedPath)
  const segments = normalizedPath.split("/")

  return (
    SECRET_BASENAMES.has(basename) ||
    SECRET_EXTENSIONS.has(extension) ||
    segments.some((segment) => SECRET_SEGMENTS.has(segment))
  )
}

const isDestructiveCommand = (command: string): boolean =>
  DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command))

const isRiskyCommand = (command: string): boolean =>
  COMMAND_INSTALL_PATTERN.test(command) || COMMAND_NETWORK_PATTERN.test(command)

const isSafeCheckCommand = (command: string): boolean =>
  SAFE_CHECK_COMMAND_PATTERN.test(command)

const evaluateReadOnlyPath = (
  input: unknown,
  workspaceRoot: string
): AgentPermissionDecision | undefined => {
  const requestedPath = getInputString(input, "path")

  if (!requestedPath) {
    return undefined
  }

  if (!isInsideWorkspace(requestedPath, workspaceRoot)) {
    return buildDecision({
      action: "deny",
      reason: "The requested path is outside the active workspace.",
      risk: "high",
      ruleId: "outside-workspace"
    })
  }

  if (isSecretPath(requestedPath)) {
    return buildDecision({
      action: "deny",
      reason: "The requested path looks like a secret or credential file.",
      risk: "high",
      ruleId: "secret-path"
    })
  }

  return undefined
}

const evaluateCommandPermission = (
  input: unknown,
  name: AgentToolName
): AgentPermissionDecision => {
  const command = getInputString(input, "command")?.trim() ?? ""
  const rawOutput = getInputBoolean(input, "rawOutput")
  const timeoutMs =
    getInputNumber(input, "timeoutMs") ?? SAFE_COMMAND_TIMEOUT_MS

  if (isDestructiveCommand(command)) {
    return buildDecision({
      action: "deny",
      reason: "The command matches a destructive command pattern.",
      risk: "high",
      ruleId: "destructive-command"
    })
  }

  if (rawOutput) {
    return buildDecision({
      action: "ask",
      reason: "Raw command output can expose sensitive local data.",
      risk: "medium",
      ruleId: "raw-output-requires-approval"
    })
  }

  if (isRiskyCommand(command)) {
    return buildDecision({
      action: "ask",
      reason: "Install and network commands require explicit approval.",
      risk: "high",
      ruleId: "risky-command"
    })
  }

  if (timeoutMs > SAFE_COMMAND_TIMEOUT_MS) {
    return buildDecision({
      action: "ask",
      reason: "Long-running commands require explicit approval.",
      risk: "medium",
      ruleId: "long-command"
    })
  }

  if (name === "runCheck" && isSafeCheckCommand(command)) {
    return buildDecision({
      action: "allow",
      reason: "The command is a bounded project check.",
      risk: "low",
      ruleId: "safe-check-command"
    })
  }

  return buildDecision({
    action: "ask",
    reason: "Generic local commands require explicit approval.",
    risk: "medium",
    ruleId: "command-requires-approval"
  })
}

const evaluateCommandCwd = (
  input: unknown,
  workspaceRoot: string
): AgentPermissionDecision | undefined => {
  const cwd = getInputString(input, "cwd") ?? ""

  if (isInsideWorkspace(cwd, workspaceRoot)) {
    return undefined
  }

  return buildDecision({
    action: "deny",
    reason: "The requested command cwd is outside the active workspace.",
    risk: "high",
    ruleId: "outside-workspace-cwd"
  })
}

export const evaluateAgentToolPermission = ({
  input,
  name,
  workspaceRoot
}: EvaluateAgentToolPermissionOptions): AgentPermissionDecision => {
  if (name === "readFile") {
    const pathDecision = evaluateReadOnlyPath(input, workspaceRoot)

    if (pathDecision) {
      return pathDecision
    }
  }

  if (name === "applyPatch") {
    return buildDecision({
      action: "ask",
      reason: "Patch application writes files and requires approval.",
      risk: "medium",
      ruleId: "write-requires-approval"
    })
  }

  if (name === "rtkCommand" || name === "runCheck") {
    const cwdDecision = evaluateCommandCwd(input, workspaceRoot)

    if (cwdDecision) {
      return cwdDecision
    }

    return evaluateCommandPermission(input, name)
  }

  if (READONLY_AGENT_TOOLS.has(name)) {
    return buildDecision({
      action: "allow",
      reason: "The tool only reads project context.",
      risk: "low",
      ruleId: "readonly-project-tool"
    })
  }

  return buildDecision({
    action: "ask",
    reason: "Unknown or advanced agent tools require approval.",
    risk: "medium",
    ruleId: "unknown-tool"
  })
}
