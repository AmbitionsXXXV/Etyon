# Code Agent Tools

## 目标

基于当前 Etyon 桌面端的 AI SDK v6 chat runtime，设计一个本地 code agent tool surface。首版目标不是一次性复刻完整 Codex / Claude Code，而是先把本地高价值能力做成可控、可观测、低 token 浪费的 tools。

## 调研结论

- AI SDK v6 支持 server-side tools、client-side tools、需要用户交互的 tools。server-side tools 通过 `execute` 执行并把结果回传 UI；需要确认的工具可以先把 tool call 展示给用户，确认后再继续执行。参考：[AI SDK Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)。
- AI SDK 的 `DirectChatTransport` 可以让桌面 / CLI 这类 single-process app 直接调用 `ToolLoopAgent.stream()`，不必绕 HTTP；当前 Etyon 已经有 Hono `/api/chat`，所以近期更适合先沿用 `streamText` + server-side tools，后续再评估 `ToolLoopAgent` 直连。参考：[AI SDK Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport)。
- Claude Code 的内建 tools 明确拆分为 `Bash`、`Read`、`Grep`、`Glob`、`Edit`、`Write`、`WebFetch`、`WebSearch`、`Agent` 等，其中 `Bash`、`Edit`、`Write`、web tools 需要权限；Bash 有 cwd、timeout、output length、background task 等行为边界。参考：[Claude Code Tools Reference](https://code.claude.com/docs/en/tools-reference)。
- Claude Code 权限模型使用 `allow` / `ask` / `deny`，规则形如 `Bash(npm run *)`、`Read(./.env)`、`WebFetch(domain:example.com)`，并且 deny 优先于 ask / allow。参考：[Claude Code Settings](https://code.claude.com/docs/en/settings)。
- Codex 默认低摩擦模式是 `workspace-write` + `on-request`：可读写 workspace、执行常规本地命令，越界、网络或高风险行为请求 approval；CLI 也提供 `--sandbox` 与 `--ask-for-approval`。参考：[Codex sandboxing](https://developers.openai.com/codex/concepts/sandboxing)、[Codex CLI reference](https://developers.openai.com/codex/cli/reference)。

## 首版 Tool Surface

| Tool              | 类型                          | 自动执行 | 输入                                                 | 结果                                                                      | 说明                                                       |
| ----------------- | ----------------------------- | -------- | ---------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `rtkCommand`      | server-side                   | 条件允许 | `command`, `cwd`, `timeoutMs`, `reason`, `rawOutput` | `exitCode`, `stdoutPreview`, `stderrPreview`, `tokensSaved`, `durationMs` | 默认 shell 入口。除非 `rawOutput=true`，否则命令先走 RTK。 |
| `readFile`        | server-side                   | 是       | `path`, `startLine?`, `endLine?`                     | `content`, `truncated`, `lineCount`                                       | 读取 workspace 内文本文件。需要遵守 deny-read 规则。       |
| `searchFiles`     | server-side                   | 是       | `query`, `cwd`, `glob?`, `maxResults`                | matches                                                                   | 使用 `rg`，默认跳过 gitignored 文件，控制输出预算。        |
| `listProjectTree` | server-side                   | 是       | `cwd`, `depth`, `maxEntries`                         | tree                                                                      | 用于快速建立项目结构上下文，优先 RTK/tree 压缩。           |
| `gitDiff`         | server-side                   | 是       | `cwd`, `paths?`                                      | `summary`, `files`, `diffPreview`                                         | 复用现有 project context / git diff 能力。                 |
| `applyPatch`      | server-side + UI confirmation | 否       | `patch`, `reason`                                    | `applied`, `diff`, `error?`                                               | 所有文件写入首版都走 patch，不直接暴露任意写文件。         |
| `runCheck`        | server-side                   | 条件允许 | `command`, `cwd`, `timeoutMs`                        | `status`, `failures`, `rawPreview`                                        | 测试 / typecheck / lint 专用命令，仍走 RTK。               |
| `requestApproval` | client-side interaction       | 否       | `action`, `risk`, `preview`                          | `approved`, `comment?`                                                    | 高风险命令和写操作统一进入确认流。                         |

## Bash Command 设计

首版不要暴露一个无限制 `bash(command: string)`。需要保留 shell 能力，但把行为边界写进 schema 和 runtime：

```ts
const BashCommandInput = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1),
  reason: z.string().min(1),
  rawOutput: z.boolean().default(false),
  timeoutMs: z.number().int().min(1000).max(600_000).default(120_000)
})
```

执行策略：

- 默认将 `command` 改写为 `rtk <command>`，包管理器命令仍遵守项目规则使用 `vp`
- `rawOutput=true` 只允许在用户确认后执行，用于调试 RTK 过滤问题
- 命令分段后做风险判断：`rm`、`git reset`、`git checkout --`、跨 workspace 写入、网络下载、安装依赖、系统目录写入进入 approval
- `cwd` 必须在 workspace 或用户显式授权的 writable roots 内
- 输出必须有 token budget：stdout / stderr 各保留 preview，完整输出落临时文件或本地 artifact，再提供可读取路径
- 每次执行记录 `inputTokens`、`outputTokens`、`tokensSaved`、`durationMs`，用于 Token Savings tab

## AI SDK 落地形态

近期沿用当前 `/api/chat`：

```ts
const result = streamText({
  messages: await convertToModelMessages(messages),
  model,
  stopWhen: stepCountIs(8),
  tools: codeAgentTools
})
```

后续当工具链稳定后，可以将 agent 抽成 `ToolLoopAgent`：

```ts
const agent = new ToolLoopAgent({
  instructions,
  model,
  tools: codeAgentTools
})
```

Etyon 是 Electron app，`DirectChatTransport` 对测试和单进程本地执行有价值；但当前 renderer 已通过本地 Hono server 和 `DefaultChatTransport` 串流，先不急着迁移 transport，避免同时改动 chat persistence、Telegram bridge 和 Settings provider 逻辑。

## 权限模型

建议内部规则沿用三层：

- `allow`：只读文件、`rg`、`git diff`、`rtk ls/read/find`、项目内安全检查命令
- `ask`：写文件 patch、包安装、网络请求、长时间命令、raw bash output、跨目录读取
- `deny`：读取 secret 文件、系统目录写入、破坏性 git / rm、未知二进制自执行

这个模型与 Claude Code 的 allow / ask / deny 和 Codex 的 workspace-write / on-request 对齐，也适合 Etyon 后续把规则做成 Settings 可视化配置。
