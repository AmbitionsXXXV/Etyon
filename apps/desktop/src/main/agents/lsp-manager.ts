import { spawn } from "node:child_process"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import fsSync from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { AgentLspSettings } from "@etyon/rpc"

import type { AgentFileSystem } from "@/main/agents/execution-env"
import type {
  WorkspaceSandbox,
  WorkspaceSandboxSpawnConfig
} from "@/main/agents/workspace-sandbox"

type LspJsonValue =
  | boolean
  | null
  | number
  | string
  | LspJsonValue[]
  | {
      [key: string]: LspJsonValue | undefined
    }

interface LspJsonRpcError {
  code: number
  message: string
}

interface LspJsonRpcMessage {
  error?: LspJsonRpcError
  id?: number | string | null
  method?: string
  params?: LspJsonValue
  result?: LspJsonValue
}

interface LspPendingRequest {
  reject: (error: Error) => void
  resolve: (value: LspJsonValue | undefined) => void
  timeout: NodeJS.Timeout
}

export interface LspProcess {
  kill: (signal?: NodeJS.Signals) => boolean | undefined
  once: (
    event: "close" | "error" | "exit",
    listener: (...args: unknown[]) => void
  ) => unknown
  pid?: number
  stderr?: NodeJS.ReadableStream
  stdin: NodeJS.WritableStream
  stdout: NodeJS.ReadableStream
}

export interface LspProcessManager {
  spawn: (config: WorkspaceSandboxSpawnConfig) => LspProcess
}

export interface LspDiagnostic {
  code?: number | string
  column: number
  line: number
  message: string
  severity: "error" | "hint" | "information" | "unknown" | "warning"
  source?: string
}

export interface LspLocation {
  column: number
  line: number
  path: string
}

export interface LspInspectInput {
  line: number
  match: string
  path: string
}

export interface LspInspectResult {
  column: number
  definition: LspLocation[]
  diagnostics: LspDiagnostic[]
  error?: string
  hover: string | null
  implementation: LspLocation[]
  line: number
  path: string
  status: "failed" | "success" | "timeout" | "unavailable" | "unsupported"
}

export interface AgentLspManager {
  cleanup: () => Promise<void>
  inspect: (input: LspInspectInput) => Promise<LspInspectResult>
}

export interface AgentLspEvent {
  payload: unknown
  type: "lsp_diagnostics_collected" | "lsp_server_started"
}

export interface CreateAgentLspManagerOptions {
  eventSink?: (event: AgentLspEvent) => Promise<void> | void
  fileSystem: AgentFileSystem
  processManager?: LspProcessManager
  projectPath: string
  sandbox: WorkspaceSandbox
  settings: AgentLspSettings
}

interface LspClientState {
  cleanup: () => Promise<void>
  connection: LspRpcConnection
  diagnosticsByUri: Map<string, LspDiagnostic[]>
  openedUris: Set<string>
  process: LspProcess
}

const CONTENT_LENGTH_PATTERN = /Content-Length:\s*(\d+)/iu
const HEADER_SEPARATOR = "\r\n\r\n"
const HEADER_SEPARATOR_BYTE_LENGTH = Buffer.byteLength(HEADER_SEPARATOR)
const JSON_RPC_VERSION = "2.0"
const TYPESCRIPT_LANGUAGE_SERVER_NAME = "typescript-language-server"
const TYPESCRIPT_LSP_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx"
])

const defaultProcessManager: LspProcessManager = {
  spawn: (config) =>
    spawn(config.command, config.args, {
      cwd: config.cwd,
      env: config.env,
      stdio: ["pipe", "pipe", "pipe"]
    }) as ChildProcessWithoutNullStreams
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const asRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null

const quoteShellArg = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`

const getLanguageId = (filePath: string): string | null => {
  const extension = path.extname(filePath)

  switch (extension) {
    case ".cjs":
    case ".js":
    case ".mjs": {
      return "javascript"
    }
    case ".jsx": {
      return "javascriptreact"
    }
    case ".cts":
    case ".mts":
    case ".ts": {
      return "typescript"
    }
    case ".tsx": {
      return "typescriptreact"
    }
    default: {
      return null
    }
  }
}

const getLocalTypescriptLanguageServerPath = (projectPath: string): string => {
  const executableName =
    process.platform === "win32"
      ? `${TYPESCRIPT_LANGUAGE_SERVER_NAME}.cmd`
      : TYPESCRIPT_LANGUAGE_SERVER_NAME

  return path.join(projectPath, "node_modules", ".bin", executableName)
}

const resolveTypescriptLanguageServerCommand = (
  projectPath: string
): string => {
  const localServerPath = getLocalTypescriptLanguageServerPath(projectPath)

  return fsSync.existsSync(localServerPath)
    ? localServerPath
    : TYPESCRIPT_LANGUAGE_SERVER_NAME
}

const toFileUri = (filePath: string): string =>
  pathToFileURL(filePath).toString()

const fromFileUri = (uri: string): string => fileURLToPath(uri)

const toProjectRelativePath = ({
  projectPath,
  targetPath
}: {
  projectPath: string
  targetPath: string
}): string => {
  const relativePath = path.relative(projectPath, targetPath)

  return relativePath.split(path.sep).join("/") || "."
}

const toPositionParams = ({
  character,
  uri,
  zeroBasedLine
}: {
  character: number
  uri: string
  zeroBasedLine: number
}): LspJsonValue => ({
  position: {
    character,
    line: zeroBasedLine
  },
  textDocument: {
    uri
  }
})

const getMarkerColumn = (match: string): number => {
  const markerIndex = match.indexOf("<<<")

  if (markerIndex === -1) {
    throw new Error("inspect match must include the <<< cursor marker.")
  }

  return markerIndex + 1
}

const normalizeDiagnosticSeverity = (
  severity: unknown
): LspDiagnostic["severity"] => {
  switch (severity) {
    case 1: {
      return "error"
    }
    case 2: {
      return "warning"
    }
    case 3: {
      return "information"
    }
    case 4: {
      return "hint"
    }
    default: {
      return "unknown"
    }
  }
}

const getPositionLine = (value: unknown): number => {
  const record = asRecord(value)
  const line = record?.line

  return typeof line === "number" ? line : 0
}

const getPositionCharacter = (value: unknown): number => {
  const record = asRecord(value)
  const character = record?.character

  return typeof character === "number" ? character : 0
}

const convertDiagnostic = (diagnostic: unknown): LspDiagnostic | null => {
  const record = asRecord(diagnostic)
  const range = asRecord(record?.range)
  const start = asRecord(range?.start)

  if (!record || !range || !start || typeof record.message !== "string") {
    return null
  }

  const code =
    typeof record.code === "string" || typeof record.code === "number"
      ? record.code
      : undefined
  const source = typeof record.source === "string" ? record.source : undefined

  return {
    ...(code === undefined ? {} : { code }),
    column: getPositionCharacter(start) + 1,
    line: getPositionLine(start) + 1,
    message: record.message,
    severity: normalizeDiagnosticSeverity(record.severity),
    ...(source ? { source } : {})
  }
}

const convertDiagnostics = (diagnostics: unknown): LspDiagnostic[] => {
  if (!Array.isArray(diagnostics)) {
    return []
  }

  return diagnostics.flatMap((diagnostic) => {
    const convertedDiagnostic = convertDiagnostic(diagnostic)

    return convertedDiagnostic ? [convertedDiagnostic] : []
  })
}

const getCurrentLineDiagnostics = ({
  diagnostics,
  line
}: {
  diagnostics: LspDiagnostic[]
  line: number
}): LspDiagnostic[] =>
  diagnostics.filter((diagnostic) => diagnostic.line === line)

const normalizeHover = (hover: unknown): string | null => {
  const record = asRecord(hover)

  if (!record) {
    return null
  }

  const { contents } = record

  if (typeof contents === "string") {
    return contents
  }

  if (Array.isArray(contents)) {
    return contents
      .map((item) => normalizeHover({ contents: item }))
      .filter(Boolean)
      .join("\n\n")
  }

  const contentRecord = asRecord(contents)

  if (typeof contentRecord?.value === "string") {
    return contentRecord.value
  }

  return null
}

const getLocationTarget = (
  location: unknown
): { range: unknown; uri: string } | null => {
  const record = asRecord(location)

  if (!record) {
    return null
  }

  if (typeof record.uri === "string") {
    return {
      range: record.range,
      uri: record.uri
    }
  }

  if (typeof record.targetUri === "string") {
    return {
      range: record.targetSelectionRange ?? record.targetRange,
      uri: record.targetUri
    }
  }

  return null
}

const convertLocation = ({
  location,
  projectPath
}: {
  location: unknown
  projectPath: string
}): LspLocation | null => {
  const target = getLocationTarget(location)
  const range = asRecord(target?.range)
  const start = asRecord(range?.start)

  if (!target || !range || !start) {
    return null
  }

  return {
    column: getPositionCharacter(start) + 1,
    line: getPositionLine(start) + 1,
    path: toProjectRelativePath({
      projectPath,
      targetPath: fromFileUri(target.uri)
    })
  }
}

const convertLocations = ({
  locations,
  projectPath
}: {
  locations: unknown
  projectPath: string
}): LspLocation[] => {
  let locationValues: unknown[] = []

  if (Array.isArray(locations)) {
    locationValues = locations
  } else if (locations) {
    locationValues = [locations]
  }

  return locationValues.flatMap((location) => {
    const convertedLocation = convertLocation({
      location,
      projectPath
    })

    return convertedLocation ? [convertedLocation] : []
  })
}

const isUnsupportedPath = (filePath: string): boolean =>
  !TYPESCRIPT_LSP_EXTENSIONS.has(path.extname(filePath))

const openLspDocument = ({
  client,
  content,
  languageId,
  uri
}: {
  client: LspClientState
  content: string
  languageId: string
  uri: string
}): void => {
  if (client.openedUris.has(uri)) {
    client.connection.notify("textDocument/didChange", {
      contentChanges: [
        {
          text: content
        }
      ],
      textDocument: {
        uri,
        version: Date.now()
      }
    })
    return
  }

  client.openedUris.add(uri)
  client.connection.notify("textDocument/didOpen", {
    textDocument: {
      languageId,
      text: content,
      uri,
      version: 1
    }
  })
}

class LspRpcConnection {
  #buffer = Buffer.alloc(0)
  #nextId = 1
  #onNotification: (message: LspJsonRpcMessage) => void
  #pending = new Map<number, LspPendingRequest>()
  #process: LspProcess

  constructor({
    onNotification,
    process: lspProcess
  }: {
    onNotification: (message: LspJsonRpcMessage) => void
    process: LspProcess
  }) {
    this.#onNotification = onNotification
    this.#process = lspProcess
    this.#process.stdout.on("data", (chunk) => {
      this.#appendData(Buffer.from(chunk as Buffer))
    })
    this.#process.once("close", () => {
      this.#rejectPending("LSP server closed.")
    })
    this.#process.once("error", (error) => {
      this.#rejectPending(
        error instanceof Error ? error.message : "LSP server failed."
      )
    })
  }

  notify(method: string, params?: LspJsonValue): void {
    this.#write({
      jsonrpc: JSON_RPC_VERSION,
      method,
      ...(params === undefined ? {} : { params })
    })
  }

  request(
    method: string,
    params: LspJsonValue | undefined,
    timeoutMs: number
  ): Promise<LspJsonValue | undefined> {
    const id = this.#nextId
    this.#nextId += 1
    const { promise, reject, resolve } = Promise.withResolvers<
      LspJsonValue | undefined
    >()
    const timeout = setTimeout(() => {
      this.#pending.delete(id)
      reject(new Error(`LSP request timed out: ${method}`))
    }, timeoutMs)

    this.#pending.set(id, {
      reject,
      resolve,
      timeout
    })
    this.#write({
      id,
      jsonrpc: JSON_RPC_VERSION,
      method,
      ...(params === undefined ? {} : { params })
    })

    return promise
  }

  #appendData(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk])

    while (true) {
      const headerEndIndex = this.#buffer.indexOf(HEADER_SEPARATOR)

      if (headerEndIndex === -1) {
        return
      }

      const header = this.#buffer.subarray(0, headerEndIndex).toString("utf-8")
      const contentLengthMatch = CONTENT_LENGTH_PATTERN.exec(header)
      const contentLength = contentLengthMatch
        ? Number(contentLengthMatch[1])
        : Number.NaN
      const bodyStartIndex = headerEndIndex + HEADER_SEPARATOR_BYTE_LENGTH
      const messageEndIndex = bodyStartIndex + contentLength

      if (!Number.isFinite(contentLength) || contentLength < 0) {
        this.#buffer = Buffer.alloc(0)
        return
      }

      if (this.#buffer.length < messageEndIndex) {
        return
      }

      const body = this.#buffer
        .subarray(bodyStartIndex, messageEndIndex)
        .toString("utf-8")
      this.#buffer = this.#buffer.subarray(messageEndIndex)
      this.#handleMessage(JSON.parse(body) as LspJsonRpcMessage)
    }
  }

  #handleMessage(message: LspJsonRpcMessage): void {
    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id)

      if (!pending) {
        return
      }

      clearTimeout(pending.timeout)
      this.#pending.delete(message.id)

      if (message.error) {
        pending.reject(new Error(message.error.message))
        return
      }

      pending.resolve(message.result)
      return
    }

    this.#onNotification(message)
  }

  #rejectPending(message: string): void {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(message))
      this.#pending.delete(id)
    }
  }

  #write(message: LspJsonRpcMessage & { jsonrpc: string }): void {
    const content = JSON.stringify(message)
    const payload = `Content-Length: ${Buffer.byteLength(content, "utf-8")}\r\n\r\n${content}`

    this.#process.stdin.write(payload)
  }
}

const createUnavailableInspectResult = ({
  column,
  error,
  line,
  path: resultPath,
  status
}: {
  column: number
  error: string
  line: number
  path: string
  status: LspInspectResult["status"]
}): LspInspectResult => ({
  column,
  definition: [],
  diagnostics: [],
  error,
  hover: null,
  implementation: [],
  line,
  path: resultPath,
  status
})

const safeLspRequest = async (
  request: Promise<LspJsonValue | undefined>
): Promise<LspJsonValue | undefined> => {
  try {
    return await request
  } catch {
    return undefined
  }
}

export const createAgentLspManager = ({
  eventSink,
  fileSystem,
  processManager = defaultProcessManager,
  projectPath,
  sandbox,
  settings
}: CreateAgentLspManagerOptions): AgentLspManager => {
  const normalizedProjectPath = path.resolve(projectPath)
  let clientPromise: Promise<LspClientState> | null = null

  const startClient = async (): Promise<LspClientState> => {
    if (settings.requireSandbox && !sandbox.enabled) {
      throw new Error("LSP requires the workspace sandbox.")
    }

    const serverCommand = resolveTypescriptLanguageServerCommand(
      normalizedProjectPath
    )
    const preparedCommand = await sandbox.prepareShellCommand({
      command: `${quoteShellArg(serverCommand)} --stdio`,
      cwd: normalizedProjectPath,
      env: process.env
    })

    if (!preparedCommand.ok) {
      throw new Error(preparedCommand.error.message)
    }

    let sandboxCleanupPromise: Promise<void> | null = null
    const cleanupSandboxCommand = async (): Promise<void> => {
      sandboxCleanupPromise ??= preparedCommand.value.cleanup()

      await sandboxCleanupPromise
    }
    let lspProcess: LspProcess

    try {
      lspProcess = processManager.spawn(preparedCommand.value)
    } catch (error) {
      await cleanupSandboxCommand()
      throw error
    }

    lspProcess.once("close", () => {
      void cleanupSandboxCommand()
    })
    lspProcess.once("error", () => {
      void cleanupSandboxCommand()
    })

    const diagnosticsByUri = new Map<string, LspDiagnostic[]>()
    const connection = new LspRpcConnection({
      onNotification: (message) => {
        if (message.method !== "textDocument/publishDiagnostics") {
          return
        }

        const params = asRecord(message.params)
        const uri = typeof params?.uri === "string" ? params.uri : ""
        const diagnostics = convertDiagnostics(params?.diagnostics)

        diagnosticsByUri.set(uri, diagnostics)
        void eventSink?.({
          payload: {
            count: diagnostics.length,
            uri
          },
          type: "lsp_diagnostics_collected"
        })
      },
      process: lspProcess
    })

    await connection.request(
      "initialize",
      {
        capabilities: {
          textDocument: {
            definition: {},
            hover: {
              contentFormat: ["markdown", "plaintext"]
            },
            implementation: {},
            publishDiagnostics: {
              relatedInformation: false,
              versionSupport: false
            },
            synchronization: {
              didSave: false,
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false
            }
          },
          workspace: {
            workspaceFolders: true
          }
        },
        processId: process.pid,
        rootPath: normalizedProjectPath,
        rootUri: toFileUri(normalizedProjectPath),
        workspaceFolders: [
          {
            name: path.basename(normalizedProjectPath),
            uri: toFileUri(normalizedProjectPath)
          }
        ]
      },
      settings.initTimeoutMs
    )
    connection.notify("initialized", {})
    void eventSink?.({
      payload: {
        command: serverCommand,
        pid: lspProcess.pid ?? null
      },
      type: "lsp_server_started"
    })

    return {
      cleanup: cleanupSandboxCommand,
      connection,
      diagnosticsByUri,
      openedUris: new Set<string>(),
      process: lspProcess
    }
  }

  const getClient = (): Promise<LspClientState> => {
    clientPromise ??= startClient()

    return clientPromise
  }

  const inspect = async ({
    line,
    match,
    path: requestedPath
  }: LspInspectInput): Promise<LspInspectResult> => {
    const markerColumn = getMarkerColumn(match)
    const textFile = await fileSystem.readTextFile(requestedPath)

    if (!textFile.ok) {
      throw new Error(textFile.error.message)
    }

    const absolutePath = await fileSystem.absolutePath(requestedPath)

    if (!absolutePath.ok) {
      throw new Error(absolutePath.error.message)
    }

    const canonicalPath = await fileSystem.canonicalPath(requestedPath)
    const resultPath = canonicalPath.ok ? canonicalPath.value : requestedPath

    if (isUnsupportedPath(resultPath)) {
      return createUnavailableInspectResult({
        column: markerColumn,
        error: "No LSP server is configured for this file type.",
        line,
        path: resultPath,
        status: "unsupported"
      })
    }

    const languageId = getLanguageId(resultPath)

    if (!languageId) {
      return createUnavailableInspectResult({
        column: markerColumn,
        error: "Unsupported language id.",
        line,
        path: resultPath,
        status: "unsupported"
      })
    }

    let client: LspClientState

    try {
      client = await getClient()
    } catch (error) {
      return createUnavailableInspectResult({
        column: markerColumn,
        error: error instanceof Error ? error.message : "LSP server failed.",
        line,
        path: resultPath,
        status:
          error instanceof Error && error.message.includes("timed out")
            ? "timeout"
            : "unavailable"
      })
    }

    const uri = toFileUri(absolutePath.value)
    const zeroBasedLine = line - 1
    const zeroBasedCharacter = markerColumn - 1

    openLspDocument({
      client,
      content: textFile.value,
      languageId,
      uri
    })

    await safeLspRequest(
      client.connection.request(
        "textDocument/diagnostic",
        {
          textDocument: {
            uri
          }
        },
        settings.diagnosticTimeoutMs
      )
    )

    const positionParams = toPositionParams({
      character: zeroBasedCharacter,
      uri,
      zeroBasedLine
    })
    const [hover, definition, implementation] = await Promise.all([
      safeLspRequest(
        client.connection.request("textDocument/hover", positionParams, 5000)
      ),
      safeLspRequest(
        client.connection.request(
          "textDocument/definition",
          positionParams,
          5000
        )
      ),
      safeLspRequest(
        client.connection.request(
          "textDocument/implementation",
          positionParams,
          5000
        )
      )
    ])
    const diagnostics = getCurrentLineDiagnostics({
      diagnostics: client.diagnosticsByUri.get(uri) ?? [],
      line
    })

    return {
      column: markerColumn,
      definition: convertLocations({
        locations: definition,
        projectPath: normalizedProjectPath
      }),
      diagnostics,
      hover: normalizeHover(hover),
      implementation: convertLocations({
        locations: implementation,
        projectPath: normalizedProjectPath
      }),
      line,
      path: resultPath,
      status: "success"
    }
  }

  const cleanup = async (): Promise<void> => {
    const client = clientPromise ? await clientPromise.catch(() => null) : null

    client?.process.kill("SIGTERM")
    await client?.cleanup()
    clientPromise = null
  }

  return {
    cleanup,
    inspect
  }
}
