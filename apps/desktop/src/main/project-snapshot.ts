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
  ProjectSnapshotState
} from "@etyon/rpc"

const AGENT_DOCUMENTS_DIR_NAME = "documents"
const CHUNK_CHAR_COUNT = 2000
const DEFAULT_PROJECT_SNAPSHOT_LIST_LIMIT = 50
const DEFAULT_IGNORE_PATTERNS = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  ".next/**",
  "*.log",
  ".alma-snapshots/**",
  ".turbo/**",
  ".vite/**"
] as const
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

const DEFAULT_SNAPSHOT_CONFIG: SnapshotConfigFile = {
  ignorePatterns: DEFAULT_IGNORE_PATTERNS,
  version: SNAPSHOT_CONFIG_VERSION
}

const DIRECTORY_IGNORE_NAMES = new Set([
  ".alma-snapshots",
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "dist",
  "node_modules"
])
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

const readSnapshotDocuments = (
  projectPath: string,
  snapshotId: string
): ProjectSnapshotDocument[] =>
  readJsonFile<ProjectSnapshotDocument[]>(
    buildSnapshotDocumentsPath(projectPath, snapshotId)
  ) ?? []

const getLatestSnapshotEntry = (
  projectPath: string
): SnapshotHistoryEntry | undefined => readSnapshotHistory(projectPath).at(-1)

const isIgnoredFilePath = ({
  isDirectory,
  name,
  relativePath
}: {
  isDirectory: boolean
  name: string
  relativePath: string
}): boolean => {
  if (relativePath === "") {
    return false
  }

  if (name.endsWith(".log")) {
    return true
  }

  if (isDirectory) {
    return DIRECTORY_IGNORE_NAMES.has(name)
  }

  return relativePath.startsWith(`${SNAPSHOT_DIR_NAME}/`)
}

const collectProjectFiles = (projectPath: string): string[] => {
  const discoveredFiles: string[] = []

  const walk = (currentPath: string) => {
    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .toSorted((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name)
      const relativePath = normalizeRelativePath(absolutePath, projectPath)

      if (
        isIgnoredFilePath({
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

  return Math.min(Math.max(limit, 1), 100)
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
