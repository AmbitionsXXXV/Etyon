import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type {
  RtkTokenSavingsCommandEntry,
  RtkTokenSavingsDailyEntry,
  RtkTokenSavingsOutput,
  RtkTokenSavingsRecentCommand,
  RtkTokenSavingsSummary
} from "@etyon/rpc"

import { loadRecentCommandsFromHistoryDb } from "@/main/rtk-history-db"
import {
  getCliNameFromCommand,
  normalizeRtkCommandLabel
} from "@/renderer/lib/token-savings/command-label"

const RECENT_COMMAND_LIMIT = 10

const RTK_GAIN_MAX_BUFFER = 1024 * 1024
const RTK_GAIN_TIMEOUT_MS = 5000
const RTK_TOKEN_SCOPE = "global" as const

const execFileAsync = promisify(execFile)

const EMPTY_SUMMARY = {
  averageSavingsPercent: 0,
  averageTimeMs: 0,
  totalCommands: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalSavedTokens: 0,
  totalTimeMs: 0
} as const satisfies RtkTokenSavingsSummary

const TOKEN_AMOUNT_MULTIPLIERS = {
  B: 1_000_000_000,
  K: 1000,
  M: 1_000_000
} as const

interface RtkGainJsonPayload {
  daily: RtkTokenSavingsDailyEntry[]
  summary: RtkTokenSavingsSummary
}

interface WeightedRtkCommandEntry extends RtkTokenSavingsCommandEntry {
  dominantSavedTokens: number
  timeWeight: number
  totalWeight: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const toNonNegativeInteger = (value: number): number =>
  Math.max(0, Math.round(Number.isFinite(value) ? value : 0))

const getNumber = (
  record: Record<string, unknown> | null,
  key: string
): number => {
  const value = record?.[key]

  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

const getString = (
  record: Record<string, unknown> | null,
  key: string
): string => {
  const value = record?.[key]

  return typeof value === "string" ? value : ""
}

export {
  getCliNameFromCommand,
  normalizeRtkCommandLabel
} from "@/renderer/lib/token-savings/command-label"

export const parseTokenAmount = (value: string): number => {
  const normalizedValue = value.trim().replaceAll(",", "").toUpperCase()
  const suffix = normalizedValue.at(-1)

  if (
    suffix &&
    suffix in TOKEN_AMOUNT_MULTIPLIERS &&
    Number.isNaN(Number(suffix))
  ) {
    const parsedValue = Number.parseFloat(normalizedValue.slice(0, -1))

    return toNonNegativeInteger(
      parsedValue *
        TOKEN_AMOUNT_MULTIPLIERS[
          suffix as keyof typeof TOKEN_AMOUNT_MULTIPLIERS
        ]
    )
  }

  return toNonNegativeInteger(Number.parseFloat(normalizedValue))
}

export const parseTimeMs = (value: string): number => {
  const normalizedValue = value.trim().toLowerCase()
  const secondsOnlyMatch = normalizedValue.match(
    /^(?<seconds>\d+(?:\.\d+)?)s$/u
  )
  const compoundMatch = normalizedValue.match(
    /^(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m)?(?:(?<seconds>\d+)s)?$/u
  )

  if (normalizedValue.endsWith("ms")) {
    return toNonNegativeInteger(Number.parseFloat(normalizedValue))
  }

  if (secondsOnlyMatch?.groups) {
    return toNonNegativeInteger(
      Number.parseFloat(secondsOnlyMatch.groups.seconds) * 1000
    )
  }

  if (compoundMatch?.groups && normalizedValue !== "") {
    const hours = Number.parseInt(compoundMatch.groups.hours ?? "0", 10)
    const minutes = Number.parseInt(compoundMatch.groups.minutes ?? "0", 10)
    const seconds = Number.parseInt(compoundMatch.groups.seconds ?? "0", 10)

    return toNonNegativeInteger(
      (hours * 60 * 60 + minutes * 60 + seconds) * 1000
    )
  }

  return toNonNegativeInteger(Number.parseFloat(normalizedValue))
}

const parseRtkSummary = (value: unknown): RtkTokenSavingsSummary => {
  const record = isRecord(value) ? value : null

  return {
    averageSavingsPercent: getNumber(record, "avg_savings_pct"),
    averageTimeMs: toNonNegativeInteger(getNumber(record, "avg_time_ms")),
    totalCommands: toNonNegativeInteger(getNumber(record, "total_commands")),
    totalInputTokens: toNonNegativeInteger(getNumber(record, "total_input")),
    totalOutputTokens: toNonNegativeInteger(getNumber(record, "total_output")),
    totalSavedTokens: toNonNegativeInteger(getNumber(record, "total_saved")),
    totalTimeMs: toNonNegativeInteger(getNumber(record, "total_time_ms"))
  }
}

const parseRtkDailyEntry = (value: unknown): RtkTokenSavingsDailyEntry => {
  const record = isRecord(value) ? value : null

  return {
    averageTimeMs: toNonNegativeInteger(getNumber(record, "avg_time_ms")),
    commands: toNonNegativeInteger(getNumber(record, "commands")),
    date: getString(record, "date"),
    inputTokens: toNonNegativeInteger(getNumber(record, "input_tokens")),
    outputTokens: toNonNegativeInteger(getNumber(record, "output_tokens")),
    savedTokens: toNonNegativeInteger(getNumber(record, "saved_tokens")),
    savingsPercent: getNumber(record, "savings_pct"),
    totalTimeMs: toNonNegativeInteger(getNumber(record, "total_time_ms"))
  }
}

export const parseRtkGainJson = (stdout: string): RtkGainJsonPayload => {
  const parsed = JSON.parse(stdout) as unknown
  const record = isRecord(parsed) ? parsed : {}
  const dailyValue = Array.isArray(record.daily) ? record.daily : []

  return {
    daily: dailyValue.map(parseRtkDailyEntry).filter((entry) => entry.date),
    summary: parseRtkSummary(record.summary)
  }
}

const aggregateRtkCommandEntries = (
  entries: RtkTokenSavingsCommandEntry[]
): RtkTokenSavingsCommandEntry[] => {
  const entriesByCli = new Map<string, WeightedRtkCommandEntry>()

  for (const entry of entries) {
    const cliName = getCliNameFromCommand(entry.command)
    const weight = entry.count > 0 ? entry.count : 1
    const existingEntry = entriesByCli.get(cliName)

    if (!existingEntry) {
      entriesByCli.set(cliName, {
        averageReductionPercent: entry.averageReductionPercent,
        averageTimeMs: entry.averageTimeMs,
        command: cliName,
        count: entry.count,
        dominantSavedTokens: entry.savedTokens,
        impact: entry.impact,
        savedTokens: entry.savedTokens,
        timeWeight: entry.averageTimeMs * weight,
        totalWeight: weight
      })
      continue
    }

    const nextSavedTokens = existingEntry.savedTokens + entry.savedTokens
    const nextTotalWeight = existingEntry.totalWeight + weight

    entriesByCli.set(cliName, {
      averageReductionPercent:
        (existingEntry.averageReductionPercent * existingEntry.totalWeight +
          entry.averageReductionPercent * weight) /
        nextTotalWeight,
      averageTimeMs: toNonNegativeInteger(
        (existingEntry.timeWeight + entry.averageTimeMs * weight) /
          nextTotalWeight
      ),
      command: cliName,
      count: existingEntry.count + entry.count,
      dominantSavedTokens: Math.max(
        existingEntry.dominantSavedTokens,
        entry.savedTokens
      ),
      impact:
        entry.savedTokens > existingEntry.dominantSavedTokens
          ? entry.impact
          : existingEntry.impact,
      savedTokens: nextSavedTokens,
      timeWeight: existingEntry.timeWeight + entry.averageTimeMs * weight,
      totalWeight: nextTotalWeight
    })
  }

  return [...entriesByCli.values()]
    .map((entry) => ({
      averageReductionPercent: entry.averageReductionPercent,
      averageTimeMs: entry.averageTimeMs,
      command: entry.command,
      count: entry.count,
      impact: entry.impact,
      savedTokens: entry.savedTokens
    }))
    .toSorted((currentEntry, nextEntry) => {
      const savedTokenDifference =
        nextEntry.savedTokens - currentEntry.savedTokens

      return savedTokenDifference === 0
        ? currentEntry.command.localeCompare(nextEntry.command)
        : savedTokenDifference
    })
}

export const parseRtkCommandEntries = (
  stdout: string
): RtkTokenSavingsCommandEntry[] => {
  const entries: RtkTokenSavingsCommandEntry[] = []
  const commandLinePattern =
    /^\s*\d+\.\s+(?<command>.+?)\s{2,}(?<count>\d+)\s+(?<saved>[\d.,]+[BKMbkm]?)\s+(?<percent>-?\d+(?:\.\d+)?)%\s+(?<time>[\dhms.]+)\s+(?<impact>.+?)\s*$/u

  for (const line of stdout.split("\n")) {
    const match = line.match(commandLinePattern)

    if (!match?.groups) {
      continue
    }

    entries.push({
      averageReductionPercent: Number.parseFloat(match.groups.percent),
      averageTimeMs: parseTimeMs(match.groups.time),
      command: normalizeRtkCommandLabel(match.groups.command),
      count: toNonNegativeInteger(Number.parseInt(match.groups.count, 10)),
      impact: match.groups.impact.trim(),
      savedTokens: parseTokenAmount(match.groups.saved)
    })
  }

  return aggregateRtkCommandEntries(entries)
}

export const parseRtkRecentCommands = (
  stdout: string
): RtkTokenSavingsRecentCommand[] => {
  const entries: RtkTokenSavingsRecentCommand[] = []
  const recentLinePattern =
    /^\s*(?<date>\d{2}-\d{2})\s+(?<time>\d{2}:\d{2})\s+\S+\s+(?<command>.+?)\s+-(?<percent>\d+(?:\.\d+)?)%\s+\((?<saved>\d+)\)\s*$/u

  for (const line of stdout.split("\n")) {
    const match = line.match(recentLinePattern)

    if (!match?.groups) {
      continue
    }

    entries.push({
      command: normalizeRtkCommandLabel(match.groups.command),
      reductionPercent: Number.parseFloat(match.groups.percent),
      savedTokens: toNonNegativeInteger(
        Number.parseInt(match.groups.saved, 10)
      ),
      timestampLabel: `${match.groups.date} ${match.groups.time}`
    })
  }

  return entries
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const runRtkGain = async (args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync("rtk", ["gain", ...args], {
    encoding: "utf-8",
    maxBuffer: RTK_GAIN_MAX_BUFFER,
    timeout: RTK_GAIN_TIMEOUT_MS,
    windowsHide: true
  })

  return String(stdout)
}

const createUnavailableTokenSavingsOutput = (
  error: unknown
): RtkTokenSavingsOutput => ({
  available: false,
  commands: [],
  daily: [],
  error: getErrorMessage(error),
  generatedAt: new Date().toISOString(),
  recentCommands: [],
  scope: RTK_TOKEN_SCOPE,
  summary: EMPTY_SUMMARY
})

export const getRtkTokenSavings = async (): Promise<RtkTokenSavingsOutput> => {
  try {
    const [jsonStdout, historyStdout, recentCommandsFromDb] = await Promise.all(
      [
        runRtkGain(["--daily", "--format", "json"]),
        runRtkGain(["--history"]),
        loadRecentCommandsFromHistoryDb(RECENT_COMMAND_LIMIT)
      ]
    )
    const parsedJson = parseRtkGainJson(jsonStdout)
    const recentCommands =
      recentCommandsFromDb.length > 0
        ? recentCommandsFromDb
        : parseRtkRecentCommands(historyStdout)

    return {
      available: true,
      commands: parseRtkCommandEntries(historyStdout),
      daily: parsedJson.daily,
      error: null,
      generatedAt: new Date().toISOString(),
      recentCommands,
      scope: RTK_TOKEN_SCOPE,
      summary: parsedJson.summary
    }
  } catch (error) {
    return createUnavailableTokenSavingsOutput(error)
  }
}
