import path from "node:path"

import { getAgentToolManifest } from "@/main/agents/tool-manifest"
import type { AgentToolName } from "@/main/agents/types"

export type AgentPermissionAction = "allow" | "ask" | "deny"

export type AgentPermissionRisk = "high" | "low" | "medium"

export interface AgentPermissionDecision {
  action: AgentPermissionAction
  reason: string
  risk: AgentPermissionRisk
  ruleId: string
}

export interface AgentCommandApprovalAllowlistRule {
  command: string
  createdAt?: string
  cwd?: string
  projectPath: string
  toolName: string
}

export interface EvaluateAgentToolPermissionOptions {
  commandApprovalAllowlist?: readonly AgentCommandApprovalAllowlistRule[]
  input: unknown
  name: AgentToolName
  workspaceRoot: string
}

const COMMAND_INSTALL_PATTERN =
  /\b(?:bun|deno|npm|pnpm|vp|yarn)\s+(?:add|install|i)\b/u
const COMMAND_NETWORK_PATTERN = /\b(?:curl|wget|fetch|http|https)\b/u
const COMMAND_SEPARATOR_PATTERN = /(?:&&|\|\||[;|\n])/u
const COMMAND_UNSUPPORTED_PACKAGE_MANAGER_PATTERN =
  /(?:^|[;&|]\s*)(?:rtk\s+)?(?:bun|deno|npm|pnpm|yarn)\b/u
const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)\b/u,
  /\b(?:rtk\s+)?git\s+checkout\s+--\b/u,
  /\b(?:rtk\s+)?git\s+reset\s+--hard\b/u,
  /\bsudo\b/u
] as const
const SAFE_CHECK_COMMAND_PATTERNS = [
  /^(?:rtk\s+)?vp\s+check$/u,
  /^(?:rtk\s+)?vp\s+test\s+run(?:\s+[\w@/:#.,=-]+)*$/u,
  /^(?:rtk\s+)?vp\s+run\s+[\w@/:#.-]+(?:\s+run(?:\s+[\w@/:#.,=-]+)*)?$/u
] as const
const SAFE_READONLY_GIT_COMMAND_PATTERN =
  /^(?:rtk\s+)?git\s+(?:diff|log|show|status)(?:\s+[A-Za-z0-9_@%/:#.,=+\-~^*[\]{}]+)*$/u
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

const parseShellCommandArgs = (command: string): string[] | null => {
  const args: string[] = []
  let current = ""
  let escaping = false
  let quote: '"' | "'" | null = null

  for (const char of command) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === "\\") {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
        continue
      }

      current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/u.test(char)) {
      if (current.length > 0) {
        args.push(current)
        current = ""
      }

      continue
    }

    current += char
  }

  if (quote) {
    return null
  }

  if (escaping) {
    current += "\\"
  }

  if (current.length > 0) {
    args.push(current)
  }

  return args
}

const trimRtkCommandWrapper = (args: readonly string[]): readonly string[] =>
  args[0] === "rtk" ? args.slice(1) : args

const getCommandApprovalIntentSignature = (command: string): string | null => {
  if (COMMAND_SEPARATOR_PATTERN.test(command)) {
    return null
  }

  const args = parseShellCommandArgs(command.trim())

  if (!args || args.length === 0) {
    return null
  }

  const normalizedArgs = trimRtkCommandWrapper(args)
  const [commandName] = normalizedArgs

  if (!commandName) {
    return null
  }

  const signatureArgs = [commandName]
  let index = 1

  while (
    index < normalizedArgs.length &&
    normalizedArgs[index]?.startsWith("-") &&
    normalizedArgs[index] !== "--"
  ) {
    signatureArgs.push(normalizedArgs[index] ?? "")
    index += 1
  }

  if (normalizedArgs[index] === "--") {
    signatureArgs.push("--")
    index += 1
  }

  if (normalizedArgs[index]) {
    signatureArgs.push(normalizedArgs[index])
  }

  return signatureArgs.join("\u0000")
}

const hasSameCommandApprovalIntent = ({
  command,
  ruleCommand
}: {
  command: string
  ruleCommand: string
}): boolean => {
  const commandSignature = getCommandApprovalIntentSignature(command)
  const ruleCommandSignature = getCommandApprovalIntentSignature(ruleCommand)

  return (
    commandSignature !== null &&
    ruleCommandSignature !== null &&
    commandSignature === ruleCommandSignature
  )
}

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

const getCommandTimeoutMs = (input: unknown): number => {
  const timeoutMs = getInputNumber(input, "timeoutMs")

  if (timeoutMs !== undefined) {
    return timeoutMs
  }

  const timeoutSeconds = getInputNumber(input, "timeout")

  return timeoutSeconds === undefined
    ? SAFE_COMMAND_TIMEOUT_MS
    : timeoutSeconds * 1000
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

export const isSecretAgentPath = (requestedPath: string): boolean => {
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
  SAFE_CHECK_COMMAND_PATTERNS.some((pattern) => pattern.test(command))

const isSafeReadonlyGitCommand = (command: string): boolean =>
  SAFE_READONLY_GIT_COMMAND_PATTERN.test(command)

const isUnsupportedPackageManagerCommand = (command: string): boolean =>
  COMMAND_UNSUPPORTED_PACKAGE_MANAGER_PATTERN.test(command)

const COMMAND_APPROVAL_INTENT_TOOL_NAMES = new Set([
  "bash",
  "rtkCommand",
  "runCheck"
])

const COMMAND_APPROVAL_INTENT_MATCHERS = [
  isSafeReadonlyGitCommand,
  isSafeCheckCommand
] as const

const isCommandApprovalIntentToolName = (toolName: string): boolean =>
  COMMAND_APPROVAL_INTENT_TOOL_NAMES.has(toolName)

export const isAgentCommandApprovalToolCovered = ({
  ruleToolName,
  toolName
}: {
  ruleToolName: string
  toolName: string
}): boolean =>
  ruleToolName === toolName ||
  (isCommandApprovalIntentToolName(ruleToolName) &&
    isCommandApprovalIntentToolName(toolName))

export const isAgentCommandApprovalRuleCovered = ({
  command,
  ruleCommand,
  toolName
}: {
  command: string
  ruleCommand: string
  toolName: string
}): boolean => {
  const normalizedCommand = command.trim()
  const normalizedRuleCommand = ruleCommand.trim()

  if (normalizedCommand === normalizedRuleCommand) {
    return true
  }

  if (!isCommandApprovalIntentToolName(toolName)) {
    return false
  }

  return (
    COMMAND_APPROVAL_INTENT_MATCHERS.some(
      (matches) => matches(normalizedCommand) && matches(normalizedRuleCommand)
    ) ||
    hasSameCommandApprovalIntent({
      command: normalizedCommand,
      ruleCommand: normalizedRuleCommand
    })
  )
}

const resolveCommandCwd = (cwd: string | undefined, workspaceRoot: string) =>
  path.resolve(path.resolve(workspaceRoot), cwd?.trim() ?? "")

const commandMatchesApprovalAllowlist = ({
  allowlist,
  command,
  cwd,
  name,
  workspaceRoot
}: {
  allowlist?: readonly AgentCommandApprovalAllowlistRule[]
  command: string
  cwd?: string
  name: AgentToolName
  workspaceRoot: string
}): boolean => {
  if (!allowlist || allowlist.length === 0) {
    return false
  }

  const normalizedCommand = command.trim()
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  const normalizedCwd = resolveCommandCwd(cwd, normalizedWorkspaceRoot)

  return allowlist.some((rule) => {
    const ruleWorkspaceRoot = path.resolve(rule.projectPath)

    return (
      isAgentCommandApprovalRuleCovered({
        command: normalizedCommand,
        ruleCommand: rule.command,
        toolName: name
      }) &&
      isAgentCommandApprovalToolCovered({
        ruleToolName: rule.toolName,
        toolName: name
      }) &&
      ruleWorkspaceRoot === normalizedWorkspaceRoot &&
      resolveCommandCwd(rule.cwd, ruleWorkspaceRoot) === normalizedCwd
    )
  })
}

const hasToolCapability = (
  name: AgentToolName,
  capability: ReturnType<typeof getAgentToolManifest>["capabilities"][number]
): boolean => getAgentToolManifest(name).capabilities.includes(capability)

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

  if (isSecretAgentPath(requestedPath)) {
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
  allowlist: readonly AgentCommandApprovalAllowlistRule[] | undefined,
  input: unknown,
  name: AgentToolName,
  workspaceRoot: string
): AgentPermissionDecision => {
  const command = getInputString(input, "command")?.trim() ?? ""
  const cwd = getInputString(input, "cwd")
  const rawOutput = getInputBoolean(input, "rawOutput")
  const timeoutMs = getCommandTimeoutMs(input)

  if (isDestructiveCommand(command)) {
    return buildDecision({
      action: "deny",
      reason: "The command matches a destructive command pattern.",
      risk: "high",
      ruleId: "destructive-command"
    })
  }

  if (isUnsupportedPackageManagerCommand(command)) {
    return buildDecision({
      action: "deny",
      reason: "Use vp for package manager commands.",
      risk: "high",
      ruleId: "unsupported-package-manager"
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

  if (getInputBoolean(input, "background")) {
    return buildDecision({
      action: "ask",
      reason: "Background commands require explicit approval.",
      risk: "medium",
      ruleId: "background-command"
    })
  }

  if (
    commandMatchesApprovalAllowlist({
      allowlist,
      command,
      cwd,
      name,
      workspaceRoot
    })
  ) {
    return buildDecision({
      action: "allow",
      reason: "The command matches a remembered approval for this workspace.",
      risk: "low",
      ruleId: "command-approval-allowlist"
    })
  }

  if (
    (name === "bash" || name === "rtkCommand" || name === "runCheck") &&
    isSafeCheckCommand(command)
  ) {
    return buildDecision({
      action: "allow",
      reason: "The command is a bounded project check.",
      risk: "low",
      ruleId: "safe-check-command"
    })
  }

  if (
    (name === "bash" || name === "rtkCommand" || name === "runCheck") &&
    isSafeReadonlyGitCommand(command)
  ) {
    return buildDecision({
      action: "allow",
      reason: "The command is a read-only Git inspection.",
      risk: "low",
      ruleId: "safe-readonly-git-command"
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
  commandApprovalAllowlist,
  input,
  name,
  workspaceRoot
}: EvaluateAgentToolPermissionOptions): AgentPermissionDecision => {
  const manifest = getAgentToolManifest(name)

  if (
    hasToolCapability(name, "read-fs") ||
    hasToolCapability(name, "write-fs")
  ) {
    const pathDecision = evaluateReadOnlyPath(input, workspaceRoot)

    if (pathDecision) {
      return pathDecision
    }
  }

  if (hasToolCapability(name, "write-fs")) {
    return buildDecision({
      action: "ask",
      reason: "File edits write project files and require approval.",
      risk: "medium",
      ruleId: "write-requires-approval"
    })
  }

  if (hasToolCapability(name, "network")) {
    return buildDecision({
      action: "ask",
      reason:
        "Network tools can send queries outside the workspace and require approval.",
      risk: "high",
      ruleId: "network-requires-approval"
    })
  }

  if (hasToolCapability(name, "ui")) {
    return buildDecision({
      action: "ask",
      reason: "User access requests require explicit approval.",
      risk: "medium",
      ruleId: "ui-requires-approval"
    })
  }

  if (hasToolCapability(name, "shell")) {
    const cwdDecision = evaluateCommandCwd(input, workspaceRoot)

    if (cwdDecision) {
      return cwdDecision
    }

    return evaluateCommandPermission(
      commandApprovalAllowlist,
      input,
      name,
      workspaceRoot
    )
  }

  if (name === "processOutput" || name === "stopProcess") {
    return buildDecision({
      action: "allow",
      reason: "The tool only accesses Etyon-managed background processes.",
      risk: "low",
      ruleId: "managed-process-tool"
    })
  }

  if (manifest.riskLevel === "safe") {
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
