import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

import type {
  GitFileStatus,
  GitProjectDiffFileSnapshot,
  GitProjectDiffOutput,
  GitProjectStatus,
  GitStatusFile
} from "@etyon/rpc"

const GIT_COMMAND_TIMEOUT_MS = 3000
const GIT_DIFF_MAX_BUFFER = 2 * 1024 * 1024
const GIT_DIFF_SNAPSHOT_MAX_FILE_BYTES = 512 * 1024
const GIT_STATUS_MAX_BUFFER = 512 * 1024
const NULL_BYTE = String.fromCodePoint(0)

type GitDiffStage = GitProjectDiffFileSnapshot["stage"]

interface GitDiffNameStatusEntry {
  newPath: string
  oldPath?: string
  status: string
}

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

const parseGitDiffNameStatus = (stdout: string): GitDiffNameStatusEntry[] => {
  const tokens = stdout.split(NULL_BYTE).filter(Boolean)
  const entries: GitDiffNameStatusEntry[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const status = tokens[index]

    if (!status) {
      continue
    }

    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = tokens[index + 1]
      const newPath = tokens[index + 2]

      if (oldPath && newPath) {
        entries.push({
          newPath: normalizeGitPath(newPath),
          oldPath: normalizeGitPath(oldPath),
          status
        })
      }

      index += 2
      continue
    }

    const newPath = tokens[index + 1]

    if (newPath) {
      entries.push({
        newPath: normalizeGitPath(newPath),
        status
      })
    }

    index += 1
  }

  return entries
}

const resolveProjectFilePath = ({
  projectPath,
  relativePath
}: {
  projectPath: string
  relativePath: string
}): string => {
  const resolvedPath = path.resolve(projectPath, relativePath)
  const relativeToProject = path.relative(projectPath, resolvedPath)

  if (
    relativeToProject.startsWith("..") ||
    path.isAbsolute(relativeToProject)
  ) {
    throw new Error(`Git path escapes project root: ${relativePath}`)
  }

  return resolvedPath
}

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

const readGitBlob = ({
  projectPath,
  revision,
  filePath
}: {
  filePath: string
  projectPath: string
  revision: string
}): Promise<string> =>
  runGit({
    args: ["show", `${revision}:${filePath}`],
    maxBuffer: GIT_DIFF_SNAPSHOT_MAX_FILE_BYTES,
    projectPath
  })

const readWorktreeFile = async ({
  filePath,
  projectPath
}: {
  filePath: string
  projectPath: string
}): Promise<string> => {
  const resolvedPath = resolveProjectFilePath({
    projectPath,
    relativePath: filePath
  })
  const stats = await fs.promises.stat(resolvedPath)

  if (stats.size > GIT_DIFF_SNAPSHOT_MAX_FILE_BYTES) {
    throw new Error(`Git diff snapshot file is too large: ${filePath}`)
  }

  return fs.promises.readFile(resolvedPath, "utf-8")
}

const readGitDiffOldContent = ({
  entry,
  oldPath,
  projectPath,
  stage
}: {
  entry: GitDiffNameStatusEntry
  oldPath: string
  projectPath: string
  stage: GitDiffStage
}): Promise<string> => {
  if (entry.status.startsWith("A")) {
    return Promise.resolve("")
  }

  return readGitBlob({
    filePath: oldPath,
    projectPath,
    revision: stage === "staged" ? "HEAD" : ""
  })
}

const readGitDiffNewContent = ({
  entry,
  projectPath,
  stage
}: {
  entry: GitDiffNameStatusEntry
  projectPath: string
  stage: GitDiffStage
}): Promise<string> => {
  if (entry.status.startsWith("D")) {
    return Promise.resolve("")
  }

  if (stage === "staged") {
    return readGitBlob({
      filePath: entry.newPath,
      projectPath,
      revision: ""
    })
  }

  return readWorktreeFile({
    filePath: entry.newPath,
    projectPath
  })
}

const readGitDiffSnapshot = async ({
  entry,
  projectPath,
  stage
}: {
  entry: GitDiffNameStatusEntry
  projectPath: string
  stage: GitDiffStage
}): Promise<GitProjectDiffFileSnapshot | null> => {
  const oldPath = entry.oldPath ?? entry.newPath

  try {
    const [newContent, oldContent] = await Promise.all([
      readGitDiffNewContent({
        entry,
        projectPath,
        stage
      }),
      readGitDiffOldContent({
        entry,
        oldPath,
        projectPath,
        stage
      })
    ])

    return {
      newContent,
      oldContent,
      oldPath: entry.oldPath,
      path: entry.newPath,
      stage
    }
  } catch {
    return null
  }
}

const getGitDiffFileSnapshots = async ({
  projectPath,
  stage
}: {
  projectPath: string
  stage: GitDiffStage
}): Promise<GitProjectDiffFileSnapshot[]> => {
  const nameStatus = await runGit({
    args: [
      "diff",
      ...(stage === "staged" ? ["--cached"] : []),
      "--name-status",
      "-z",
      "--",
      "."
    ],
    maxBuffer: GIT_STATUS_MAX_BUFFER,
    projectPath
  })
  const entries = parseGitDiffNameStatus(nameStatus)
  const snapshots = await Promise.all(
    entries.map((entry) =>
      readGitDiffSnapshot({
        entry,
        projectPath,
        stage
      })
    )
  )

  return snapshots.filter(
    (snapshot): snapshot is GitProjectDiffFileSnapshot => snapshot !== null
  )
}

const getGitDiffFileSnapshotsSafely = async ({
  projectPath,
  stage
}: {
  projectPath: string
  stage: GitDiffStage
}): Promise<GitProjectDiffFileSnapshot[]> => {
  try {
    return await getGitDiffFileSnapshots({
      projectPath,
      stage
    })
  } catch {
    return []
  }
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
    fileSnapshots: [],
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
    const [stagedPatch, unstagedPatch, stagedSnapshots, unstagedSnapshots] =
      await Promise.all([
        runGit({
          args: ["diff", "--cached", "--no-color", "--no-ext-diff", "--", "."],
          maxBuffer: GIT_DIFF_MAX_BUFFER,
          projectPath: normalizedProjectPath
        }),
        runGit({
          args: ["diff", "--no-color", "--no-ext-diff", "--", "."],
          maxBuffer: GIT_DIFF_MAX_BUFFER,
          projectPath: normalizedProjectPath
        }),
        getGitDiffFileSnapshotsSafely({
          projectPath: normalizedProjectPath,
          stage: "staged"
        }),
        getGitDiffFileSnapshotsSafely({
          projectPath: normalizedProjectPath,
          stage: "unstaged"
        })
      ])
    const patch = [stagedPatch.trim(), unstagedPatch.trim()]
      .filter(Boolean)
      .join("\n")

    return {
      fileSnapshots: [...stagedSnapshots, ...unstagedSnapshots],
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
