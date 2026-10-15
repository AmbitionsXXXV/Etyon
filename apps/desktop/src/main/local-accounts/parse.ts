import type { LocalAccountUsageWindow } from "@etyon/rpc"

/**
 * Pure readers for the logins and allowances of the user's own coding agents,
 * following magpie's practice (gh_projects/magpie internal/provider): Claude
 * Code is asked through its own CLI, Codex is read from its auth.json. No
 * electron imports, so this stays node-testable.
 */

const SESSION_SPAN_SECONDS = 5 * 60 * 60
const WEEK_SPAN_SECONDS = 7 * 24 * 60 * 60

export interface ClaudeAuthStatus {
  email: string | null
  loggedIn: boolean
  organization: string | null
  plan: string | null
}

const asTrimmedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null

const parseJsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * `claude auth status --json`. Signed out, the CLI exits 1 but still prints
 * the JSON, so stdout is read either way; null when it gave no answer.
 */
export const parseClaudeAuthStatus = (
  stdout: string
): ClaudeAuthStatus | null => {
  const status = parseJsonObject(stdout.trim())

  if (!status || typeof status.loggedIn !== "boolean") {
    return null
  }

  return {
    email: asTrimmedString(status.email),
    loggedIn: status.loggedIn,
    organization: asTrimmedString(status.orgName),
    plan: asTrimmedString(status.subscriptionType)
  }
}

// "Current session: 13% used · resets Oct 1 at 3:30pm (Asia/Shanghai)",
// "Current week (all models): 4% used · resets Oct 3 at 2pm (Asia/Shanghai)",
// "Current week (Fable): 0% used"
const CLAUDE_USAGE_LINE_PATTERN =
  /^Current (session|week(?: \(([^)]+)\))?):\s*([0-9.]+)% used(?:\s*·\s*resets (.+))?$/u
// An account problem wins over partial readings (magpie claudeUsageDenied).
const CLAUDE_USAGE_DENIED_PATTERN =
  /\b(?:401|403)\b|not (?:logged|signed) in|signed out|sign-in (?:has )?expired|unauthorized|forbidden|authentication (?:failed|required)|invalid (?:access )?token/iu
// Terminal escape sequences, matched by their ESC (0x1b) introducer.
// oxlint-disable-next-line no-control-regex -- stripping ANSI codes needs ESC
const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*[A-Za-z]/gu

export interface ClaudeUsageReading {
  error: string | null
  windows: LocalAccountUsageWindow[]
}

const readClaudeResultText = (stdout: string): string | null => {
  const single = parseJsonObject(stdout.trim())

  if (single) {
    return asTrimmedString(single.result)
  }

  try {
    const all: unknown = JSON.parse(stdout)

    if (!Array.isArray(all)) {
      return null
    }

    for (const entry of all.toReversed()) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>).type === "result"
      ) {
        return asTrimmedString((entry as Record<string, unknown>).result)
      }
    }
  } catch {
    return null
  }

  return null
}

/** `claude -p /usage --output-format json`: the session and weekly windows. */
export const parseClaudeUsage = (stdout: string): ClaudeUsageReading => {
  const text = readClaudeResultText(stdout)

  if (text === null) {
    return { error: "Claude Code gave no /usage answer.", windows: [] }
  }

  const lines = text.replaceAll(ANSI_ESCAPE_PATTERN, "").split("\n")
  const denied = lines.find((line) => CLAUDE_USAGE_DENIED_PATTERN.test(line))

  if (denied) {
    return { error: denied.trim(), windows: [] }
  }

  const windows: LocalAccountUsageWindow[] = []

  for (const line of lines) {
    const match = CLAUDE_USAGE_LINE_PATTERN.exec(line.trim())

    if (!match) {
      continue
    }

    const [, kind, rawScope, used, resets] = match
    const isSession = kind === "session"
    const scope = rawScope?.trim()
    const usedPercent = Number.parseFloat(used ?? "")

    if (!Number.isFinite(usedPercent)) {
      continue
    }

    windows.push({
      resetsAt: null,
      resetsText: resets?.trim() || null,
      scope:
        isSession || !scope || scope.toLowerCase() === "all models"
          ? null
          : scope,
      spanSeconds: isSession ? SESSION_SPAN_SECONDS : WEEK_SPAN_SECONDS,
      usedPercent
    })
  }

  return windows.length > 0
    ? { error: null, windows }
    : { error: "Claude Code's /usage named no allowance.", windows: [] }
}

/** The payload of a JWT, unverified: only read for claims Codex wrote itself. */
export const decodeJwtPayload = (
  token: string
): Record<string, unknown> | null => {
  const [, payload] = token.split(".")

  if (!payload) {
    return null
  }

  try {
    return parseJsonObject(Buffer.from(payload, "base64url").toString("utf-8"))
  } catch {
    return null
  }
}

const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth"

export interface CodexLogin {
  accessToken: string
  accessTokenExpiresAt: number | null
  accountId: string | null
  email: string | null
  plan: string | null
  subscriptionUntil: string | null
}

/**
 * Codex's auth.json. An API-key login is not a subscription, so it reads as
 * none (magpie codexAccount rejects auth_mode "apikey" too).
 */
export const parseCodexAuth = (text: string): CodexLogin | null => {
  const auth = parseJsonObject(text)
  const tokens = auth?.tokens

  if (
    !auth ||
    auth.auth_mode === "apikey" ||
    typeof tokens !== "object" ||
    tokens === null
  ) {
    return null
  }

  const { access_token, account_id, id_token } = tokens as Record<
    string,
    unknown
  >

  if (typeof access_token !== "string" || !access_token) {
    return null
  }

  const idClaims =
    typeof id_token === "string" ? decodeJwtPayload(id_token) : null
  const openAiClaims = idClaims?.[OPENAI_AUTH_CLAIM]
  const openAi =
    typeof openAiClaims === "object" && openAiClaims !== null
      ? (openAiClaims as Record<string, unknown>)
      : {}
  const accessExp = decodeJwtPayload(access_token)?.exp

  return {
    accessToken: access_token,
    accessTokenExpiresAt:
      typeof accessExp === "number" ? accessExp * 1000 : null,
    accountId:
      asTrimmedString(account_id) ?? asTrimmedString(openAi.chatgpt_account_id),
    email: asTrimmedString(idClaims?.email),
    plan: asTrimmedString(openAi.chatgpt_plan_type),
    subscriptionUntil: asTrimmedString(openAi.chatgpt_subscription_active_until)
  }
}

export interface CodexUsageReading {
  credits: string | null
  plan: string | null
  windows: LocalAccountUsageWindow[]
}

const readCodexWindow = (
  value: unknown,
  nowMs: number
): LocalAccountUsageWindow | null => {
  if (typeof value !== "object" || value === null) {
    return null
  }

  const window = value as Record<string, unknown>
  const usedPercent = window.used_percent

  if (typeof usedPercent !== "number") {
    return null
  }

  let resetsAt: string | null = null

  if (typeof window.reset_at === "number") {
    resetsAt = new Date(window.reset_at * 1000).toISOString()
  } else if (typeof window.reset_after_seconds === "number") {
    resetsAt = new Date(nowMs + window.reset_after_seconds * 1000).toISOString()
  }

  return {
    resetsAt,
    resetsText: null,
    scope: null,
    spanSeconds:
      typeof window.limit_window_seconds === "number" &&
      window.limit_window_seconds > 0
        ? Math.round(window.limit_window_seconds)
        : null,
    usedPercent
  }
}

/** chatgpt.com/backend-api/wham/usage: plan, the two rate-limit windows, credits. */
export const parseCodexUsage = (
  body: unknown,
  nowMs: number
): CodexUsageReading => {
  const usage =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {}
  const rateLimit =
    typeof usage.rate_limit === "object" && usage.rate_limit !== null
      ? (usage.rate_limit as Record<string, unknown>)
      : {}
  const windows = [rateLimit.primary_window, rateLimit.secondary_window]
    .map((window) => readCodexWindow(window, nowMs))
    .filter((window): window is LocalAccountUsageWindow => window !== null)
  const credits =
    typeof usage.credits === "object" && usage.credits !== null
      ? (usage.credits as Record<string, unknown>)
      : null
  const balance = Number.parseFloat(String(credits?.balance ?? ""))

  return {
    credits:
      credits?.has_credits === true &&
      credits.unlimited !== true &&
      Number.isFinite(balance) &&
      balance > 0
        ? String(Math.round(balance * 100) / 100)
        : null,
    plan: asTrimmedString(usage.plan_type),
    windows
  }
}
