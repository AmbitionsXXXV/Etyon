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
 * allowlist on every call, so a matching pattern can never auto-run a wipe.
 */

// Shell operators that only carry meaning when unquoted. A commit message may
// legitimately contain these inside quotes, so they are checked during the
// quote-aware scan rather than as a naive substring.
const UNQUOTED_CONTROL_CHARS: ReadonlySet<string> = new Set([
  "\n",
  ";",
  "&",
  "|",
  "<",
  ">"
])

// Leading `VAR=value` environment assignments precede the real binary.
const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/u

const isEnvAssignment = (token: string): boolean =>
  ENV_ASSIGNMENT_PATTERN.test(token)

/**
 * Splits a command into tokens with minimal quote/escape awareness (enough to
 * keep a quoted argument whole and to ignore operators inside quotes), returning
 * null when an unquoted shell operator or an unterminated quote makes the
 * command unsafe to generalize. Not a full shell parser.
 */
const tokenizeCommand = (command: string): string[] | null => {
  const tokens: string[] = []
  let current = ""
  let hasToken = false
  let quote: '"' | "'" | null = null

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string

    if (quote !== null) {
      // Single quotes are literal in POSIX; only double quotes process escapes.
      if (char === "\\" && quote === '"' && index + 1 < command.length) {
        current += command[index + 1]
        index += 1
        continue
      }

      if (char === quote) {
        quote = null
        continue
      }

      current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      hasToken = true
      continue
    }

    if (char === "\\" && index + 1 < command.length) {
      current += command[index + 1]
      hasToken = true
      index += 1
      continue
    }

    if (UNQUOTED_CONTROL_CHARS.has(char)) {
      return null
    }

    if (char === " " || char === "\t") {
      if (hasToken) {
        tokens.push(current)
        current = ""
        hasToken = false
      }
      continue
    }

    current += char
    hasToken = true
  }

  if (quote !== null) {
    return null
  }

  if (hasToken) {
    tokens.push(current)
  }

  return tokens
}

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

  const tokens = tokenizeCommand(trimmed)

  if (tokens === null || tokens.length === 0) {
    return null
  }

  let index = 0

  while (index < tokens.length && isEnvAssignment(tokens[index] as string)) {
    index += 1
  }

  const binary = tokens[index]

  if (binary === undefined) {
    return null
  }

  const second = tokens[index + 1]

  // A flag (or absent) second token collapses the pattern to the binary alone.
  if (second !== undefined && !second.startsWith("-")) {
    return `${binary} ${second}`
  }

  return binary
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
