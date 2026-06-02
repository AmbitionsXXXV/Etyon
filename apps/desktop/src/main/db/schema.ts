import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
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
    agentProjectionRunId: text("agent_projection_run_id"),
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
    agentProjectionRunIdx: index("chat_messages_agent_projection_run_idx").on(
      table.agentProjectionRunId
    ),
    pk: primaryKey({
      columns: [table.sessionId, table.messageId]
    }),
    sessionSequenceIdx: index("chat_messages_session_sequence_idx").on(
      table.sessionId,
      table.sequence
    )
  })
)

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    chatSessionId: text("chat_session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    errorMessage: text("error_message"),
    finishedAt: text("finished_at"),
    id: text("id").primaryKey(),
    modelId: text("model_id"),
    parentRunId: text("parent_run_id"),
    profileId: text("profile_id").notNull(),
    startedAt: text("started_at").notNull(),
    status: text("status", {
      enum: ["failed", "running", "succeeded", "suspended"]
    }).notNull()
  },
  (table) => ({
    chatSessionIdx: index("agent_runs_chat_session_idx").on(
      table.chatSessionId
    ),
    parentRunIdx: index("agent_runs_parent_run_idx").on(table.parentRunId),
    statusIdx: index("agent_runs_status_idx").on(table.status)
  })
)

export const agentEvents = sqliteTable(
  "agent_events",
  {
    createdAt: text("created_at").notNull(),
    id: text("id").primaryKey(),
    payloadJson: text("payload_json").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull()
  },
  (table) => ({
    runSequenceIdx: index("agent_events_run_sequence_idx").on(
      table.runId,
      table.sequence
    )
  })
)

export const agentToolCalls = sqliteTable(
  "agent_tool_calls",
  {
    approvalState: text("approval_state", {
      enum: ["approved", "denied", "not_required", "pending"]
    }).notNull(),
    errorMessage: text("error_message"),
    finishedAt: text("finished_at"),
    id: text("id").primaryKey(),
    inputJson: text("input_json").notNull(),
    outputJson: text("output_json"),
    parentToolCallId: text("parent_tool_call_id"),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    startedAt: text("started_at").notNull(),
    state: text("state", {
      enum: ["approval_requested", "failed", "finished", "requested", "running"]
    }).notNull(),
    toolName: text("tool_name").notNull()
  },
  (table) => ({
    runStateIdx: index("agent_tool_calls_run_state_idx").on(
      table.runId,
      table.state
    ),
    runToolIdx: index("agent_tool_calls_run_tool_idx").on(
      table.runId,
      table.toolName
    )
  })
)

export const agentApprovals = sqliteTable(
  "agent_approvals",
  {
    createdAt: text("created_at").notNull(),
    id: text("id").primaryKey(),
    respondedAt: text("responded_at"),
    responseJson: text("response_json"),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    state: text("state", {
      enum: ["approved", "denied", "pending"]
    }).notNull(),
    toolCallId: text("tool_call_id").notNull(),
    toolCallRowId: text("tool_call_row_id")
      .notNull()
      .references(() => agentToolCalls.id, { onDelete: "cascade" })
  },
  (table) => ({
    runStateIdx: index("agent_approvals_run_state_idx").on(
      table.runId,
      table.state
    ),
    runToolIdx: index("agent_approvals_run_tool_idx").on(
      table.runId,
      table.toolCallId
    ),
    toolCallRowIdx: index("agent_approvals_tool_call_row_idx").on(
      table.toolCallRowId
    )
  })
)

export const agentArtifacts = sqliteTable(
  "agent_artifacts",
  {
    byteLength: integer("byte_length"),
    createdAt: text("created_at").notNull(),
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    metadataJson: text("metadata_json").notNull(),
    path: text("path").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id")
  },
  (table) => ({
    runIdx: index("agent_artifacts_run_idx").on(table.runId),
    runToolIdx: index("agent_artifacts_run_tool_idx").on(
      table.runId,
      table.toolCallId
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

export const memoryEntries = sqliteTable(
  "memory_entries",
  {
    accessCount: integer("access_count").notNull().default(0),
    archivedAt: text("archived_at"),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: ["episodic", "semantic", "working"]
    }).notNull(),
    lastAccessedAt: text("last_accessed_at"),
    projectPath: text("project_path"),
    scope: text("scope", {
      enum: ["chatbot", "global", "project"]
    }).notNull(),
    sessionId: text("session_id").references(() => chatSessions.id, {
      onDelete: "cascade"
    }),
    source: text("source", {
      enum: ["chat-session", "chatbot"]
    }).notNull(),
    sourceId: text("source_id").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    projectPathIdx: index("memory_entries_project_path_idx").on(
      table.projectPath
    ),
    sessionIdIdx: index("memory_entries_session_id_idx").on(table.sessionId),
    sourceIdIdx: uniqueIndex("memory_entries_source_id_idx").on(
      table.source,
      table.sourceId
    ),
    updatedAtIdx: index("memory_entries_updated_at_idx").on(table.updatedAt)
  })
)

export const memoryEmbeddings = sqliteTable(
  "memory_embeddings",
  {
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
    dimensions: integer("dimensions").notNull(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memoryEntries.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    updatedAt: text("updated_at").notNull(),
    vectorJson: text("vector_json").notNull()
  },
  (table) => ({
    modelIdx: index("memory_embeddings_model_idx").on(table.model),
    pk: primaryKey({
      columns: [table.memoryId, table.model]
    })
  })
)

export const schema = {
  agentApprovals,
  agentArtifacts,
  agentEvents,
  agentRuns,
  agentToolCalls,
  chatMessages,
  chatSessionMemories,
  chatSessions,
  memoryEmbeddings,
  memoryEntries
} as const
