import type { LogEvent, LogLevel } from "./types"

type EmitFn = (event: LogEvent) => void

let emitFn: EmitFn | undefined

export const initLogger = (emit: EmitFn) => {
  emitFn = emit
}

const getEmit = (): EmitFn => {
  if (!emitFn) {
    throw new Error("Logger not initialized — call initLogger(emit) first")
  }
  return emitFn
}

const createEventBuilder = (eventName: string) => {
  const fields: Record<string, unknown> = {}
  const startTime = performance.now()

  const builder = {
    set(key: string, value: unknown) {
      fields[key] = value
      return builder
    },

    end(level: LogLevel = "info") {
      const durationMs = Math.round(performance.now() - startTime)

      const event: LogEvent = {
        ...fields,
        duration_ms: durationMs,
        event: eventName,
        level,
        timestamp: new Date().toISOString()
      }

      if (level === "critical") {
        event._pendingRemote = true
      }

      getEmit()(event)
    },

    debug() {
      builder.end("debug")
    },

    info() {
      builder.end("info")
    },

    critical() {
      builder.end("critical")
    }
  }

  return builder
}

const emitEvent = (
  event: string,
  level: LogLevel,
  fields: Record<string, unknown> = {}
) => {
  const logEvent: LogEvent = {
    ...fields,
    event,
    level,
    timestamp: new Date().toISOString()
  }

  if (level === "critical") {
    logEvent._pendingRemote = true
  }

  getEmit()(logEvent)
}

export const logger = {
  critical(event: string, fields: Record<string, unknown> = {}) {
    emitEvent(event, "critical", fields)
  },

  debug(event: string, fields: Record<string, unknown> = {}) {
    emitEvent(event, "debug", fields)
  },

  info(event: string, fields: Record<string, unknown> = {}) {
    emitEvent(event, "info", fields)
  },

  startEvent(name: string) {
    return createEventBuilder(name)
  }
}
