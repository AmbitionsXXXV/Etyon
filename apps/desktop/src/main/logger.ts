import fs from "node:fs"
import path from "node:path"

import { platform } from "@electron-toolkit/utils"
import type {
  EnvironmentContext,
  LogEvent,
  LogTransport
} from "@etyon/logger/types"
import { app } from "electron"

const LOG_DIR = path.join(app.getPath("home"), ".etyon", "logs")
const MAX_LOG_AGE_DAYS = 30

const getDateString = () => new Date().toISOString().slice(0, 10)

const ensureLogDir = () => {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

const cleanOldLogs = () => {
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000

  try {
    for (const file of fs.readdirSync(LOG_DIR)) {
      if (!file.endsWith(".jsonl")) {
        continue
      }

      const filePath = path.join(LOG_DIR, file)
      const stat = fs.statSync(filePath)

      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath)
      }
    }
  } catch {
    // Best-effort cleanup
  }
}

const resolvePlatformName = (): string => {
  if (platform.isMacOS) {
    return "darwin"
  }
  if (platform.isWindows) {
    return "win32"
  }
  return "linux"
}

const buildEnvironmentContext = (): EnvironmentContext => ({
  app_version: app.getVersion(),
  arch: process.arch,
  electron_version: process.versions.electron,
  locale: app.getLocale(),
  node_version: process.versions.node,
  platform: resolvePlatformName()
})

const fileTransport: LogTransport = {
  write(event: LogEvent) {
    const filePath = path.join(LOG_DIR, `${getDateString()}.jsonl`)

    try {
      fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8")
    } catch {
      // Best-effort write
    }
  }
}

const remoteTransport: LogTransport = {
  write(_event: LogEvent) {
    // Placeholder — will be implemented when remote analytics service is ready
  }
}

let environment: EnvironmentContext | undefined

export const initLogger = () => {
  ensureLogDir()
  cleanOldLogs()
  environment = buildEnvironmentContext()
}

export const enrichLogEvent = (payload: LogEvent): LogEvent => {
  const enriched: LogEvent = {
    ...payload,
    environment
  }

  if (enriched.level === "critical") {
    enriched._pendingRemote = true
  }

  return enriched
}

export const dispatch = (event: LogEvent) => {
  fileTransport.write(event)

  if (event.level === "critical") {
    remoteTransport.write(event)
  }
}
