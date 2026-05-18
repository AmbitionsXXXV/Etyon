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
- `out/**`
- `.next/**`
- `.alma-snapshots/**`
- `.turbo/**`
- `.vite/**`
- `*.log`
- `*.asar`

如果项目根目录存在 `.gitignore`，快照扫描还会按顺序合并其中的规则。也就是说，`out/`、`coverage/`、`.env` 等项目自身已经忽略的路径默认不会进入聊天上下文；`.alma-snapshots` 和 `.git` 仍作为系统目录强制跳过。

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

聊天输入框里的 `@` 文件 / 文件夹引用和 `$` skill 引用不会写成脆弱的纯文本路径，而是以结构化 token 维护。请求 `/api/chat` 时会同时提交普通文本和 `mentions`：

```ts
type ChatMention =
  | {
      kind: "file"
      path: string
      relativePath: string
      snapshotId: string
    }
  | {
      kind: "folder"
      path: string
      relativePath: string
      snapshotId: string
    }
  | {
      description: string
      kind: "skill"
      name: string
      path: string
      projectPath: string | null
      relativePath: string
      scope: "global" | "project"
      shortDescription: string | null
    }
```

- `path`
  - 文件或文件夹绝对路径。
- `relativePath`
  - 相对于当前 `projectPath` 的路径，也是快照索引的主键。
- `snapshotId`
  - 选择该候选项时关联的快照编号。

服务端会优先从最新快照中读取被引用文件的 `preview`，再把这些内容作为额外上下文拼进模型输入。引用文件夹时，服务端按文件夹相对路径前缀从同一快照中提取目录下的文本文件，并按保守上下文预算截断。

文件搜索以 `projectPath` 为根处理相对路径。输入 `@` 会显示最完整的候选项：skills、文件夹和文件，其中 skills 分组固定排在文件夹、文件之前；`@` 下的 skills 只按 skill title 匹配，不搜索 description、正文内容或路径；文件和文件夹候选项最多取前 50 个。输入 `@src/main`、`@/src/main` 或 `@./src/main` 都会匹配快照中的 `src/main...` 文件或文件夹，避免项目根路径写法导致文件索引查不到。

`$` 指示器专门用于筛选和选择 skills。候选项来自 `skills.list` 的 `ParsedSkill`，仅保留当前 project skills 和 global skills；`$` 的过滤字段包括 skill `name`、`description`、`metadata.short-description`、正文内容和路径，最多展示前 20 个匹配项。`@` 和 `$` 中的 skill row 使用同一套紧凑单行布局，展示 skill 名称、描述和来源项目；选择 skill 后，消息 metadata 中会记录 `kind: "skill"`、skill 路径、名称与描述；服务端会按路径重新从当前解析结果中取出对应 skill，并把它排在自动召回 skills 之前注入模型上下文。

`@` / `$` 的 suggestion 搜索触发使用 TanStack Pacer 的 `useDebouncedValue` 做轻量 debounce，等待时间为 180ms，并启用 `leading: true`、`trailing: true`。这样打开指示器时第一批候选即时出现，连续输入时只用稳定后的 query 触发 `projectSnapshots.listFiles` 和 skill 过滤，减少快照文件搜索和本地 skill 全文过滤的重复计算。搜索期间 UI 会保留上一批候选项，只有初次加载且没有任何候选时才显示空状态，避免输入过程中 suggestion 面板闪烁。

聊天页默认不显示 session / snapshot 细节。需要排查项目快照或模型绑定时，可在 renderer 环境中设置 `VITE_ENABLE_CHAT_SESSION_DETAILS=1` 或 `VITE_ENABLE_CHAT_SESSION_DETAILS=true`，再显示右侧调试详情和底部快照 ID。

右侧 Review 面板的 Files tab 直接展示完整项目文件树，不启用 `@pierre/trees` 内置 search。未选择文件时只展示文件树，不挂载空的 File Preview 区域；选择文件后，文件树和右侧预览区之间使用 `@heroui-pro/react` 的 `Resizable` 分栏，可拖拽调整宽度。点击文件时通过 `projectSnapshots.readFile` 读取项目内文本文件，并使用 `shiki/bundle/web` 渲染带行号的只读代码视图，文件树本身不被替换。文件树顶部提供“收起所有文件夹”按钮，用于快速恢复到初始折叠层级。

Chat 组件文件保持只负责 React 渲染和 hook glue：`prompt-input.tsx`、`project-file-code-viewer.tsx` 等 `tsx` 文件不直接定义可复用常量或 helper function；分组、格式化、Shiki token、语言映射等非组件逻辑放在 `apps/desktop/src/renderer/lib/chat/` 下对应 feature 文件中。

`Files` 内部有独立 `Resizable` 分栏，因此 Review 面板的 `Tabs.Panel` 必须通过 `data-[inert=true]:hidden` 隔离 inactive tab，避免 React Aria 保留退出中的 panel 时继续占用 `Changes` / `Commit` 的内容高度。

## 模型选择、会话记忆与 Skills

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

发送消息时，服务端会按同一条 `/api/chat` 链路组装额外 system prompt。顺序为：

1. session memory
2. long-term memory
3. skills
4. `@` 文件 / 文件夹引用产生的 project snapshot 上下文

skills 不写入数据库。服务端从当前 session 的 `projectPath` 和用户目录读取 `SKILL.md`：

- project 级：`${projectPath}/.agents/skills/*/SKILL.md`
- project 级：`${projectPath}/.codex/skills/*/SKILL.md`
- 全局：`~/.codex/skills/*/SKILL.md`
- 全局：`~/.agents/skills/*/SKILL.md`
- 全局：`~/.config/etyon/skills/*/SKILL.md`

解析规则遵循 Codex skill 标准：frontmatter 需要 `name` 与 `description`，可选读取 `metadata.short-description`。召回使用最近 3 条用户消息做关键词 overlap，并受 `settings.skills.enabled`、`includeProject`、`includeGlobal`、`maxContextSkills` 控制。

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
