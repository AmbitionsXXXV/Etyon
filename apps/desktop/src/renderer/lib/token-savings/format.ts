import type {
  RtkTokenSavingsCommandEntry,
  RtkTokenSavingsDailyEntry
} from "@etyon/rpc"

import { getCliNameFromCommand } from "@/renderer/lib/token-savings/command-label"

interface CommandSavingsChartPoint extends Record<string, number | string> {
  averageReductionPercent: number
  command: string
  count: number
  savedTokens: number
}

interface DailySavingsChartPoint extends Record<string, number | string> {
  commands: number
  date: string
  label: string
  savedTokens: number
  savingsPercent: number
}

const CHART_COMMAND_LABEL_MAX_LENGTH = 22
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact"
})

const INTEGER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0
})

const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  style: "percent"
})

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60

export const formatChartCommandLabel = (value: string): string =>
  value.length > CHART_COMMAND_LABEL_MAX_LENGTH
    ? `${value.slice(0, CHART_COMMAND_LABEL_MAX_LENGTH - 3)}...`
    : value

export const formatCompactTokens = (value: number): string =>
  COMPACT_NUMBER_FORMATTER.format(value)

export const formatInteger = (value: number): string =>
  INTEGER_FORMATTER.format(value)

export const formatPercent = (value: number): string =>
  PERCENT_FORMATTER.format(value / 100)

export const formatRuntime = (valueMs: number): string => {
  const seconds = Math.round(valueMs / MILLISECONDS_PER_SECOND)

  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  const remainingSeconds = seconds % SECONDS_PER_MINUTE

  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`
}

export const buildDailySavingsChartPoints = (
  entries: RtkTokenSavingsDailyEntry[],
  limit: number
): DailySavingsChartPoint[] => {
  const visibleEntries = entries.slice(-limit)

  return visibleEntries.map((entry) => ({
    commands: entry.commands,
    date: entry.date,
    label: entry.date.slice(5),
    savedTokens: entry.savedTokens,
    savingsPercent: entry.savingsPercent
  }))
}

export const buildCommandSavingsChartPoints = (
  commands: RtkTokenSavingsCommandEntry[],
  limit: number
): CommandSavingsChartPoint[] => {
  const entriesByCli = new Map<
    string,
    CommandSavingsChartPoint & { totalWeight: number }
  >()

  for (const command of commands) {
    const cliName = getCliNameFromCommand(command.command)
    const weight = command.count > 0 ? command.count : 1
    const existingEntry = entriesByCli.get(cliName)

    if (!existingEntry) {
      entriesByCli.set(cliName, {
        averageReductionPercent: command.averageReductionPercent,
        command: cliName,
        count: command.count,
        savedTokens: command.savedTokens,
        totalWeight: weight
      })
      continue
    }

    const nextTotalWeight = existingEntry.totalWeight + weight

    entriesByCli.set(cliName, {
      averageReductionPercent:
        (existingEntry.averageReductionPercent * existingEntry.totalWeight +
          command.averageReductionPercent * weight) /
        nextTotalWeight,
      command: cliName,
      count: existingEntry.count + command.count,
      savedTokens: existingEntry.savedTokens + command.savedTokens,
      totalWeight: nextTotalWeight
    })
  }

  return [...entriesByCli.values()]
    .toSorted((currentEntry, nextEntry) => {
      const savedTokenDifference =
        nextEntry.savedTokens - currentEntry.savedTokens

      return savedTokenDifference === 0
        ? currentEntry.command.localeCompare(nextEntry.command)
        : savedTokenDifference
    })
    .slice(0, limit)
    .map(({ averageReductionPercent, command, count, savedTokens }) => ({
      averageReductionPercent,
      command,
      count,
      savedTokens
    }))
}
