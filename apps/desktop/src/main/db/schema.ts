import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text
} from "drizzle-orm/sqlite-core"

export const chatSessions = sqliteTable(
  "chat_sessions",
  {
    archivedAt: text("archived_at"),
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

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    createdAt: text("created_at").notNull(),
    messageId: text("message_id").notNull(),
    metadataJson: text("metadata_json"),
    partsJson: text("parts_json").notNull(),
    role: text("role", {
      enum: ["assistant", "system", "user"]
    }).notNull(),
    sequence: integer("sequence").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.sessionId, table.messageId]
    }),
    sessionSequenceIdx: index("chat_messages_session_sequence_idx").on(
      table.sessionId,
      table.sequence
    )
  })
)

export const chatSessionMemories = sqliteTable("chat_session_memories", {
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
  messageCount: integer("message_count").notNull(),
  sessionId: text("session_id")
    .primaryKey()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  updatedAt: text("updated_at").notNull()
})

export const schema = {
  chatMessages,
  chatSessionMemories,
  chatSessions
} as const
