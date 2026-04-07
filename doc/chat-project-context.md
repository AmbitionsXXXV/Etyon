# Chat 项目上下文与 `@` 文件引用

本文说明聊天页的项目快照、`@` 文件引用和模型选择实现约定。本期范围保持在现有 `AI SDK useChat + Hono /api/chat` 链路内，不扩展到完整 agent 编排。

## `.alma-snapshots` 目录

每个聊天会话都绑定一个 `projectPath`。桌面端会在对应项目根目录下维护：

```text
${projectPath}/.alma-snapshots/
  config.json
  index.json
  history.json
  snapshots/<snapshotId>.json
  documents/<snapshotId>.json
```

- `config.json`
  - 保存快照配置，目前包含版本号和默认忽略规则。
- `index.json`
  - 保存当前快照中文件相对路径到 `sha256` 的索引。
- `history.json`
  - 保存快照历史，用于标记最近一次刷新时间和增删改统计。
- `snapshots/<snapshotId>.json`
  - 保存某次快照的元信息和对应索引。
- `documents/<snapshotId>.json`
  - 面向应用 agent 消费的文档清单。
  - 文本文件会记录：
    - `path`
    - `relativePath`
    - `sha256`
    - `size`
    - `mtimeMs`
    - `language`
    - `preview`
    - `chunkCount`
  - 同时预留：
    - `embeddingState?`
    - `embeddingRef?`

二进制文件只进入 `index.json`，不会进入 `documents/<snapshotId>.json`。

## 忽略与刷新策略

默认忽略规则沿用 Alma 风格，并补充桌面应用常见噪声目录：

- `node_modules/**`
- `.git/**`
- `dist/**`
- `build/**`
- `.next/**`
- `.alma-snapshots/**`
- `.turbo/**`
- `.vite/**`
- `*.log`

刷新策略是按需刷新，不做每次发送前全量重扫：

1. 进入聊天页时调用 `projectSnapshots.ensure`。
2. 发送消息时，如果引用了文件，服务端会再次通过 `ensureProjectSnapshot()` 做轻量校验。
3. 当以下条件之一成立时会重建快照：
   - 还没有任何快照历史。
   - 最近快照超过过期阈值。
   - `index.json` 缺失。
   - `snapshots/<snapshotId>.json` 缺失。
   - `documents/<snapshotId>.json` 缺失。

## `mentions` 数据结构

聊天输入框里的 `@` 文件引用不会写成脆弱的纯文本路径，而是以结构化 token 维护。请求 `/api/chat` 时会同时提交普通文本和 `mentions`：

```ts
type ChatMention = {
  kind: "file"
  path: string
  relativePath: string
  snapshotId: string
}
```

- `path`
  - 文件绝对路径。
- `relativePath`
  - 相对于当前 `projectPath` 的路径，也是快照索引的主键。
- `snapshotId`
  - 选择该文件时关联的快照编号。

服务端会优先从最新快照中读取被引用文件的 `preview`，再把这些内容作为额外上下文拼进模型输入。

## 模型选择与会话记忆

聊天底部工具栏提供模型选择入口。数据来源只取 `settings.ai.providers` 中 `enabled = true` 的 provider。

单个 provider 的候选模型来源固定为：

1. 优先 `provider.models`
2. 如果为空，回退到 `provider.availableModels`

展示值统一编码为 `providerId/modelId`，避免不同 provider 的同名模型冲突。

会话层新增 `chat_sessions.model_id` 字段，对应 `ChatSessionSummary.modelId`。解析优先级固定为：

1. `/api/chat` 请求体里的 `model`
2. 当前 session 的 `modelId`
3. `settings.ai.defaultModel`
4. 服务端现有兜底模型

切换模型时会立即调用 `chatSessions.setModel` 持久化到当前 session。新会话初始 `modelId` 为空，仍从 settings 默认模型起步。

## 数据库变更约定

这次会话模型记忆只通过 Drizzle schema 和 CLI 管理，不直接手改 SQL：

1. 修改 [`schema.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/src/main/db/schema.ts)
2. 运行 `rtk pnpm --filter @etyon/desktop db:generate`
3. 由 `drizzle-kit` 自动生成 migration

当前新增字段：

- `chat_sessions.model_id`

对应业务入口：

- `chatSessions.setModel`
- `getChatSessionById()`
- `/api/chat` 的模型回退链路
