import { tokenizeShellCommands } from "@/shared/agents/shell-command"

/**
 * Agent permission modes — an axis orthogonal to chat/agent/plan agent-mode.
 *
 * The mode decides whether a tool call is gated behind user approval, expressed
 * as pure predicates the `toolApproval` policies evaluate per call. This
 * replaces the deleted central permission-engine: there is no risk-tiering rule
 * evaluator, only three modes and a small destructive-command classifier.
 *
 * - default:     file edits and every shell command are approval-gated
 *                (a remembered command still auto-runs; see the shell predicate)
 * - acceptEdits: in-project file edits/writes auto-run; shell stays gated
 * - bypass:      nothing is gated (yolo)
 *
 * Destructive shell commands (rm -rf, git reset --hard, sudo, …) are gated in
 * every mode except bypass. A remembered-command rule cannot silence these
 * known signatures.
 * This is a backstop, not a complete shell sandbox.
 */

export const PERMISSION_MODES = ["default", "acceptEdits", "bypass"] as const

export type AgentPermissionMode = (typeof PERMISSION_MODES)[number]

export const DEFAULT_PERMISSION_MODE: AgentPermissionMode = "default"

export const isAgentPermissionMode = (
  value: unknown
): value is AgentPermissionMode =>
  value === "default" || value === "acceptEdits" || value === "bypass"

/** Composer cycle order: default → acceptEdits → bypass → default. */
export const getNextPermissionMode = (
  mode: AgentPermissionMode
): AgentPermissionMode => {
  const currentIndex = PERMISSION_MODES.indexOf(mode)
  const nextIndex = (currentIndex + 1) % PERMISSION_MODES.length

  return PERMISSION_MODES[nextIndex] ?? DEFAULT_PERMISSION_MODE
}

const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/u
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--super-prefix"
])
const SHORT_FLAGS = /^-[a-z]+$/iu
const FORK_BOMB_PATTERN = /:\s*\(\s*\)\s*\{/u

const getGitArguments = (tokens: string[]): string[] => {
  let index = 1
  while (tokens[index]?.startsWith("-")) {
    const token = tokens[index] as string
    index += GIT_VALUE_OPTIONS.has(token) ? 2 : 1
  }
  return tokens.slice(index)
}

const hasShortFlag = (tokens: string[], flag: string): boolean =>
  tokens.some((token) => SHORT_FLAGS.test(token) && token.includes(flag))

const beforeEndOfOptions = (tokens: string[]): string[] => {
  const end = tokens.indexOf("--")
  return end === -1 ? tokens : tokens.slice(0, end)
}

const isDangerousGitCommand = (command: string[]): boolean => {
  const [subcommand, ...gitArgs] = getGitArguments(command)
  const gitOptions = beforeEndOfOptions(gitArgs)
  switch (subcommand) {
    case "reset": {
      return gitOptions.includes("--hard")
    }
    case "clean": {
      return gitOptions.includes("--force") || hasShortFlag(gitOptions, "f")
    }
    case "checkout": {
      return gitArgs.includes("--")
    }
    case "push": {
      return (
        gitOptions.some(
          (arg) =>
            arg === "--force" ||
            arg.startsWith("--force-with-lease") ||
            arg === "--force-if-includes"
        ) || hasShortFlag(gitOptions, "f")
      )
    }
    default: {
      return false
    }
  }
}

const isDangerousSimpleCommand = (tokens: string[]): boolean => {
  const executableIndex = tokens.findIndex(
    (token) => !ENV_ASSIGNMENT_PATTERN.test(token)
  )
  const command = tokens.slice(
    executableIndex === -1 ? tokens.length : executableIndex
  )
  const binary = command[0]?.split("/").at(-1)
  const args = command.slice(1)
  const optionArgs = beforeEndOfOptions(args)
  if (binary === "rm") {
    const recursive =
      optionArgs.includes("--recursive") ||
      hasShortFlag(optionArgs, "r") ||
      hasShortFlag(optionArgs, "R")
    const force =
      optionArgs.includes("--force") || hasShortFlag(optionArgs, "f")
    return recursive && force
  }
  if (binary === "git") {
    return isDangerousGitCommand(command)
  }
  return (
    binary === "sudo" ||
    ["shutdown", "reboot", "halt", "poweroff", "mkfs"].includes(binary ?? "") ||
    binary?.startsWith("mkfs.") === true ||
    (binary === "dd" && args.some((arg) => arg.startsWith("of=")))
  )
}

/**
 * True when a shell command matches a known irreversible/destructive signature.
 * Pure and importable by the renderer (drives hiding "approve and remember" for
 * commands the allowlist must never cover).
 */
export const isDangerousShellCommand = (command: string): boolean => {
  const normalized = command.trim()

  if (normalized.length === 0) {
    return false
  }

  const parsed = tokenizeShellCommands(normalized)
  // Dynamic shell syntax cannot be classified as a harmless remembered call.
  // This intentionally requires approval rather than pretending to evaluate it.
  return (
    parsed === null ||
    FORK_BOMB_PATTERN.test(normalized) ||
    parsed.commands.some(isDangerousSimpleCommand)
  )
}

/**
 * Whether a `browser` call needs approval. Follows the shell rule rather than
 * the file-edit rule: acceptEdits only auto-runs in-project edits, and the
 * embedded browser is neither in-project nor side-effect-free — it carries the
 * user's persistent logins, and every action ships page text or a screenshot to
 * the model provider. Only bypass skips the prompt.
 */
export const needsBrowserApproval = (mode: AgentPermissionMode): boolean =>
  mode !== "bypass"

/**
 * Whether an `edit`/`write` call needs approval. acceptEdits and bypass both
 * auto-run in-project edits; only default gates them. (The tools are already
 * sandboxed to the project root and refuse secret paths, so auto-running an
 * edit cannot escape the workspace.)
 */
export const needsFileEditApproval = (mode: AgentPermissionMode): boolean =>
  mode === "default"

/**
 * Workflow scripts execute model-authored JS in-process, which is strictly
 * more powerful than a shell command, so only bypass mode may auto-run them.
 * Unlike bash there is no remembered-command allowlist: scripts are one-off.
 */
export const needsWorkflowApproval = (mode: AgentPermissionMode): boolean =>
  mode !== "bypass"

/**
 * Whether a `bash` call needs approval. bypass never gates; destructive
 * commands always gate outside bypass and ignore the remembered allowlist;
 * otherwise a remembered exact command auto-runs and everything else is gated.
 * acceptEdits does NOT auto-run arbitrary shell — it only affects file edits.
 */
export const needsShellApproval = ({
  command,
  isRemembered,
  mode
}: {
  command: string
  isRemembered: boolean
  mode: AgentPermissionMode
}): boolean => {
  if (mode === "bypass") {
    return false
  }

  if (isDangerousShellCommand(command)) {
    return true
  }

  return !isRemembered
}
