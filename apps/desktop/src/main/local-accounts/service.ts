import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { access, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import type {
  LocalAccount,
  LocalAccountId,
  LocalAccountUsage
} from "@etyon/rpc"

import { getShellSpawnEnv } from "@/main/agents/minimal/spawn-env"
import { getSettings } from "@/main/settings"

import {
  parseClaudeAuthStatus,
  parseClaudeUsage,
  parseCodexAuth,
  parseCodexUsage
} from "./parse"

/**
 * Logins of the user's own coding agents, read in place (magpie's practice):
 * Claude Code through its own CLI — so Etyon never opens its Keychain item or
 * credentials file — and Codex from its auth.json. Tokens stay in the main
 * process; the renderer only sees plan, email, and allowance.
 */

const execFileAsync = promisify(execFile)

const CLAUDE_STATUS_TIMEOUT_MS = 5000
const CLAUDE_USAGE_TIMEOUT_MS = 30_000
const CODEX_USAGE_TIMEOUT_MS = 15_000
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"

// Variables that point Claude Code at another endpoint or token than its own
// sign-in; with them set it would describe that instead (magpie
// withoutClaudeWiring).
const CLAUDE_WIRING_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN"
] as const

// /usage runs with nothing of the user's setup loaded: no tools, MCP
// servers, settings, or saved session (magpie claudeUsageArgs).
const CLAUDE_USAGE_ARGS = [
  "-p",
  "/usage",
  "--output-format",
  "json",
  "--tools",
  "",
  "--strict-mcp-config",
  "--setting-sources",
  "",
  "--no-session-persistence"
]

const isDiscoveryOn = (): boolean => getSettings().localAccounts.discovery

const getClaudeConfigDir = (): string => {
  const configured = process.env.CLAUDE_CONFIG_DIR

  return configured && path.isAbsolute(configured)
    ? configured
    : path.join(os.homedir(), ".claude")
}

const getCodexHome = (): string => {
  const configured = process.env.CODEX_HOME

  return configured && path.isAbsolute(configured)
    ? configured
    : path.join(os.homedir(), ".codex")
}

const isExecutable = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// GUI launches get a bare PATH, so the installer locations Claude Code uses
// are checked besides PATH.
const findClaudeExecutable = async (): Promise<string | null> => {
  const binary = process.platform === "win32" ? "claude.exe" : "claude"
  const pathEntries = (getShellSpawnEnv().PATH ?? "").split(path.delimiter)
  const candidates = [
    path.join(os.homedir(), ".local", "bin", binary),
    path.join(getClaudeConfigDir(), "local", binary),
    ...pathEntries.filter(Boolean).map((entry) => path.join(entry, binary))
  ]

  for (const candidate of new Set(candidates)) {
    if (await isExecutable(candidate)) {
      return candidate
    }
  }

  return null
}

const getClaudeEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(getShellSpawnEnv()).filter(
      ([key]) => !(CLAUDE_WIRING_ENV_KEYS as readonly string[]).includes(key)
    )
  )

const runClaude = async (
  executable: string,
  args: string[],
  timeout: number
): Promise<string> => {
  try {
    const { stdout } = await execFileAsync(executable, args, {
      encoding: "utf-8",
      env: getClaudeEnv(),
      maxBuffer: 1024 * 1024,
      timeout,
      windowsHide: true
    })
    return stdout
  } catch (error) {
    // Signed out, `claude auth status` exits 1 but still prints its JSON.
    if (
      typeof error === "object" &&
      error !== null &&
      "stdout" in error &&
      typeof error.stdout === "string" &&
      error.stdout.trim()
    ) {
      return error.stdout
    }
    throw error
  }
}

const readClaudeCodeAccount = async (): Promise<LocalAccount> => {
  const base = {
    email: null,
    id: "claude-code" as const,
    organization: null,
    plan: null,
    source: "claude auth status",
    subscriptionUntil: null
  }
  const executable = await findClaudeExecutable()

  if (!executable) {
    return { ...base, status: "not-installed" }
  }

  try {
    const status = parseClaudeAuthStatus(
      await runClaude(
        executable,
        ["auth", "status", "--json"],
        CLAUDE_STATUS_TIMEOUT_MS
      )
    )

    if (!status) {
      return { ...base, status: "unavailable" }
    }

    return status.loggedIn
      ? {
          ...base,
          email: status.email,
          organization: status.organization,
          plan: status.plan,
          status: "signed-in"
        }
      : { ...base, status: "signed-out" }
  } catch {
    return { ...base, status: "unavailable" }
  }
}

const readCodexLogin = async () => {
  const authPath = path.join(getCodexHome(), "auth.json")

  try {
    return {
      authPath,
      login: parseCodexAuth(await readFile(authPath, "utf-8"))
    }
  } catch {
    return { authPath, login: null }
  }
}

const readCodexAccount = async (): Promise<LocalAccount> => {
  const { authPath, login } = await readCodexLogin()
  const source = authPath.replace(os.homedir(), "~")

  if (!login) {
    return {
      email: null,
      id: "codex",
      organization: null,
      plan: null,
      source,
      status: "signed-out",
      subscriptionUntil: null
    }
  }

  return {
    email: login.email,
    id: "codex",
    organization: null,
    plan: login.plan,
    source,
    status: "signed-in",
    subscriptionUntil: login.subscriptionUntil
  }
}

export const listLocalAccounts = async (): Promise<{
  accounts: LocalAccount[]
  discovery: boolean
}> => {
  if (!isDiscoveryOn()) {
    return { accounts: [], discovery: false }
  }

  const accounts = await Promise.all([
    readClaudeCodeAccount(),
    readCodexAccount()
  ])

  return { accounts, discovery: true }
}

const emptyUsage = (
  id: LocalAccountId,
  error: string | null
): LocalAccountUsage => ({
  credits: null,
  error,
  fetchedAt: new Date().toISOString(),
  id,
  windows: []
})

const readClaudeCodeUsage = async (): Promise<LocalAccountUsage> => {
  const executable = await findClaudeExecutable()

  if (!executable) {
    return emptyUsage("claude-code", "Claude Code is not installed.")
  }

  try {
    const reading = parseClaudeUsage(
      await runClaude(executable, CLAUDE_USAGE_ARGS, CLAUDE_USAGE_TIMEOUT_MS)
    )
    return {
      ...emptyUsage("claude-code", reading.error),
      windows: reading.windows
    }
  } catch (error) {
    return emptyUsage(
      "claude-code",
      error instanceof Error ? error.message : String(error)
    )
  }
}

// Phase 1 reads only: an expired access token is reported, not refreshed —
// refreshing writes Codex's own auth.json, which stays Codex's job for now.
const readCodexUsage = async (): Promise<LocalAccountUsage> => {
  const { login } = await readCodexLogin()

  if (!login?.accountId) {
    return emptyUsage("codex", "Codex is not signed in with ChatGPT.")
  }

  if (
    login.accessTokenExpiresAt !== null &&
    login.accessTokenExpiresAt <= Date.now()
  ) {
    return emptyUsage(
      "codex",
      "Codex's sign-in expired. Open Codex to renew it."
    )
  }

  try {
    const response = await fetch(CODEX_USAGE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${login.accessToken}`,
        "chatgpt-account-id": login.accountId
      },
      signal: AbortSignal.timeout(CODEX_USAGE_TIMEOUT_MS)
    })

    if (!response.ok) {
      return emptyUsage("codex", `ChatGPT answered ${response.status}.`)
    }

    const reading = parseCodexUsage(await response.json(), Date.now())
    return {
      ...emptyUsage("codex", null),
      credits: reading.credits,
      windows: reading.windows
    }
  } catch (error) {
    return emptyUsage(
      "codex",
      error instanceof Error ? error.message : String(error)
    )
  }
}

export const readLocalAccountUsage = async (
  id: LocalAccountId
): Promise<LocalAccountUsage> => {
  if (!isDiscoveryOn()) {
    return emptyUsage(id, "Local subscription discovery is off.")
  }

  return id === "claude-code"
    ? await readClaudeCodeUsage()
    : await readCodexUsage()
}
