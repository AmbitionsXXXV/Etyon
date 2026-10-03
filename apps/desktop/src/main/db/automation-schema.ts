import { sql } from "drizzle-orm"
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core"
import type { SQLiteColumn } from "drizzle-orm/sqlite-core"

export const defineAutomationTables = (chatSessions: { id: SQLiteColumn }) => {
  const automationTasks = sqliteTable(
    "automation_tasks",
    {
      createdAt: text("created_at").notNull(),
      enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
      id: text("id").primaryKey(),
      modelId: text("model_id"),
      name: text("name").notNull(),
      nextRunAt: text("next_run_at"),
      notifyDesktop: integer("notify_desktop", { mode: "boolean" })
        .notNull()
        .default(true),
      notifyTelegram: integer("notify_telegram", { mode: "boolean" })
        .notNull()
        .default(false),
      permissionMode: text("permission_mode", {
        enum: ["default", "acceptEdits"]
      }).notNull(),
      profileId: text("profile_id"),
      prompt: text("prompt").notNull(),
      scheduleJson: text("schedule_json").notNull(),
      sessionId: text("session_id")
        .notNull()
        .references(() => chatSessions.id, { onDelete: "cascade" }),
      timeoutMinutes: integer("timeout_minutes").notNull().default(30),
      updatedAt: text("updated_at").notNull()
    },
    (table) => ({
      dueIdx: index("automation_tasks_due_idx").on(
        table.enabled,
        table.nextRunAt
      ),
      sessionIdx: index("automation_tasks_session_idx").on(table.sessionId)
    })
  )

  const automationRuns = sqliteTable(
    "automation_runs",
    {
      agentRunId: text("agent_run_id"),
      error: text("error"),
      finishedAt: text("finished_at"),
      id: text("id").primaryKey(),
      notificationError: text("notification_error"),
      notifiedAt: text("notified_at"),
      sessionId: text("session_id")
        .notNull()
        .references(() => chatSessions.id, { onDelete: "cascade" }),
      startedAt: text("started_at").notNull(),
      status: text("status", {
        enum: [
          "cancelled",
          "failed",
          "interrupted",
          "running",
          "skipped",
          "succeeded",
          "suspended"
        ]
      }).notNull(),
      summary: text("summary"),
      taskId: text("task_id")
        .notNull()
        .references(() => automationTasks.id, { onDelete: "cascade" }),
      trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
      updatedAt: text("updated_at").notNull()
    },
    (table) => ({
      activeSessionIdx: uniqueIndex("automation_runs_active_session_idx")
        .on(table.sessionId)
        .where(sql`${table.status} in ('running', 'suspended')`),
      statusIdx: index("automation_runs_status_idx").on(table.status),
      taskStartedIdx: index("automation_runs_task_started_idx").on(
        table.taskId,
        table.startedAt
      )
    })
  )
  return { automationRuns, automationTasks }
}
