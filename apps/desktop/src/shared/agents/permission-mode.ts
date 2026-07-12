/**
 * Agent permission modes — an axis orthogonal to chat/agent/plan agent-mode.
 *
 * The mode decides whether a tool call is gated behind user approval, expressed
 * as pure predicates the tool factories evaluate at `needsApproval` time. This
 * replaces the deleted central permission-engine: there is no risk-tiering rule
 * evaluator, only three modes and a small destructive-command classifier.
 *
 * - default:     file edits and every shell command are approval-gated
 *                (a remembered command still auto-runs; see the shell predicate)
 * - acceptEdits: in-project file edits/writes auto-run; shell stays gated
 * - bypass:      nothing is gated (yolo)
 *
 * Destructive shell commands (rm -rf, git reset --hard, sudo, …) are gated in
 * every mode except bypass, and cannot be silenced by the remembered-command
 * allowlist — so an accidental "remember" never disarms a wipe.
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

// Destructive command signatures other than `rm` (handled separately). Each is
// anchored to a command token (start of string, or after a shell separator or
// `sudo`) so a substring inside a path or string literal does not trip the
// classifier. Intentionally high-signal, not exhaustive: the goal is to force
// approval on the obviously-irreversible, not to sandbox.
const COMMAND_BOUNDARY = String.raw`(?:^|[\n;&|]|\bsudo\s+)\s*`
const DESTRUCTIVE_COMMAND_PATTERNS: readonly RegExp[] = [
  // git history/worktree wipes.
  new RegExp(`${COMMAND_BOUNDARY}git\\s+reset\\s+(?:.*\\s)?--hard\\b`, "u"),
  new RegExp(`${COMMAND_BOUNDARY}git\\s+clean\\s+(?:.*\\s)?-\\S*f`, "u"),
  new RegExp(
    `${COMMAND_BOUNDARY}git\\s+checkout\\s+(?:.*\\s)?--(?:\\s|$)`,
    "u"
  ),
  new RegExp(
    `${COMMAND_BOUNDARY}git\\s+push\\s+(?:.*\\s)?(?:--force\\b|-\\S*f)`,
    "u"
  ),
  // Privilege escalation and disk/system-level operations.
  new RegExp(`${COMMAND_BOUNDARY}sudo\\b`, "u"),
  new RegExp(`${COMMAND_BOUNDARY}(?:shutdown|reboot|halt|poweroff)\\b`, "u"),
  new RegExp(`${COMMAND_BOUNDARY}mkfs\\b`, "u"),
  new RegExp(`${COMMAND_BOUNDARY}dd\\s+(?:.*\\s)?of=`, "u"),
  // Fork bomb.
  /:\s*\(\s*\)\s*\{/u
]

// `rm` is dangerous when its flags request BOTH recursive and force. Flags may
// be combined (`-rf`, `-fr`) or split (`-r -f`), long (`--recursive --force`),
// and appear after a boundary. Parsed rather than regex'd for legibility.
const RM_TOKEN_PATTERN = /(?:^|[\n;&|]|\bsudo\s+)\s*rm\b([^\n;&|]*)/u

const rmRequestsRecursiveForce = (argsSegment: string): boolean => {
  let recursive = false
  let force = false

  for (const token of argsSegment.split(/\s+/u).filter(Boolean)) {
    if (token === "--recursive") {
      recursive = true
    } else if (token === "--force") {
      force = true
    } else if (/^-[a-z]*$/iu.test(token)) {
      if (token.includes("r") || token.includes("R")) {
        recursive = true
      }

      if (token.includes("f")) {
        force = true
      }
    }
  }

  return recursive && force
}

const isDangerousRmCommand = (command: string): boolean => {
  const match = command.match(RM_TOKEN_PATTERN)

  return match ? rmRequestsRecursiveForce(match[1] ?? "") : false
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

  return (
    isDangerousRmCommand(normalized) ||
    DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized))
  )
}

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
