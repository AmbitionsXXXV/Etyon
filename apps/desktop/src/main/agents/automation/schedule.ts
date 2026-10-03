import type { AutomationSchedule } from "@etyon/rpc/schemas/automation"
import { Cron } from "croner"

const MINUTE_MS = 60_000

export const nextAutomationRunAt = (
  schedule: AutomationSchedule,
  after: Date
): string | null => {
  if (schedule.kind === "manual") {
    return null
  }
  if (schedule.kind === "interval") {
    return new Date(
      after.getTime() + schedule.minutes * MINUTE_MS
    ).toISOString()
  }
  // Validate the IANA zone even when the pattern never reaches date conversion.
  new Intl.DateTimeFormat("en", { timeZone: schedule.timeZone }).format(after)
  const cron = new Cron(schedule.expression, {
    mode: "5-part",
    paused: true,
    timezone: schedule.timeZone
  })
  try {
    const next = cron.nextRun(after)
    if (!next) {
      throw new Error("The cron schedule has no future occurrence.")
    }
    return next.toISOString()
  } finally {
    cron.stop()
  }
}
