import { execFile } from "node:child_process"
import fsSync from "node:fs"
import { promisify } from "node:util"

import { getShellSpawnEnv } from "@/main/agents/minimal/spawn-env"

export type RipgrepSource = "bundled" | "missing" | "system"

export interface RipgrepResolution {
  command: string | null
  source: RipgrepSource
}

const execFileAsync = promisify(execFile)

let resolutionPromise: Promise<RipgrepResolution> | null = null

const resolveBundledRipgrep = async (): Promise<RipgrepResolution> => {
  try {
    const { rgPath } = await import("@vscode/ripgrep")

    return fsSync.existsSync(rgPath)
      ? { command: rgPath, source: "bundled" }
      : { command: null, source: "missing" }
  } catch {
    return { command: null, source: "missing" }
  }
}

const resolveRipgrepUncached = async (): Promise<RipgrepResolution> => {
  try {
    await execFileAsync("rg", ["--version"], {
      env: getShellSpawnEnv()
    })

    return { command: "rg", source: "system" }
  } catch {
    return resolveBundledRipgrep()
  }
}

export const resolveRipgrep = (): Promise<RipgrepResolution> => {
  resolutionPromise ??= resolveRipgrepUncached()

  return resolutionPromise
}

export const resetRipgrepResolutionCacheForTests = (): void => {
  resolutionPromise = null
}
