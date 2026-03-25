import { createLogger } from "./core"
import type { EmitFn } from "./core"

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

export const logger = createLogger((event) => {
  getEmit()(event)
})
