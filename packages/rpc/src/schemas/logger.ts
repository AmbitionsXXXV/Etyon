import * as z from "zod"

export const LogLevelSchema = z.enum(["critical", "debug", "info"])

export const LogEventSchema = z
  .object({
    _pendingRemote: z.boolean().optional(),
    duration_ms: z.number().optional(),
    event: z.string(),
    level: LogLevelSchema,
    timestamp: z.string()
  })
  .passthrough()
