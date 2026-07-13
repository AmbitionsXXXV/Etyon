import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import type { GitCommitOutput } from "@etyon/rpc"

const GIT_COMMAND_MAX_BUFFER = 512 * 1024
const GIT_COMMAND_TIMEOUT_MS = 30_000

type GitCommitStep = "add" | "commit" | "preflight" | "rev-parse"

interface CommitFilesInput {
  message: string
  paths: string[]
  projectPath: string
}

interface CommitFilesOptions {
  onStep?: (step: GitCommitStep) => Promise<void>
}

const execFileAsync = promisify(execFile)
let gitOperationQueueTail: Promise<unknown> = Promise.resolve()

const awaitSettled = async (queue: Promise<unknown>): Promise<void> => {
  try {
    await queue
  } catch (error) {
    void error
  }
}

const runExclusiveGitOperation = async <TValue>(
  task: () => Promise<TValue>
): Promise<TValue> => {
  const previousTail = gitOperationQueueTail
  const currentTail = Promise.withResolvers<null>()
  gitOperationQueueTail = currentTail.promise
  await awaitSettled(previousTail)

  try {
    return await task()
  } finally {
    currentTail.resolve(null)
  }
}

const runGit = async ({
  args,
  projectPath
}: {
  args: string[]
  projectPath: string
}): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectPath,
    encoding: "utf-8",
    maxBuffer: GIT_COMMAND_MAX_BUFFER,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true
  })

  return String(stdout)
}

const getGitExitCode = (error: unknown): number | string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }

  const { code } = error

  return typeof code === "number" || typeof code === "string" ? code : undefined
}

const getGitErrorDetail = (error: unknown): string | undefined => {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const detail = String(error.stderr ?? "").trim()

    if (detail.length > 0) {
      return detail
    }
  }

  if (error instanceof Error) {
    const detail = error.message.trim()

    return detail.length > 0 ? detail : undefined
  }

  const detail = String(error).trim()

  return detail.length > 0 ? detail : undefined
}

const createGitFailedResult = (error: unknown): GitCommitOutput => {
  const detail = getGitErrorDetail(error)

  return {
    ...(detail === undefined ? {} : { detail }),
    ok: false,
    reason: "git-failed"
  }
}

const readGitConfig = async ({
  key,
  projectPath
}: {
  key: "user.email" | "user.name"
  projectPath: string
}): Promise<string> => {
  try {
    return await runGit({
      args: ["config", "--get", key],
      projectPath
    })
  } catch (error) {
    if (getGitExitCode(error) === 1) {
      return ""
    }

    throw error
  }
}

const pathExists = async (candidatePath: string): Promise<boolean> => {
  try {
    await fs.stat(candidatePath)
    return true
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false
    }

    throw error
  }
}

const hasInProgressGitOperation = async ({
  gitDirectory,
  projectPath
}: {
  gitDirectory: string
  projectPath: string
}): Promise<boolean> => {
  const resolvedGitDirectory = path.resolve(projectPath, gitDirectory.trim())
  const operationMarkers = [
    path.join(resolvedGitDirectory, "MERGE_HEAD"),
    path.join(resolvedGitDirectory, "REBASE_HEAD"),
    path.join(resolvedGitDirectory, "rebase-merge")
  ]

  for (const markerPath of operationMarkers) {
    if (await pathExists(markerPath)) {
      return true
    }
  }

  return false
}

const runGitPreflight = async (
  projectPath: string
): Promise<GitCommitOutput | null> => {
  let isInsideWorkTree: string

  try {
    isInsideWorkTree = await runGit({
      args: ["rev-parse", "--is-inside-work-tree"],
      projectPath
    })
  } catch (error) {
    return typeof getGitExitCode(error) === "number"
      ? { ok: false, reason: "not-a-repo" }
      : createGitFailedResult(error)
  }

  if (isInsideWorkTree.trim() !== "true") {
    return { ok: false, reason: "not-a-repo" }
  }

  try {
    const [gitDirectory, userEmail, userName] = await Promise.all([
      runGit({
        args: ["rev-parse", "--git-dir"],
        projectPath
      }),
      readGitConfig({ key: "user.email", projectPath }),
      readGitConfig({ key: "user.name", projectPath })
    ])

    if (userEmail.trim().length === 0 || userName.trim().length === 0) {
      return { ok: false, reason: "identity-missing" }
    }

    if (await hasInProgressGitOperation({ gitDirectory, projectPath })) {
      return { ok: false, reason: "merge-in-progress" }
    }

    return null
  } catch (error) {
    return createGitFailedResult(error)
  }
}

const notifyStep = async (
  options: CommitFilesOptions,
  step: GitCommitStep
): Promise<void> => {
  if (options.onStep) {
    await options.onStep(step)
  }
}

export const commitFiles = (
  { message, paths, projectPath }: CommitFilesInput,
  options: CommitFilesOptions = {}
): Promise<GitCommitOutput> => {
  const normalizedMessage = message.trim()

  if (normalizedMessage.length === 0) {
    return Promise.resolve({ ok: false, reason: "empty-message" })
  }

  const normalizedPaths = [
    ...new Set(paths.map((filePath) => filePath.trim()).filter(Boolean))
  ]

  if (normalizedPaths.length === 0) {
    return Promise.resolve({ ok: false, reason: "empty-selection" })
  }

  return runExclusiveGitOperation(async () => {
    const preflightFailure = await runGitPreflight(projectPath)

    if (preflightFailure) {
      return preflightFailure
    }

    await notifyStep(options, "preflight")

    try {
      await runGit({
        args: ["add", "--", ...normalizedPaths],
        projectPath
      })
      await notifyStep(options, "add")
      await runGit({
        args: ["commit", "-m", normalizedMessage],
        projectPath
      })
      await notifyStep(options, "commit")
      const shortHash = await runGit({
        args: ["rev-parse", "--short", "HEAD"],
        projectPath
      })
      await notifyStep(options, "rev-parse")

      return {
        committedFileCount: normalizedPaths.length,
        ok: true,
        shortHash: shortHash.trim()
      }
    } catch (error) {
      return createGitFailedResult(error)
    }
  })
}
