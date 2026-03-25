# 本地数据库基建

## 概述

桌面端主进程现已铺设本地数据库基础设施，采用 `drizzle-orm + @libsql/client` 连接本地 SQLite 文件。
这一轮仅完成连接、配置、脚本与目录结构，不包含业务表、迁移文件或真实 CRUD 流程。

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

## 命令

在 `@etyon/desktop` 包内提供以下脚本：

- `pnpm --filter @etyon/desktop db:generate`
- `pnpm --filter @etyon/desktop db:migrate`
- `pnpm --filter @etyon/desktop db:studio`

当前 schema 仍为空，第一份 migration 会在首张真实业务表加入后生成。
