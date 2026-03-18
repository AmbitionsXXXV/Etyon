export type LogLevel = "critical" | "debug" | "info"

export interface EnvironmentContext {
  app_version: string
  arch: string
  electron_version: string
  locale: string
  node_version: string
  platform: string
}

export interface LogEvent {
  _pendingRemote?: boolean
  duration_ms?: number
  environment?: EnvironmentContext
  event: string
  level: LogLevel
  timestamp: string
  [key: string]: unknown
}

export interface LogTransport {
  write: (event: LogEvent) => void
}
