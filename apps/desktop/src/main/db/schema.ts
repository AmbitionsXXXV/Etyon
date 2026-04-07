import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const chatSessions = sqliteTable(
  "chat_sessions",
  {
    createdAt: text("created_at").notNull(),
    id: text("id").primaryKey(),
    lastOpenedAt: text("last_opened_at").notNull(),
    modelId: text("model_id"),
    pinnedAt: text("pinned_at"),
    projectPath: text("project_path").notNull(),
    title: text("title").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    lastOpenedAtIdx: index("chat_sessions_last_opened_at_idx").on(
      table.lastOpenedAt
    ),
    projectPathIdx: index("chat_sessions_project_path_idx").on(
      table.projectPath
    )
  })
)

export const schema = {
  chatSessions
} as const
