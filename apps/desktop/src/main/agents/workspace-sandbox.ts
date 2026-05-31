import { randomUUID } from "node:crypto"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { AgentSandboxSettings } from "@etyon/rpc"

type WorkspaceSandboxEngine =
  | "disabled"
  | "linux-bwrap"
  | "macos-seatbelt"
  | "unsupported"

export interface WorkspaceSandboxCommandInput {
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
}

export interface WorkspaceSandboxError {
  code: "cwd-outside-project" | "unavailable" | "unsupported"
  message: string
}

export interface WorkspaceSandboxSpawnConfig {
  args: string[]
  cleanup: () => Promise<void>
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  sandboxed: boolean
}

export type WorkspaceSandboxResult<TValue> =
  | {
      error: WorkspaceSandboxError
      ok: false
    }
  | {
      ok: true
      value: TValue
    }

export interface WorkspaceSandbox {
  cleanup: () => Promise<void>
  enabled: boolean
  prepareShellCommand: (
    input: WorkspaceSandboxCommandInput
  ) => Promise<WorkspaceSandboxResult<WorkspaceSandboxSpawnConfig>>
}

export interface WorkspaceSandboxSupport {
  available: boolean
  engine: WorkspaceSandboxEngine
  message: string
}

export interface CreateWorkspaceSandboxOptions {
  bwrapPath?: string
  platform?: NodeJS.Platform
  projectPath: string
  sandboxExecPath?: string
  settings?: AgentSandboxSettings
}

const DEFAULT_SHELL_PATH = "/bin/zsh"
const SECRET_ENV_PATTERN =
  /(?:^|_)(?:api_?key|credential|password|private_?key|secret|token)(?:_|$)/iu
const SECRET_ENV_VARIABLES = new Set([
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "GITHUB_TOKEN",
  "OPENAI_API_KEY",
  "SSH_AUTH_SOCK"
])

const createSandboxError = (
  error: WorkspaceSandboxError
): WorkspaceSandboxResult<never> => ({
  error,
  ok: false
})

const createSandboxSpawnConfig = (
  value: WorkspaceSandboxSpawnConfig
): WorkspaceSandboxResult<WorkspaceSandboxSpawnConfig> => ({
  ok: true,
  value
})

const findExecutable = (name: string): string | undefined => {
  if (path.isAbsolute(name)) {
    return fsSync.existsSync(name) ? name : undefined
  }

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name)

    if (fsSync.existsSync(candidate)) {
      return candidate
    }
  }

  return undefined
}

const isSecretEnvName = (name: string): boolean =>
  SECRET_ENV_VARIABLES.has(name) || SECRET_ENV_PATTERN.test(name)

const isPathInsideProject = ({
  candidatePath,
  projectPath
}: {
  candidatePath: string
  projectPath: string
}): boolean => {
  const relativePath = path.relative(projectPath, candidatePath)

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  )
}

export const sanitizeWorkspaceSandboxEnv = (
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const sanitizedEnv: NodeJS.ProcessEnv = {}

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || isSecretEnvName(name)) {
      continue
    }

    sanitizedEnv[name] = value
  }

  return sanitizedEnv
}

const quoteSeatbeltPath = (value: string): string => JSON.stringify(value)

const createMacosSeatbeltProfile = ({
  allowNetwork,
  projectPath,
  tempPath
}: {
  allowNetwork: boolean
  projectPath: string
  tempPath: string
}): string =>
  [
    "(version 1)",
    "(allow default)",
    ...(allowNetwork ? [] : ["(deny network*)"]),
    "(deny file-write*)",
    `(allow file-write* (subpath ${quoteSeatbeltPath(projectPath)}) (subpath ${quoteSeatbeltPath(tempPath)}) (literal "/dev/null"))`,
    `(deny file-read* (subpath ${quoteSeatbeltPath(path.join(os.homedir(), ".aws"))}) (subpath ${quoteSeatbeltPath(path.join(os.homedir(), ".ssh"))}) (regex #"/\\.env(\\..*)?$") (regex #".*\\.(key|p12|pfx|pem)$"))`
  ].join("\n")

const createNoopSpawnConfig = ({
  command,
  cwd,
  env
}: WorkspaceSandboxCommandInput): WorkspaceSandboxSpawnConfig => ({
  args: ["-fc", command],
  cleanup: () => Promise.resolve(),
  command: DEFAULT_SHELL_PATH,
  cwd,
  env,
  sandboxed: false
})

export const detectWorkspaceSandboxSupport = ({
  bwrapPath,
  platform = process.platform,
  sandboxExecPath
}: {
  bwrapPath?: string
  platform?: NodeJS.Platform
  sandboxExecPath?: string
} = {}): WorkspaceSandboxSupport => {
  if (platform === "darwin") {
    const executable = sandboxExecPath ?? findExecutable("sandbox-exec")

    return executable
      ? {
          available: true,
          engine: "macos-seatbelt",
          message: `Using ${executable}.`
        }
      : {
          available: false,
          engine: "macos-seatbelt",
          message: "sandbox-exec is not available."
        }
  }

  if (platform === "linux") {
    const executable = bwrapPath ?? findExecutable("bwrap")

    return executable
      ? {
          available: true,
          engine: "linux-bwrap",
          message: `Using ${executable}.`
        }
      : {
          available: false,
          engine: "linux-bwrap",
          message: "bwrap is not available."
        }
  }

  return {
    available: false,
    engine: "unsupported",
    message: "Workspace sandbox is not supported on this platform."
  }
}

export const createWorkspaceSandbox = ({
  bwrapPath,
  platform = process.platform,
  projectPath,
  sandboxExecPath,
  settings
}: CreateWorkspaceSandboxOptions): WorkspaceSandbox => {
  const enabled = Boolean(settings?.enabled)
  const normalizedProjectPath = path.resolve(projectPath)

  if (!enabled) {
    return {
      cleanup: () => Promise.resolve(),
      enabled: false,
      prepareShellCommand: (input) =>
        Promise.resolve(createSandboxSpawnConfig(createNoopSpawnConfig(input)))
    }
  }

  const support = detectWorkspaceSandboxSupport({
    bwrapPath,
    platform,
    sandboxExecPath
  })

  const prepareShellCommand = async (
    input: WorkspaceSandboxCommandInput
  ): Promise<WorkspaceSandboxResult<WorkspaceSandboxSpawnConfig>> => {
    if (!support.available) {
      return createSandboxError({
        code: support.engine === "unsupported" ? "unsupported" : "unavailable",
        message: support.message
      })
    }

    const resolvedCwd = path.resolve(input.cwd)

    if (
      !isPathInsideProject({
        candidatePath: resolvedCwd,
        projectPath: normalizedProjectPath
      })
    ) {
      return createSandboxError({
        code: "cwd-outside-project",
        message: `Sandbox cwd must stay inside project: ${input.cwd}`
      })
    }

    const env = sanitizeWorkspaceSandboxEnv(input.env)

    if (support.engine === "macos-seatbelt") {
      const profilePath = path.join(
        os.tmpdir(),
        `etyon-agent-sandbox-${process.pid}-${randomUUID()}.sb`
      )
      const profile = createMacosSeatbeltProfile({
        allowNetwork: settings?.allowNetwork ?? false,
        projectPath: normalizedProjectPath,
        tempPath: os.tmpdir()
      })

      await fs.writeFile(profilePath, profile, "utf-8")

      return createSandboxSpawnConfig({
        args: ["-f", profilePath, DEFAULT_SHELL_PATH, "-fc", input.command],
        cleanup: async () => {
          await fs.rm(profilePath, { force: true })
        },
        command: sandboxExecPath ?? "sandbox-exec",
        cwd: resolvedCwd,
        env,
        sandboxed: true
      })
    }

    if (support.engine === "linux-bwrap") {
      return createSandboxSpawnConfig({
        args: [
          "--die-with-parent",
          ...(settings?.allowNetwork ? [] : ["--unshare-net"]),
          "--ro-bind",
          "/",
          "/",
          "--bind",
          normalizedProjectPath,
          normalizedProjectPath,
          "--tmpfs",
          "/tmp",
          "--chdir",
          resolvedCwd,
          DEFAULT_SHELL_PATH,
          "-fc",
          input.command
        ],
        cleanup: () => Promise.resolve(),
        command: bwrapPath ?? "bwrap",
        cwd: resolvedCwd,
        env,
        sandboxed: true
      })
    }

    return createSandboxError({
      code: "unsupported",
      message: support.message
    })
  }

  return {
    cleanup: () => Promise.resolve(),
    enabled,
    prepareShellCommand
  }
}
