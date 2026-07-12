import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { getShellSpawnEnv } from "@/main/agents/minimal/spawn-env"

const RTK_AVAILABILITY_TTL_MS = 60_000

const RTK_COMMAND_ALLOWLIST = new Set([
  "cargo",
  "curl",
  "docker",
  "gh",
  "git",
  "go",
  "jest",
  "kubectl",
  "next",
  "npm",
  "npx",
  "playwright",
  "pnpm",
  "prettier",
  "prisma",
  "pytest",
  "rake",
  "rspec",
  "tsc",
  "vitest",
  "wget"
])

export interface RtkAvailability {
  available: boolean
  version?: string
}

export interface RtkRewriteResult {
  executedCommand: string
  rtkApplied: boolean
}

const execFileAsync = promisify(execFile)

let cachedAvailability: RtkAvailability | null = null
let cachedAtMs = 0
let availabilityPromise: Promise<RtkAvailability> | null = null

const containsUnsafeShellSyntax = (command: string): boolean =>
  command.includes("|") ||
  command.includes(">") ||
  command.includes("<") ||
  command.includes(";") ||
  command.includes("$(") ||
  command.includes("`") ||
  command.includes("\n") ||
  command.includes("\r") ||
  command.replaceAll("&&", "").includes("&")

const containsQuotes = (command: string): boolean =>
  command.includes('"') || command.includes("'")

const rewriteCommandSegment = (segment: string): string => {
  const leadingWhitespace = segment.match(/^\s*/u)?.[0] ?? ""
  const trailingWhitespace = segment.match(/\s*$/u)?.[0] ?? ""
  const trimmedSegment = segment.trim()
  const [firstToken] = trimmedSegment.split(/\s+/u)

  if (
    !firstToken ||
    firstToken === "rtk" ||
    !RTK_COMMAND_ALLOWLIST.has(firstToken)
  ) {
    return segment
  }

  return `${leadingWhitespace}rtk ${trimmedSegment}${trailingWhitespace}`
}

const resolveRtkAvailabilityUncached = async (): Promise<RtkAvailability> => {
  try {
    const { stdout } = await execFileAsync("rtk", ["--version"], {
      env: getShellSpawnEnv(),
      timeout: 3000
    })
    const [version] = String(stdout).trim().split("\n")

    return { available: true, ...(version ? { version } : {}) }
  } catch {
    return { available: false }
  }
}

export const rewriteCommandForRtk = (command: string): RtkRewriteResult => {
  if (
    containsUnsafeShellSyntax(command) ||
    (command.includes("&&") && containsQuotes(command))
  ) {
    return { executedCommand: command, rtkApplied: false }
  }

  const executedCommand = command
    .split("&&")
    .map(rewriteCommandSegment)
    .join("&&")

  return { executedCommand, rtkApplied: executedCommand !== command }
}

const refreshRtkAvailability = async (): Promise<RtkAvailability> => {
  const availability = await resolveRtkAvailabilityUncached()

  cachedAtMs = Date.now()
  cachedAvailability = availability
  availabilityPromise = null

  return availability
}

export const getRtkAvailability = (): Promise<RtkAvailability> => {
  if (cachedAvailability && Date.now() - cachedAtMs < RTK_AVAILABILITY_TTL_MS) {
    return Promise.resolve(cachedAvailability)
  }

  availabilityPromise ??= refreshRtkAvailability()

  return availabilityPromise
}

export const isRtkAvailable = async (): Promise<boolean> => {
  const availability = await getRtkAvailability()

  return availability.available
}

export const resetRtkAvailabilityCacheForTests = (): void => {
  availabilityPromise = null
  cachedAtMs = 0
  cachedAvailability = null
}
