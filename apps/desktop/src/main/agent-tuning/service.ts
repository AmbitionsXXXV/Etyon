import { createReadStream } from "node:fs"
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"

import type {
  AgentCompactSetting,
  AgentTuningRow,
  TunedAgent
} from "@etyon/rpc"
import { app } from "electron"

import { getAppConfigDir } from "@/main/app-paths"
import { getSettings } from "@/main/settings"
import { adviseCompactWindow } from "@/shared/tuning/compact-replay"
import type {
  CompactReplayOptions,
  ReplayCall
} from "@/shared/tuning/compact-replay"

import {
  CODEX_COMPACT_KEY,
  readClaudeCompactSetting,
  readTomlTopNumber,
  writeClaudeCompactWindow,
  writeTomlTopNumber
} from "./config-files"
import {
  claudeModelSettingsName,
  parseClaudeSessionLines,
  parseCodexRolloutLines
} from "./parse-sessions"

/**
 * Auto-compact tuning for Claude Code and Codex (magpie's "Tuned for you"):
 * replay the agents' own session files under every candidate window and
 * advise the cheapest; on the user's say, write the agent's own config with
 * an Undo kept in Etyon's config directory.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const CACHE_TTL_MS = 60_000

// Claude Code compacts at 167K of a 200K window, so 33K stays free; a model
// used past 200K (or marked [1m]) has the 1M window (magpie internal/gui/tune.go).
const CLAUDE_OPTIONS = {
  max: 1_000_000,
  min: 100_000,
  reserve: 33_000,
  step: 10_000
}
const CLAUDE_WINDOW = 200_000
const CLAUDE_LONG_WINDOW = 1_000_000
const CODEX_OPTIONS = { max: 1_000_000, min: 50_000, reserve: 0, step: 10_000 }
const CODEX_MIN_WINDOW = 272_000

const getClaudeDir = (): string => {
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

const claudeSettingsPath = (): string =>
  path.join(getClaudeDir(), "settings.json")
const codexConfigPath = (): string => path.join(getCodexHome(), "config.toml")
const stashPath = (): string =>
  path.join(getAppConfigDir(app.getPath("home")), "agent-tuning-stash.json")
const displayPath = (filePath: string): string =>
  filePath.replace(os.homedir(), "~")

const readText = async (filePath: string): Promise<string> => {
  try {
    return await readFile(filePath, "utf-8")
  } catch {
    return ""
  }
}

// Written beside and renamed over, so the agent never reads half a file.
const writeTextAtomic = async (
  filePath: string,
  text: string
): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.etyon-${process.pid}.tmp`
  await writeFile(temporary, text, "utf-8")
  await rename(temporary, filePath)
}

const listEntries = async (directory: string) => {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

const isRecent = async (
  filePath: string,
  sinceMs: number
): Promise<boolean> => {
  try {
    const info = await stat(filePath)
    return info.mtimeMs >= sinceMs
  } catch {
    return false
  }
}

const streamLines = (filePath: string) =>
  createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, "utf-8")
  })

// Subagent conversations live under <session>/subagents/ and keep their own
// context, so only the top-level <session>.jsonl files are read.
const collectClaudeCalls = async (sinceMs: number): Promise<ReplayCall[]> => {
  const projectsDir = path.join(getClaudeDir(), "projects")
  const calls: ReplayCall[] = []
  for (const project of await listEntries(projectsDir)) {
    if (!project.isDirectory()) {
      continue
    }
    const projectDir = path.join(projectsDir, project.name)
    for (const entry of await listEntries(projectDir)) {
      const filePath = path.join(projectDir, entry.name)
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue
      }
      if (!(await isRecent(filePath, sinceMs))) {
        continue
      }
      calls.push(
        ...(await parseClaudeSessionLines(streamLines(filePath), {
          sinceMs,
          stream: filePath
        }))
      )
    }
  }
  return calls
}

const collectCodexCalls = async (sinceMs: number) => {
  const sessionsDir = path.join(getCodexHome(), "sessions")
  const calls: ReplayCall[] = []
  let contextWindow = 0
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await listEntries(directory)) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        (await isRecent(entryPath, sinceMs))
      ) {
        const reading = await parseCodexRolloutLines(streamLines(entryPath), {
          sinceMs,
          stream: entryPath
        })
        calls.push(...reading.calls)
        contextWindow = Math.max(contextWindow, reading.contextWindow)
      }
    }
  }
  await walk(sessionsDir)
  return { calls, contextWindow }
}

interface StashEntry {
  had: number | null
  set: number
}

const stashKey = (agent: TunedAgent, model: string): string =>
  `${agent}:${model}`

const readStash = async (): Promise<Record<string, StashEntry>> => {
  try {
    const value: unknown = JSON.parse(await readText(stashPath()))
    return typeof value === "object" && value !== null
      ? (value as Record<string, StashEntry>)
      : {}
  } catch {
    return {}
  }
}

const writeStash = async (stash: Record<string, StashEntry>): Promise<void> => {
  await writeTextAtomic(stashPath(), `${JSON.stringify(stash, null, 2)}\n`)
}

/** The value at the exact place Etyon writes: the model's own entry, or Codex's key. */
const readOwnPlace = async (
  agent: TunedAgent,
  model: string
): Promise<number | null> => {
  if (agent === "codex") {
    return readTomlTopNumber(
      await readText(codexConfigPath()),
      CODEX_COMPACT_KEY
    )
  }
  const setting = readClaudeCompactSetting(
    await readText(claudeSettingsPath()),
    model,
    {}
  )
  return setting.source === "model" ? setting.value : null
}

const readSetting = async (
  agent: TunedAgent,
  model: string,
  stash: Record<string, StashEntry>
): Promise<AgentCompactSetting> => {
  const own = stash[stashKey(agent, model)]
  if (agent === "codex") {
    const value = readTomlTopNumber(
      await readText(codexConfigPath()),
      CODEX_COMPACT_KEY
    )
    return {
      isOurs: own !== undefined && value === own.set,
      lockedBy: null,
      source: value === null ? null : "settings",
      value
    }
  }
  const setting = readClaudeCompactSetting(
    await readText(claudeSettingsPath()),
    model,
    process.env
  )
  return {
    isOurs:
      own !== undefined &&
      setting.source === "model" &&
      setting.value === own.set,
    lockedBy: setting.lockedBy,
    source: setting.source,
    value: setting.value
  }
}

const groupByModel = (
  calls: readonly ReplayCall[],
  keyOf: (model: string) => string | null
): Map<string, ReplayCall[]> => {
  const groups = new Map<string, ReplayCall[]>()
  for (const call of calls) {
    const key = keyOf(call.model)
    if (key) {
      groups.set(key, [...(groups.get(key) ?? []), call])
    }
  }
  return groups
}

const buildRow = async ({
  agent,
  calls,
  model,
  options,
  stash
}: {
  agent: TunedAgent
  calls: ReplayCall[]
  model: string
  options: Omit<CompactReplayOptions, "current">
  stash: Record<string, StashEntry>
}): Promise<AgentTuningRow> => {
  const setting = await readSetting(agent, model, stash)
  const advice = adviseCompactWindow(calls, {
    ...options,
    current: setting.value ?? 0
  })
  const bestPoint = advice?.curve.find((point) => point.value === advice.best)
  const nowPoint = advice?.curve.find((point) => point.value === advice.current)
  return {
    advice: advice
      ? {
          after: advice.facts.after,
          best: advice.best,
          calls: advice.facts.calls,
          compactsBest: bestPoint?.compacts ?? 0,
          compactsNow: nowPoint?.compacts ?? advice.facts.compacts,
          current: advice.current,
          growth: advice.facts.growth,
          saving:
            advice.cost > 0
              ? Math.max(0, (advice.cost - advice.low) / advice.cost)
              : 0,
          streams: advice.facts.streams,
          window: advice.window
        }
      : null,
    agent,
    calls: calls.length,
    file: displayPath(
      agent === "codex" ? codexConfigPath() : claudeSettingsPath()
    ),
    model,
    setting
  }
}

let cached: { days: number; expiresAt: number; rows: AgentTuningRow[] } | null =
  null

export const getAgentTuning = async (
  days: number
): Promise<AgentTuningRow[]> => {
  if (!getSettings().localAccounts.discovery) {
    return []
  }
  if (cached && cached.days === days && cached.expiresAt > Date.now()) {
    return cached.rows
  }
  const sinceMs = Date.now() - days * DAY_MS
  const stash = await readStash()
  const rows: AgentTuningRow[] = []

  const claudeGroups = groupByModel(
    await collectClaudeCalls(sinceMs),
    claudeModelSettingsName
  )
  for (const [model, calls] of claudeGroups) {
    const isLong = calls.some(
      (call) => call.prompt > CLAUDE_WINDOW || call.model.includes("[1m]")
    )
    rows.push(
      await buildRow({
        agent: "claude-code",
        calls,
        model,
        options: {
          ...CLAUDE_OPTIONS,
          window: isLong ? CLAUDE_LONG_WINDOW : CLAUDE_WINDOW
        },
        stash
      })
    )
  }

  const codex = await collectCodexCalls(sinceMs)
  for (const [model, calls] of groupByModel(codex.calls, (value) => value)) {
    const largest = Math.max(...calls.map((call) => call.prompt))
    rows.push(
      await buildRow({
        agent: "codex",
        calls,
        model,
        options: {
          ...CODEX_OPTIONS,
          window: Math.max(CODEX_MIN_WINDOW, largest)
        },
        stash
      })
    )
  }

  rows.sort((left, right) => right.calls - left.calls)
  cached = { days, expiresAt: Date.now() + CACHE_TTL_MS, rows }
  return rows
}

const CLAUDE_MIN_WINDOW_SETTING = 100_000
const CLAUDE_MAX_WINDOW_SETTING = 1_000_000

const writeOwnPlace = async (
  agent: TunedAgent,
  model: string,
  value: number | null
): Promise<void> => {
  if (agent === "codex") {
    const filePath = codexConfigPath()
    await writeTextAtomic(
      filePath,
      writeTomlTopNumber(await readText(filePath), CODEX_COMPACT_KEY, value)
    )
    return
  }
  const filePath = claudeSettingsPath()
  await writeTextAtomic(
    filePath,
    writeClaudeCompactWindow(await readText(filePath), model, value)
  )
}

/** Writes the window into the agent's own config, keeping the old value for Undo. */
export const applyAgentTuning = async ({
  agent,
  model,
  value
}: {
  agent: TunedAgent
  model: string
  value: number
}): Promise<void> => {
  const stash = await readStash()
  const setting = await readSetting(agent, model, stash)
  if (setting.lockedBy) {
    throw new Error(
      `${setting.lockedBy} is set and comes before the setting. Remove it first.`
    )
  }
  if (
    agent === "claude-code" &&
    (value < CLAUDE_MIN_WINDOW_SETTING || value > CLAUDE_MAX_WINDOW_SETTING)
  ) {
    throw new Error(
      "Claude Code takes a window of 100,000 to 1,000,000 tokens."
    )
  }
  const key = stashKey(agent, model)
  const previous = stash[key]
  stash[key] = {
    had: previous ? previous.had : await readOwnPlace(agent, model),
    set: value
  }
  await writeStash(stash)
  await writeOwnPlace(agent, model, value)
  cached = null
}

/** Restores what was there before, unless the user changed it since. */
export const undoAgentTuning = async ({
  agent,
  model
}: {
  agent: TunedAgent
  model: string
}): Promise<void> => {
  const stash = await readStash()
  const key = stashKey(agent, model)
  const entry = stash[key]
  if (!entry) {
    throw new Error("Etyon did not set this window.")
  }
  if ((await readOwnPlace(agent, model)) === entry.set) {
    await writeOwnPlace(agent, model, entry.had)
  }
  await writeStash(
    Object.fromEntries(Object.entries(stash).filter(([name]) => name !== key))
  )
  cached = null
}
