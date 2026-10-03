/**
 * Derives a generalized approval pattern from a full shell command, and matches
 * a remembered rule against an incoming command. Shared (dependency-free) so the
 * renderer remember flow, the main-process child-approval remember flow, and the
 * bash-tool matching side all agree on one derivation.
 *
 * A pattern is `<binary>` or `<binary> <subcommand>` (e.g. `git commit`), so a
 * remembered `git commit -m "a"` also covers the next `git commit -m "b"`. When
 * a command cannot be safely generalized (compound/piped/redirected, uses
 * command substitution, or is empty) derivation returns null and the caller
 * falls back to exact matching. This never loosens the destructive-command gate:
 * `needsShellApproval` re-checks `isDangerousShellCommand` before the remembered
 * allowlist on every call. The classifier is a backstop, not a shell sandbox.
 */

import { tokenizeShellCommands } from "@/shared/agents/shell-command"

// Leading `VAR=value` environment assignments precede the real binary.
const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/u

const isEnvAssignment = (token: string): boolean =>
  ENV_ASSIGNMENT_PATTERN.test(token)

// These programs interpret arguments as another command or executable code.
// Their first positional argument is not an approval-safe subcommand.
const COMMAND_WRAPPERS = new Set([
  "bash",
  "bun",
  "command",
  "deno",
  "env",
  "exec",
  "nice",
  "node",
  "nohup",
  "perl",
  "python",
  "python3",
  "rtk",
  "ruby",
  "sh",
  "sudo",
  "timeout",
  "zsh"
])

/**
 * Derives the memorable approval pattern from a full command, or null when the
 * command cannot be safely generalized (caller then remembers/matches exactly).
 */
export const deriveCommandApprovalPattern = (
  command: string
): string | null => {
  const trimmed = command.trim()

  if (trimmed.length === 0) {
    return null
  }

  // Command substitution runs arbitrary code the destructive classifier cannot
  // see through, so never generalize a command that contains it — even inside
  // quotes, where double-quoted `$(...)` still executes.
  if (trimmed.includes("$(") || trimmed.includes("`")) {
    return null
  }

  const parsed = tokenizeShellCommands(trimmed)

  if (parsed === null || parsed.hasOperators || parsed.commands.length !== 1) {
    return null
  }

  const [binary, second] = parsed.commands[0] ?? []

  if (binary === undefined || isEnvAssignment(binary)) {
    return null
  }

  if (second === undefined) {
    return binary
  }

  const binaryName = binary.split("/").at(-1) ?? binary
  if (second.startsWith("-") || COMMAND_WRAPPERS.has(binaryName)) {
    return null
  }

  return `${binary} ${second}`
}

/**
 * Whether a stored allowlist rule (a legacy full command, or a derived pattern)
 * covers an incoming command: trimmed exact equality keeps legacy rules working,
 * and pattern equality covers same-CLI/subcommand variants.
 */
export const commandMatchesApprovalRule = ({
  command,
  ruleCommand
}: {
  command: string
  ruleCommand: string
}): boolean => {
  const trimmedCommand = command.trim()
  const trimmedRule = ruleCommand.trim()

  if (trimmedRule.length === 0) {
    return false
  }

  if (trimmedCommand === trimmedRule) {
    return true
  }

  return deriveCommandApprovalPattern(trimmedCommand) === trimmedRule
}
