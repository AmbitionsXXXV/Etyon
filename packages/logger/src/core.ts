import type { LogEvent, LogLevel } from "./types"

export type EmitFn = (event: LogEvent) => void
export type LoggerFields = Record<string, unknown>

export interface LoggerEventBuilder {
  critical: () => void
  debug: () => void
  end: (level?: LogLevel) => void
  error: () => void
  info: () => void
  merge: (fields: LoggerFields) => LoggerEventBuilder
  set: (key: string, value: unknown) => LoggerEventBuilder
}

export interface LoggerApi {
  critical: (event: string, fields?: LoggerFields) => void
  debug: (event: string, fields?: LoggerFields) => void
  error: (event: string, fields?: LoggerFields) => void
  info: (event: string, fields?: LoggerFields) => void
  startEvent: (name: string, initialFields?: LoggerFields) => LoggerEventBuilder
}

const buildLogEvent = (
  event: string,
  fields: LoggerFields,
  level: LogLevel
): LogEvent => {
  const logEvent: LogEvent = {
    ...fields,
    event,
    level,
    timestamp: new Date().toISOString()
  }

  if (level === "critical") {
    logEvent._pendingRemote = true
  }

  return logEvent
}

const emitEvent = (
  emit: EmitFn,
  event: string,
  level: LogLevel,
  fields: LoggerFields = {}
) => {
  emit(buildLogEvent(event, fields, level))
}

const createEventBuilder = (
  emit: EmitFn,
  eventName: string,
  initialFields: LoggerFields = {}
): LoggerEventBuilder => {
  const fields: LoggerFields = { ...initialFields }
  const startTime = performance.now()

  const builder: LoggerEventBuilder = {
    critical() {
      builder.end("critical")
    },

    debug() {
      builder.end("debug")
    },

    end(level: LogLevel = "info") {
      const durationMs = Math.round(performance.now() - startTime)

      emit(
        buildLogEvent(eventName, { ...fields, duration_ms: durationMs }, level)
      )
    },

    error() {
      builder.end("critical")
    },

    info() {
      builder.end("info")
    },

    merge(nextFields: LoggerFields) {
      Object.assign(fields, nextFields)
      return builder
    },

    set(key: string, value: unknown) {
      fields[key] = value
      return builder
    }
  }

  return builder
}

export const createLogger = (emit: EmitFn): LoggerApi => ({
  critical(event: string, fields: LoggerFields = {}) {
    emitEvent(emit, event, "critical", fields)
  },

  debug(event: string, fields: LoggerFields = {}) {
    emitEvent(emit, event, "debug", fields)
  },

  error(event: string, fields: LoggerFields = {}) {
    emitEvent(emit, event, "critical", fields)
  },

  info(event: string, fields: LoggerFields = {}) {
    emitEvent(emit, event, "info", fields)
  },

  startEvent(name: string, initialFields: LoggerFields = {}) {
    return createEventBuilder(emit, name, initialFields)
  }
})
