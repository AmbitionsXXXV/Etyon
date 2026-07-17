import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import type {
  ChatMention,
  ListProjectSnapshotFilesOutput,
  ProjectSnapshotDocument,
  ProjectSnapshotFileItem,
  ProjectSnapshotFolderItem,
  ProjectSnapshotItem,
  ProjectSnapshotState,
  ReadProjectBinaryFileOutput,
  ReadProjectFileOutput
} from "@etyon/rpc"

const AGENT_DOCUMENTS_DIR_NAME = "documents"
const CHUNK_CHAR_COUNT = 2000
const DEFAULT_PROJECT_SNAPSHOT_LIST_LIMIT = 50
const MAX_PROJECT_SNAPSHOT_LIST_LIMIT = 5000
const DEFAULT_IGNORE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  "out/**",
  ".next/**",
  "*.log",
  "*.asar",
  ".alma-snapshots/**",
  ".turbo/**",
  ".vite/**"
] as const
const GITIGNORE_FILE_NAME = ".gitignore"
const PREVIEW_CHAR_COUNT = 4000
const NULL_BYTE = String.fromCodePoint(0)
const SNAPSHOT_CONFIG_VERSION = 1
const SNAPSHOT_DIR_NAME = ".alma-snapshots"
const SNAPSHOT_STALE_MS = 5 * 60 * 1000
const SNAPSHOT_SUBDIR_NAME = "snapshots"

interface SnapshotConfigFile {
  ignorePatterns: readonly string[]
  version: number
}

interface SnapshotHistoryEntry {
  id: string
  message: string
  parentId: string | null
  stats: {
    added: number
    deleted: number
    modified: number
  }
  timestamp: string
}

interface SnapshotPayload {
  id: string
  index: Record<string, string>
  message: string
  parentId: string | null
  stats: SnapshotHistoryEntry["stats"]
  timestamp: string
}

interface ProjectIgnoreRule {
  isDirectoryOnly: boolean
  isNegated: boolean
  matcher: RegExp
  pattern: string
  usesPathSegments: boolean
}

interface ParsedIgnorePattern {
  isAnchored: boolean
  isDirectoryOnly: boolean
  isNegated: boolean
  pattern: string
}

const DEFAULT_SNAPSHOT_CONFIG: SnapshotConfigFile = {
  ignorePatterns: DEFAULT_IGNORE_PATTERNS,
  version: SNAPSHOT_CONFIG_VERSION
}

const SYSTEM_DIRECTORY_IGNORE_NAMES = new Set([".alma-snapshots", ".git"])
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".cjs": "javascript",
  ".css": "css",
  ".cts": "typescript",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascriptreact",
  ".markdown": "markdown",
  ".md": "markdown",
  ".mjs": "javascript",
  ".mts": "typescript",
  ".py": "python",
  ".rs": "rust",
  ".sh": "shell",
  ".sql": "sql",
  ".svg": "svg",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".txt": "plaintext",
  ".vue": "vue",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml"
}
const MAX_FOLDER_CONTEXT_DOCUMENTS = 20
const MAX_MENTION_CONTEXT_CHARS = 24_000
const TEXT_EXTENSIONS = new Set(Object.keys(EXTENSION_LANGUAGE_MAP))

const normalizeRelativePath = (filePath: string, projectPath: string): string =>
  path.relative(projectPath, filePath).split(path.sep).join("/")

const buildSnapshotDirPath = (projectPath: string): string =>
  path.join(projectPath, SNAPSHOT_DIR_NAME)

const buildSnapshotConfigPath = (projectPath: string): string =>
  path.join(buildSnapshotDirPath(projectPath), "config.json")

const buildSnapshotHistoryPath = (projectPath: string): string =>
  path.join(buildSnapshotDirPath(projectPath), "history.json")

const buildSnapshotIndexPath = (projectPath: string): string =>
  path.join(buildSnapshotDirPath(projectPath), "index.json")

const buildSnapshotJsonPath = (
  projectPath: string,
  snapshotId: string
): string =>
  path.join(
    buildSnapshotDirPath(projectPath),
    SNAPSHOT_SUBDIR_NAME,
    `${snapshotId}.json`
  )

const buildSnapshotDocumentsPath = (
  projectPath: string,
  snapshotId: string
): string =>
  path.join(
    buildSnapshotDirPath(projectPath),
    AGENT_DOCUMENTS_DIR_NAME,
    `${snapshotId}.json`
  )

const ensureSnapshotDirectoryLayout = (projectPath: string): void => {
  fs.mkdirSync(buildSnapshotDirPath(projectPath), { recursive: true })
  fs.mkdirSync(
    path.join(buildSnapshotDirPath(projectPath), SNAPSHOT_SUBDIR_NAME),
    { recursive: true }
  )
  fs.mkdirSync(
    path.join(buildSnapshotDirPath(projectPath), AGENT_DOCUMENTS_DIR_NAME),
    { recursive: true }
  )

  if (!fs.existsSync(buildSnapshotConfigPath(projectPath))) {
    fs.writeFileSync(
      buildSnapshotConfigPath(projectPath),
      JSON.stringify(DEFAULT_SNAPSHOT_CONFIG, null, 2)
    )
  }
}

const readJsonFile = <TValue>(filePath: string): TValue | undefined => {
  if (!fs.existsSync(filePath)) {
    return undefined
  }

  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as TValue
}

const readSnapshotHistory = (projectPath: string): SnapshotHistoryEntry[] =>
  readJsonFile<SnapshotHistoryEntry[]>(buildSnapshotHistoryPath(projectPath)) ??
  []

const readSnapshotIndex = (projectPath: string): Record<string, string> =>
  readJsonFile<Record<string, string>>(buildSnapshotIndexPath(projectPath)) ??
  {}

const readSnapshotConfig = (projectPath: string): SnapshotConfigFile => {
  const config = readJsonFile<Partial<SnapshotConfigFile>>(
    buildSnapshotConfigPath(projectPath)
  )
  const ignorePatterns = Array.isArray(config?.ignorePatterns)
    ? config.ignorePatterns.filter((pattern) => typeof pattern === "string")
    : DEFAULT_IGNORE_PATTERNS

  return {
    ignorePatterns,
    version:
      typeof config?.version === "number"
        ? config.version
        : SNAPSHOT_CONFIG_VERSION
  }
}

const readSnapshotDocuments = (
  projectPath: string,
  snapshotId: string
): ProjectSnapshotDocument[] =>
  readJsonFile<ProjectSnapshotDocument[]>(
    buildSnapshotDocumentsPath(projectPath, snapshotId)
  ) ?? []

const readProjectGitignorePatterns = (projectPath: string): string[] => {
  const gitignorePath = path.join(projectPath, GITIGNORE_FILE_NAME)

  if (!fs.existsSync(gitignorePath)) {
    return []
  }

  return fs.readFileSync(gitignorePath, "utf-8").split("\n")
}

const getLatestSnapshotEntry = (
  projectPath: string
): SnapshotHistoryEntry | undefined => readSnapshotHistory(projectPath).at(-1)

const REGEXP_SPECIAL_CHARS = new Set([
  "\\",
  "^",
  "$",
  "+",
  "?",
  ".",
  "(",
  ")",
  "|",
  "{",
  "}",
  "[",
  "]"
])

const escapeRegexChar = (char: string): string =>
  REGEXP_SPECIAL_CHARS.has(char) ? `\\${char}` : char

const buildGlobMatcher = (pattern: string): RegExp => {
  let source = ""

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]

    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*"
        index += 1
        continue
      }

      source += "[^/]*"
      continue
    }

    if (char === "?") {
      source += "[^/]"
      continue
    }

    if (char === "[") {
      const closingIndex = pattern.indexOf("]", index + 1)

      if (closingIndex > index + 1) {
        const characterClass = pattern.slice(index + 1, closingIndex)
        const normalizedClass = characterClass.startsWith("!")
          ? `^${characterClass.slice(1)}`
          : characterClass

        source += `[${normalizedClass}]`
        index = closingIndex
        continue
      }
    }

    source += escapeRegexChar(char)
  }

  return new RegExp(`^${source}$`, "u")
}

const parseIgnorePattern = (line: string): ParsedIgnorePattern | undefined => {
  const trimmedLine = line.replace(/\r$/u, "").trim()

  if (!trimmedLine || trimmedLine.startsWith("#")) {
    return undefined
  }

  let pattern = trimmedLine
  let isNegated = false

  if (pattern.startsWith("!")) {
    isNegated = true
    pattern = pattern.slice(1).trim()
  }

  pattern = pattern
    .replaceAll("\\#", "#")
    .replaceAll("\\!", "!")
    .replaceAll("\\ ", " ")

  if (!pattern || pattern === "/") {
    return undefined
  }

  const isAnchored = pattern.startsWith("/")
  let isDirectoryOnly = pattern.endsWith("/")

  pattern = pattern.replace(/^\/+/u, "").replace(/\/+$/u, "")

  if (pattern.endsWith("/**")) {
    pattern = pattern.slice(0, -3)
    isDirectoryOnly = true
  }

  if (!pattern) {
    return undefined
  }

  return {
    isAnchored,
    isDirectoryOnly,
    isNegated,
    pattern
  }
}

const buildProjectIgnoreRule = (
  line: string
): ProjectIgnoreRule | undefined => {
  const parsedPattern = parseIgnorePattern(line)

  if (!parsedPattern) {
    return undefined
  }

  try {
    return {
      isDirectoryOnly: parsedPattern.isDirectoryOnly,
      isNegated: parsedPattern.isNegated,
      matcher: buildGlobMatcher(parsedPattern.pattern),
      pattern: parsedPattern.pattern,
      usesPathSegments:
        parsedPattern.isAnchored || parsedPattern.pattern.includes("/")
    }
  } catch {
    return undefined
  }
}

const buildProjectIgnoreRules = (projectPath: string): ProjectIgnoreRule[] => {
  const snapshotConfig = readSnapshotConfig(projectPath)
  const projectGitignorePatterns = readProjectGitignorePatterns(projectPath)
  const ignorePatterns = [
    ...snapshotConfig.ignorePatterns,
    ...projectGitignorePatterns
  ]

  return ignorePatterns
    .map(buildProjectIgnoreRule)
    .filter((rule): rule is ProjectIgnoreRule => rule !== undefined)
}

const doesSegmentIgnoreRuleMatch = ({
  isDirectory,
  relativePath,
  rule
}: {
  isDirectory: boolean
  relativePath: string
  rule: ProjectIgnoreRule
}): boolean => {
  const segments = relativePath.split("/")
  const lastIndex = segments.length - 1

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]

    if (!rule.matcher.test(segment)) {
      continue
    }

    const matchesAncestorDirectory = index < lastIndex

    if (!rule.isDirectoryOnly || isDirectory || matchesAncestorDirectory) {
      return true
    }
  }

  return false
}

const doesPathIgnoreRuleMatch = ({
  isDirectory,
  relativePath,
  rule
}: {
  isDirectory: boolean
  relativePath: string
  rule: ProjectIgnoreRule
}): boolean => {
  const pathParts = relativePath.split("/")

  for (let index = pathParts.length; index > 0; index -= 1) {
    const candidatePath = pathParts.slice(0, index).join("/")

    if (!rule.matcher.test(candidatePath)) {
      continue
    }

    const matchesAncestorDirectory = index < pathParts.length

    if (!rule.isDirectoryOnly || isDirectory || matchesAncestorDirectory) {
      return true
    }
  }

  return false
}

const doesIgnoreRuleMatch = ({
  isDirectory,
  relativePath,
  rule
}: {
  isDirectory: boolean
  relativePath: string
  rule: ProjectIgnoreRule
}): boolean =>
  rule.usesPathSegments
    ? doesPathIgnoreRuleMatch({
        isDirectory,
        relativePath,
        rule
      })
    : doesSegmentIgnoreRuleMatch({
        isDirectory,
        relativePath,
        rule
      })

const isIgnoredFilePath = ({
  ignoreRules,
  isDirectory,
  name,
  relativePath
}: {
  ignoreRules: readonly ProjectIgnoreRule[]
  isDirectory: boolean
  name: string
  relativePath: string
}): boolean => {
  if (relativePath === "") {
    return false
  }

  if (SYSTEM_DIRECTORY_IGNORE_NAMES.has(name)) {
    return true
  }

  let isIgnored = false

  for (const rule of ignoreRules) {
    if (
      doesIgnoreRuleMatch({
        isDirectory,
        relativePath,
        rule
      })
    ) {
      isIgnored = !rule.isNegated
    }
  }

  return isIgnored
}

const collectProjectFiles = (projectPath: string): string[] => {
  const discoveredFiles: string[] = []
  const ignoreRules = buildProjectIgnoreRules(projectPath)

  const walk = (currentPath: string) => {
    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .toSorted((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name)
      const relativePath = normalizeRelativePath(absolutePath, projectPath)

      if (
        isIgnoredFilePath({
          ignoreRules,
          isDirectory: entry.isDirectory(),
          name: entry.name,
          relativePath
        })
      ) {
        continue
      }

      if (entry.isDirectory()) {
        walk(absolutePath)
        continue
      }

      if (entry.isFile()) {
        discoveredFiles.push(absolutePath)
      }
    }
  }

  walk(projectPath)

  return discoveredFiles
}

const buildSha256 = (buffer: Buffer): string =>
  crypto.createHash("sha256").update(buffer).digest("hex")

const normalizePreviewText = (text: string): string =>
  text.replaceAll("\r\n", "\n").replaceAll(NULL_BYTE, "").trim()

const normalizeProjectFileQuery = (query: string): string =>
  query
    .trim()
    .toLowerCase()
    .replace(/^@/u, "")
    .replace(/^(?:\.\/|\/)+/u, "")

const clampProjectSnapshotListLimit = (limit: number | undefined): number => {
  if (!limit) {
    return DEFAULT_PROJECT_SNAPSHOT_LIST_LIMIT
  }

  return Math.min(Math.max(limit, 1), MAX_PROJECT_SNAPSHOT_LIST_LIMIT)
}

const compareProjectSnapshotItems = <
  TItem extends {
    relativePath: string
  }
>(
  left: TItem,
  right: TItem
): number => left.relativePath.localeCompare(right.relativePath)

const getAncestorDirectoryPaths = (relativePath: string): string[] => {
  const pathParts = relativePath.split("/")

  if (pathParts.length <= 1) {
    return []
  }

  const directoryPaths: string[] = []

  for (let index = 1; index < pathParts.length; index += 1) {
    directoryPaths.push(pathParts.slice(0, index).join("/"))
  }

  return directoryPaths
}

const matchesProjectSnapshotQuery = (
  relativePath: string,
  normalizedQuery: string
): boolean => {
  if (!normalizedQuery) {
    return true
  }

  return (
    path.posix.basename(relativePath).toLowerCase().includes(normalizedQuery) ||
    relativePath.toLowerCase().includes(normalizedQuery)
  )
}

const isTextFile = (filePath: string, buffer: Buffer): boolean => {
  const extension = path.extname(filePath).toLowerCase()

  if (TEXT_EXTENSIONS.has(extension)) {
    return true
  }

  return !buffer.includes(0)
}

const inferLanguage = (filePath: string): string | null =>
  EXTENSION_LANGUAGE_MAP[path.extname(filePath).toLowerCase()] ?? null

const buildProjectSnapshotDocument = (
  filePath: string,
  projectPath: string,
  buffer: Buffer,
  stats: fs.Stats
): ProjectSnapshotDocument => {
  const normalizedPreview = normalizePreviewText(
    buffer.toString("utf-8")
  ).slice(0, PREVIEW_CHAR_COUNT)

  return {
    chunkCount:
      normalizedPreview.length === 0
        ? 0
        : Math.ceil(normalizedPreview.length / CHUNK_CHAR_COUNT),
    embeddingRef: undefined,
    embeddingState: undefined,
    language: inferLanguage(filePath),
    mtimeMs: stats.mtimeMs,
    path: filePath,
    preview: normalizedPreview,
    relativePath: normalizeRelativePath(filePath, projectPath),
    sha256: buildSha256(buffer),
    size: stats.size
  }
}

const calculateSnapshotStats = ({
  currentIndex,
  previousIndex
}: {
  currentIndex: Record<string, string>
  previousIndex: Record<string, string>
}): SnapshotHistoryEntry["stats"] => {
  let added = 0
  let deleted = 0
  let modified = 0

  for (const [relativePath, nextHash] of Object.entries(currentIndex)) {
    const previousHash = previousIndex[relativePath]

    if (!previousHash) {
      added += 1
      continue
    }

    if (previousHash !== nextHash) {
      modified += 1
    }
  }

  for (const relativePath of Object.keys(previousIndex)) {
    if (!(relativePath in currentIndex)) {
      deleted += 1
    }
  }

  return { added, deleted, modified }
}

const createSnapshotId = (): string => crypto.randomBytes(8).toString("hex")

const buildProjectSnapshotFolderItems = ({
  documents,
  projectPath,
  snapshotId
}: {
  documents: ProjectSnapshotDocument[]
  projectPath: string
  snapshotId: string
}): ProjectSnapshotFolderItem[] => {
  const foldersByRelativePath = new Map<string, ProjectSnapshotFolderItem>()

  for (const document of documents) {
    for (const relativePath of getAncestorDirectoryPaths(
      document.relativePath
    )) {
      const existingFolder = foldersByRelativePath.get(relativePath)

      if (existingFolder) {
        foldersByRelativePath.set(relativePath, {
          ...existingFolder,
          fileCount: existingFolder.fileCount + 1
        })
        continue
      }

      foldersByRelativePath.set(relativePath, {
        fileCount: 1,
        kind: "folder",
        path: path.join(projectPath, relativePath),
        relativePath,
        snapshotId
      })
    }
  }

  return [...foldersByRelativePath.values()].toSorted(
    compareProjectSnapshotItems
  )
}

const rebuildProjectSnapshot = (projectPath: string): ProjectSnapshotState => {
  ensureSnapshotDirectoryLayout(projectPath)

  const previousEntry = getLatestSnapshotEntry(projectPath)
  const previousIndex = readSnapshotIndex(projectPath)
  const index: Record<string, string> = {}
  const documents: ProjectSnapshotDocument[] = []
  const timestamp = new Date().toISOString()

  for (const filePath of collectProjectFiles(projectPath)) {
    const stats = fs.statSync(filePath)
    const buffer = fs.readFileSync(filePath)
    const relativePath = normalizeRelativePath(filePath, projectPath)
    const sha256 = buildSha256(buffer)

    index[relativePath] = sha256

    if (!isTextFile(filePath, buffer)) {
      continue
    }

    documents.push(
      buildProjectSnapshotDocument(filePath, projectPath, buffer, stats)
    )
  }

  const snapshotId = createSnapshotId()
  const nextHistoryEntry: SnapshotHistoryEntry = {
    id: snapshotId,
    message: "auto refresh for chat context",
    parentId: previousEntry?.id ?? null,
    stats: calculateSnapshotStats({
      currentIndex: index,
      previousIndex
    }),
    timestamp
  }
  const snapshotPayload: SnapshotPayload = {
    id: snapshotId,
    index,
    message: nextHistoryEntry.message,
    parentId: nextHistoryEntry.parentId,
    stats: nextHistoryEntry.stats,
    timestamp
  }
  const nextHistory = [...readSnapshotHistory(projectPath), nextHistoryEntry]

  fs.writeFileSync(
    buildSnapshotIndexPath(projectPath),
    JSON.stringify(index, null, 2)
  )
  fs.writeFileSync(
    buildSnapshotHistoryPath(projectPath),
    JSON.stringify(nextHistory, null, 2)
  )
  fs.writeFileSync(
    buildSnapshotJsonPath(projectPath, snapshotId),
    JSON.stringify(snapshotPayload, null, 2)
  )
  fs.writeFileSync(
    buildSnapshotDocumentsPath(projectPath, snapshotId),
    JSON.stringify(documents, null, 2)
  )

  return {
    projectPath,
    refreshedAt: timestamp,
    snapshotId
  }
}

const shouldRefreshSnapshot = (projectPath: string): boolean => {
  const latestSnapshot = getLatestSnapshotEntry(projectPath)

  if (!latestSnapshot) {
    return true
  }

  const snapshotAgeMs =
    Date.now() - new Date(latestSnapshot.timestamp).getTime()

  if (snapshotAgeMs > SNAPSHOT_STALE_MS) {
    return true
  }

  if (
    !fs.existsSync(buildSnapshotDocumentsPath(projectPath, latestSnapshot.id))
  ) {
    return true
  }

  if (!fs.existsSync(buildSnapshotJsonPath(projectPath, latestSnapshot.id))) {
    return true
  }

  return !fs.existsSync(buildSnapshotIndexPath(projectPath))
}

export const ensureProjectSnapshot = (
  projectPath: string
): ProjectSnapshotState => {
  const normalizedProjectPath = path.resolve(projectPath)

  ensureSnapshotDirectoryLayout(normalizedProjectPath)

  if (!shouldRefreshSnapshot(normalizedProjectPath)) {
    const latestSnapshot = getLatestSnapshotEntry(normalizedProjectPath)

    if (!latestSnapshot) {
      throw new Error("Project snapshot history is unexpectedly empty.")
    }

    return {
      projectPath: normalizedProjectPath,
      refreshedAt: latestSnapshot.timestamp,
      snapshotId: latestSnapshot.id
    }
  }

  return rebuildProjectSnapshot(normalizedProjectPath)
}

export const listProjectSnapshotFiles = ({
  limit,
  projectPath,
  query
}: {
  limit?: number
  projectPath: string
  query: string
}): ListProjectSnapshotFilesOutput => {
  const snapshotState = ensureProjectSnapshot(projectPath)
  const itemLimit = clampProjectSnapshotListLimit(limit)
  const normalizedQuery = normalizeProjectFileQuery(query)
  const documents = readSnapshotDocuments(
    snapshotState.projectPath,
    snapshotState.snapshotId
  )
  const folders = buildProjectSnapshotFolderItems({
    documents,
    projectPath: snapshotState.projectPath,
    snapshotId: snapshotState.snapshotId
  }).filter((folder) =>
    matchesProjectSnapshotQuery(folder.relativePath, normalizedQuery)
  )
  const files = documents
    .filter((document) =>
      matchesProjectSnapshotQuery(document.relativePath, normalizedQuery)
    )
    .toSorted(compareProjectSnapshotItems)
    .map<ProjectSnapshotFileItem>((document) => ({
      kind: "file",
      language: document.language,
      mtimeMs: document.mtimeMs,
      path: document.path,
      relativePath: document.relativePath,
      size: document.size,
      snapshotId: snapshotState.snapshotId
    }))
  const items: ProjectSnapshotItem[] = [...folders, ...files].slice(
    0,
    itemLimit
  )

  return {
    files: items,
    snapshotId: snapshotState.snapshotId
  }
}

const READ_FILE_MAX_SIZE = 5 * 1024 * 1024

export type ReadProjectFileFailureReason =
  | "binary-file"
  | "file-missing"
  | "io-error"
  | "not-file"
  | "outside-project"
  | "too-large"

export type ReadProjectFileResult =
  | { ok: true; value: ReadProjectFileOutput }
  | { message: string; ok: false; reason: ReadProjectFileFailureReason }

/**
 * Classifies a project file read without throwing so callers (e.g. the artifact
 * recovery ladder) can branch on the failure reason. {@link readProjectFile} is
 * the thin throwing wrapper that preserves the exact historic error messages.
 */
export const readProjectFileResult = ({
  filePath,
  projectPath
}: {
  filePath: string
  projectPath: string
}): ReadProjectFileResult => {
  const resolvedPath = path.resolve(projectPath, filePath)
  const normalizedProjectPath = path.resolve(projectPath)

  if (!resolvedPath.startsWith(normalizedProjectPath + path.sep)) {
    return {
      message: "File path is outside the project directory.",
      ok: false,
      reason: "outside-project"
    }
  }

  if (!fs.existsSync(resolvedPath)) {
    return {
      message: `File not found: ${filePath}`,
      ok: false,
      reason: "file-missing"
    }
  }

  let stats: fs.Stats

  try {
    stats = fs.statSync(resolvedPath)
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to read file.",
      ok: false,
      reason: "io-error"
    }
  }

  if (!stats.isFile()) {
    return {
      message: `Not a file: ${filePath}`,
      ok: false,
      reason: "not-file"
    }
  }

  if (stats.size > READ_FILE_MAX_SIZE) {
    return {
      message: `File too large (${Math.round(stats.size / 1024)}KB). Maximum supported size is ${READ_FILE_MAX_SIZE / 1024}KB.`,
      ok: false,
      reason: "too-large"
    }
  }

  let buffer: Buffer

  try {
    buffer = fs.readFileSync(resolvedPath)
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Failed to read file.",
      ok: false,
      reason: "io-error"
    }
  }

  if (!isTextFile(resolvedPath, buffer)) {
    return {
      message: "Binary files are not supported.",
      ok: false,
      reason: "binary-file"
    }
  }

  return {
    ok: true,
    value: {
      content: buffer.toString("utf-8"),
      language: inferLanguage(resolvedPath),
      relativePath: normalizeRelativePath(resolvedPath, normalizedProjectPath)
    }
  }
}

export const readProjectFile = (params: {
  filePath: string
  projectPath: string
}): ReadProjectFileOutput => {
  const result = readProjectFileResult(params)

  if (!result.ok) {
    throw new Error(result.message)
  }

  return result.value
}

const IMAGE_MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
}
const READ_BINARY_FILE_MAX_SIZE = 16 * 1024 * 1024

/**
 * Reads a project file as base64 for the renderer (e.g. image artifacts, which
 * the text {@link readProjectFile} rejects). Same project-root containment
 * check; the media type is inferred from the extension.
 */
export const readProjectBinaryFile = ({
  filePath,
  projectPath
}: {
  filePath: string
  projectPath: string
}): ReadProjectBinaryFileOutput => {
  const resolvedPath = path.resolve(projectPath, filePath)
  const normalizedProjectPath = path.resolve(projectPath)

  if (!resolvedPath.startsWith(normalizedProjectPath + path.sep)) {
    throw new Error("File path is outside the project directory.")
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const stats = fs.statSync(resolvedPath)

  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`)
  }

  if (stats.size > READ_BINARY_FILE_MAX_SIZE) {
    throw new Error(
      `File too large (${Math.round(stats.size / 1024)}KB). Maximum supported size is ${READ_BINARY_FILE_MAX_SIZE / 1024}KB.`
    )
  }

  const buffer = fs.readFileSync(resolvedPath)
  const extension = path.extname(resolvedPath).toLowerCase()

  return {
    base64: buffer.toString("base64"),
    byteLength: buffer.byteLength,
    mediaType:
      IMAGE_MEDIA_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream",
    relativePath: normalizeRelativePath(resolvedPath, normalizedProjectPath)
  }
}

const buildDocumentMentionSection = (
  document: ProjectSnapshotDocument
): string =>
  `<file path="${document.relativePath}" language="${document.language ?? "unknown"}">\n${document.preview}\n</file>`

const getFolderMentionDocuments = (
  documents: ProjectSnapshotDocument[],
  relativePath: string
): ProjectSnapshotDocument[] =>
  documents
    .filter((document) =>
      document.relativePath.startsWith(`${relativePath.replace(/\/+$/u, "")}/`)
    )
    .toSorted(compareProjectSnapshotItems)
    .slice(0, MAX_FOLDER_CONTEXT_DOCUMENTS)

export const buildMentionContext = ({
  mentions,
  projectPath
}: {
  mentions: ChatMention[]
  projectPath: string
}): { snapshotId: string; system: string | undefined } => {
  const snapshotState = ensureProjectSnapshot(projectPath)

  if (mentions.length === 0) {
    return { snapshotId: snapshotState.snapshotId, system: undefined }
  }

  const documents = readSnapshotDocuments(
    snapshotState.projectPath,
    snapshotState.snapshotId
  )
  const documentsByRelativePath = new Map(
    documents.map((document) => [document.relativePath, document])
  )
  const referencedRelativePaths = new Set<string>()
  const referencedSections: string[] = []
  let remainingContextChars = MAX_MENTION_CONTEXT_CHARS

  const appendDocumentSection = (
    document: ProjectSnapshotDocument
  ): boolean => {
    if (referencedRelativePaths.has(document.relativePath)) {
      return false
    }

    const section = buildDocumentMentionSection(document)

    if (section.length > remainingContextChars) {
      return false
    }

    referencedRelativePaths.add(document.relativePath)
    referencedSections.push(section)
    remainingContextChars -= section.length

    return true
  }

  for (const mention of mentions) {
    if (mention.kind === "skill") {
      continue
    }

    if (mention.kind === "file") {
      const document = documentsByRelativePath.get(mention.relativePath)

      if (document) {
        appendDocumentSection(document)
      }

      continue
    }

    const folderSections: string[] = []

    for (const document of getFolderMentionDocuments(
      documents,
      mention.relativePath
    )) {
      if (referencedRelativePaths.has(document.relativePath)) {
        continue
      }

      const section = buildDocumentMentionSection(document)

      if (section.length > remainingContextChars) {
        break
      }

      referencedRelativePaths.add(document.relativePath)
      folderSections.push(section)
      remainingContextChars -= section.length
    }

    if (folderSections.length > 0) {
      referencedSections.push(
        `<folder path="${mention.relativePath}">\n${folderSections.join("\n\n")}\n</folder>`
      )
    }
  }

  if (referencedSections.length === 0) {
    return { snapshotId: snapshotState.snapshotId, system: undefined }
  }

  return {
    snapshotId: snapshotState.snapshotId,
    system: [
      "You are working inside a local desktop project context.",
      `Project path: ${snapshotState.projectPath}`,
      `Snapshot id: ${snapshotState.snapshotId}`,
      "Referenced project files and folders:",
      referencedSections.join("\n\n")
    ].join("\n")
  }
}
