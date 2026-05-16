# 本地数据库基建

## 概述

桌面端主进程现已铺设本地数据库基础设施，采用 `drizzle-orm + @libsql/client` 连接本地 SQLite 文件。
当前已包含 `chat_sessions`、`chat_messages` 与 `chat_session_memories`，用于持久化 sidebar 所需的 chat session 元数据、AI SDK UIMessage 历史与 session 级 memory。

## 选型

- 选用 `@libsql/client` 的本地文件模式，对应数据库 URL 形如 `file:/.../etyon.sqlite`
- 保持 `drizzle-kit` 配置在 `apps/desktop/` 内部，不改动 monorepo 根级任务
- 暂不使用 `better-sqlite3`
  原因：
  当前 Electron 打包链路还没有为原生模块补齐 rebuild / unpack / 发布验证流程，`libsql` 可以先把数据库基础设施接通，同时避免新增 native packaging 复杂度

## 路径

- 配置目录：`~/.config/etyon/`
- SQLite 文件：`~/.config/etyon/etyon.sqlite`
- Drizzle 配置：[drizzle.config.ts](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/drizzle.config.ts)
- Schema 占位文件：[schema.ts](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/src/main/db/schema.ts)
- Migration 输出目录：[drizzle](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/drizzle)

## 主进程接口

- [`getDb()`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/src/main/db/index.ts)：返回懒加载的 Drizzle 数据库实例
- [`getDbClient()`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/src/main/db/index.ts)：返回底层 libsql client
- [`verifyDatabaseConnection()`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/src/main/db/index.ts)：执行 `select 1` 健康检查
- [`ensureDatabaseReady()`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/src/main/db/migrate.ts)：启动期执行 pending migrations

## chat_sessions

首张业务表位于 [`schema.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/src/main/db/schema.ts)，字段如下：

| 字段             | 类型 | 说明                           |
| ---------------- | ---- | ------------------------------ |
| `id`             | text | session 主键                   |
| `title`          | text | 当前先允许为空字符串           |
| `project_path`   | text | 真实本地绝对路径               |
| `created_at`     | text | ISO 时间戳                     |
| `updated_at`     | text | 预留给后续 metadata 更新使用   |
| `last_opened_at` | text | Simple 模式 session 排序主依据 |
| `pinned_at`      | text | pinned 时间；`null` 表示未置顶 |
| `archived_at`    | text | 归档时间；`null` 表示仍在列表  |

- 索引：
  - `chat_sessions_last_opened_at_idx`
  - `chat_sessions_project_path_idx`
- 首个 migration：[`0000_careless_proudstar.sql`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/drizzle/0000_careless_proudstar.sql)
- 第二条 migration：[`0001_parallel_magik.sql`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/drizzle/0001_parallel_magik.sql)
- 第三条 migration：[`0002_fair_black_crow.sql`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/drizzle/0002_fair_black_crow.sql)
- 第四条 migration：[`0003_tidy_magma.sql`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/drizzle/0003_tidy_magma.sql)
- 第五条 migration：[`0004_red_nicolaos.sql`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/drizzle/0004_red_nicolaos.sql)
- 首次创建 session 且没有可继承项目时，`project_path` 回退到 `~/.config/etyon`
- `pinned_at` 仅用于 `Projects` 模式下的顶部 `Pinned Threads` 排序：先按 `pinned_at desc`，再按 `last_opened_at desc`
- `archived_at` 为软归档标记；`chatSessions.list` 只返回 `archived_at is null` 的 active session
- 主进程在 `app.on("ready")` 期间先调用 `ensureDatabaseReady()`，再注册 RPC 与本地 HTTP server，保证 `chatSessions.*` RPC 首次调用时表已经存在

## chat_messages

`chat_messages` 保存每个 chat session 的 AI SDK `UIMessage` 历史：

| 字段            | 类型    | 说明                              |
| --------------- | ------- | --------------------------------- |
| `session_id`    | text    | 关联 `chat_sessions.id`，级联删除 |
| `message_id`    | text    | AI SDK message id                 |
| `sequence`      | integer | session 内展示顺序                |
| `role`          | text    | `system` / `user` / `assistant`   |
| `parts_json`    | text    | `UIMessage.parts` JSON            |
| `metadata_json` | text    | 可选 `UIMessage.metadata` JSON    |
| `created_at`    | text    | ISO 时间戳                        |
| `updated_at`    | text    | ISO 时间戳                        |

- 主键：`(session_id, message_id)`
- 索引：`chat_messages_session_sequence_idx`
- `/api/chat` 在 AI SDK UI stream 完成时通过 `replaceChatMessages()` 整体替换该 session 的消息快照
- renderer 进入 `/chat/$sessionId` 时通过 `chatSessions.listMessages` 读取历史，并作为 `useChat({ messages })` 的初始状态
- 首次持久化消息时，如果 session title 为空，会使用第一条 user 文本生成标题

## chat_session_memories

`chat_session_memories` 保存 session 级 rolling memory：

| 字段            | 类型    | 说明                               |
| --------------- | ------- | ---------------------------------- |
| `session_id`    | text    | 主键，关联 `chat_sessions.id`      |
| `content`       | text    | 最近若干轮对话压缩出的 memory 文本 |
| `message_count` | integer | 生成 memory 时的消息数量           |
| `created_at`    | text    | ISO 时间戳                         |
| `updated_at`    | text    | ISO 时间戳                         |

- 当前 memory 由本地确定性逻辑生成，取最近 `16` 条有文本内容的消息并限制在 `6000` 字符以内
- `/api/chat` 会把已存在的 session memory 与当前项目 `@` 引用上下文一起作为 system prompt 追加给模型
- 后续如果引入模型总结或 embedding 检索，应继续复用这张表作为 session memory 的持久化边界

## 命令

在 `@etyon/desktop` 包内提供以下脚本：

- `vp run @etyon/desktop#db:generate`
- `vp run @etyon/desktop#db:migrate`
- `vp run @etyon/desktop#db:studio`

后续若新增 message 持久化或项目别名表，继续沿用这套 Drizzle schema + migration 流程即可。
