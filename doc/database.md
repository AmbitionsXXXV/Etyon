# 本地数据库基建

## 概述

桌面端主进程现已铺设本地数据库基础设施，采用 `drizzle-orm + @libsql/client` 连接本地 SQLite 文件。
当前已包含首张真实业务表 `chat_sessions`，用于持久化 sidebar 所需的最小 chat session 元数据。

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
| `last_opened_at` | text | sidebar 排序主依据             |
| `pinned_at`      | text | pinned 时间；`null` 表示未置顶 |

- 索引：
  - `chat_sessions_last_opened_at_idx`
  - `chat_sessions_project_path_idx`
- 首个 migration：[`0000_careless_proudstar.sql`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/drizzle/0000_careless_proudstar.sql)
- 第二条 migration：[`0001_parallel_magik.sql`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/drizzle/0001_parallel_magik.sql)
- 首次创建 session 且没有可继承项目时，`project_path` 回退到 `~/.config/etyon`
- `pinned_at` 仅用于 `Projects` 模式下的顶部 `Pinned Threads` 排序：先按 `pinned_at desc`，再按 `last_opened_at desc`
- 主进程在 `app.on("ready")` 期间先调用 `ensureDatabaseReady()`，再注册 RPC 与本地 HTTP server，保证 `chatSessions.*` RPC 首次调用时表已经存在

## 命令

在 `@etyon/desktop` 包内提供以下脚本：

- `pnpm --filter @etyon/desktop db:generate`
- `pnpm --filter @etyon/desktop db:migrate`
- `pnpm --filter @etyon/desktop db:studio`

后续若新增 message 持久化或项目别名表，继续沿用这套 Drizzle schema + migration 流程即可。
