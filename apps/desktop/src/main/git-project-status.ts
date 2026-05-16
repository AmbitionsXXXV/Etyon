import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

import type {
  GitFileStatus,
  GitProjectDiffOutput,
  GitProjectStatus,
  GitStatusFile
} from "@etyon/rpc"

const GIT_COMMAND_TIMEOUT_MS = 3000
const GIT_DIFF_MAX_BUFFER = 2 * 1024 * 1024
const GIT_STATUS_MAX_BUFFER = 512 * 1024
const NULL_BYTE = String.fromCodePoint(0)

const execFileAsync = promisify(execFile)

const createEmptyGitProjectStatus = ({
  error,
  isRepository,
  projectPath
}: {
  error?: string
  isRepository: boolean
  projectPath: string
}): GitProjectStatus => ({
  added: 0,
  changedFileCount: 0,
  deleted: 0,
  error,
  files: [],
  isRepository,
  modified: 0,
  projectPath,
  renamed: 0,
  untracked: 0
})

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const normalizeGitPath = (filePath: string): string =>
  filePath.split(path.sep).join("/")

const runGit = async ({
  args,
  maxBuffer,
  projectPath
}: {
  args: string[]
  maxBuffer: number
  projectPath: string
}): Promise<string> => {
  const { stdout } = await execFileAsync("git", args, {
    cwd: projectPath,
    encoding: "utf-8",
    maxBuffer,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true
  })

  return String(stdout)
}

const resolveGitFileStatus = (statusCode: string): GitFileStatus => {
  if (statusCode === "??") {
    return "untracked"
  }

  if (statusCode === "!!") {
    return "ignored"
  }

  if (statusCode.includes("R")) {
    return "renamed"
  }

  if (statusCode.includes("A")) {
    return "added"
  }

  if (statusCode.includes("D")) {
    return "deleted"
  }

  return "modified"
}

const incrementGitStatusCount = (
  status: GitProjectStatus,
  fileStatus: GitFileStatus
): GitProjectStatus => {
  if (fileStatus === "added") {
    return { ...status, added: status.added + 1 }
  }

  if (fileStatus === "deleted") {
    return { ...status, deleted: status.deleted + 1 }
  }

  if (fileStatus === "renamed") {
    return { ...status, renamed: status.renamed + 1 }
  }

  if (fileStatus === "untracked") {
    return { ...status, untracked: status.untracked + 1 }
  }

  if (fileStatus === "ignored") {
    return status
  }

  return { ...status, modified: status.modified + 1 }
}

export const parseGitStatusPorcelain = ({
  projectPath,
  stdout
}: {
  projectPath: string
  stdout: string
}): GitProjectStatus => {
  const tokens = stdout.split(NULL_BYTE).filter(Boolean)
  const files: GitStatusFile[] = []
  let status = createEmptyGitProjectStatus({
    isRepository: true,
    projectPath
  })

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (!token || token.length < 4) {
      continue
    }

    const statusCode = token.slice(0, 2)
    const fileStatus = resolveGitFileStatus(statusCode)

    if (fileStatus === "ignored") {
      continue
    }

    const relativePath = normalizeGitPath(token.slice(3))
    const statusFile = {
      path: relativePath,
      status: fileStatus
    } satisfies GitStatusFile

    files.push(statusFile)
    status = incrementGitStatusCount(status, fileStatus)

    if (statusCode.includes("R") || statusCode.includes("C")) {
      index += 1
    }
  }

  return {
    ...status,
    changedFileCount: files.length,
    files
  }
}

const isGitRepository = async (projectPath: string): Promise<boolean> => {
  try {
    const output = await runGit({
      args: ["rev-parse", "--is-inside-work-tree"],
      maxBuffer: GIT_STATUS_MAX_BUFFER,
      projectPath
    })

    return output.trim() === "true"
  } catch {
    return false
  }
}

export const getGitProjectStatus = async (
  projectPath: string
): Promise<GitProjectStatus> => {
  const normalizedProjectPath = path.resolve(projectPath)

  if (!fs.existsSync(normalizedProjectPath)) {
    return createEmptyGitProjectStatus({
      error: "Project path does not exist.",
      isRepository: false,
      projectPath: normalizedProjectPath
    })
  }

  if (!(await isGitRepository(normalizedProjectPath))) {
    return createEmptyGitProjectStatus({
      isRepository: false,
      projectPath: normalizedProjectPath
    })
  }

  try {
    const stdout = await runGit({
      args: [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "-z",
        "--",
        "."
      ],
      maxBuffer: GIT_STATUS_MAX_BUFFER,
      projectPath: normalizedProjectPath
    })

    return parseGitStatusPorcelain({
      projectPath: normalizedProjectPath,
      stdout
    })
  } catch (error: unknown) {
    return createEmptyGitProjectStatus({
      error: getErrorMessage(error),
      isRepository: true,
      projectPath: normalizedProjectPath
    })
  }
}

export const getGitProjectStatuses = async (
  projectPaths: string[]
): Promise<Map<string, GitProjectStatus>> => {
  const uniqueProjectPaths = [
    ...new Set(projectPaths.map((projectPath) => path.resolve(projectPath)))
  ]
  const statuses = await Promise.all(
    uniqueProjectPaths.map(getGitProjectStatus)
  )

  return new Map(statuses.map((status) => [status.projectPath, status]))
}

export const getGitProjectDiff = async (
  projectPath: string
): Promise<GitProjectDiffOutput> => {
  const normalizedProjectPath = path.resolve(projectPath)
  const emptyDiff = {
    hasPatch: false,
    patch: "",
    projectPath: normalizedProjectPath,
    truncated: false
  } satisfies GitProjectDiffOutput

  if (
    !fs.existsSync(normalizedProjectPath) ||
    !(await isGitRepository(normalizedProjectPath))
  ) {
    return emptyDiff
  }

  try {
    const [stagedPatch, unstagedPatch] = await Promise.all([
      runGit({
        args: ["diff", "--cached", "--no-color", "--no-ext-diff", "--", "."],
        maxBuffer: GIT_DIFF_MAX_BUFFER,
        projectPath: normalizedProjectPath
      }),
      runGit({
        args: ["diff", "--no-color", "--no-ext-diff", "--", "."],
        maxBuffer: GIT_DIFF_MAX_BUFFER,
        projectPath: normalizedProjectPath
      })
    ])
    const patch = [stagedPatch.trim(), unstagedPatch.trim()]
      .filter(Boolean)
      .join("\n")

    return {
      hasPatch: patch.length > 0,
      patch,
      projectPath: normalizedProjectPath,
      truncated: false
    }
  } catch {
    return {
      ...emptyDiff,
      truncated: true
    }
  }
}
