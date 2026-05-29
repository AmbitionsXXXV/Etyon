# Code Agent Tools

## 目标

Etyon 的 code agent tool surface 现在优先对齐 Pi coding-agent。旧的 `readFile`、`searchFiles`、`applyPatch`、`runCheck` 等 Etyon 形态只保留为内部兼容入口，不再作为内建 code-agent profile 的默认可见工具。

## Pi Tool Surface

内建 code agent 暴露 7 个工具：

| Tool    | 自动执行 | 输入                                                                         | 结果                                            | 说明                                                                                      |
| ------- | -------- | ---------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `read`  | 是       | `path`, `offset?`, `limit?`                                                  | `content: [{ type: "text", text }]`, `details?` | 读取 workspace 内文件；大文件用 `offset` / `limit` 分段读取。                             |
| `grep`  | 是       | `pattern`, `path?`, `glob?`, `ignoreCase?`, `literal?`, `context?`, `limit?` | `content`, `details?`                           | 使用 `rg` 搜索文件内容，返回 `path:line:text` 形态。                                      |
| `find`  | 是       | `pattern`, `path?`, `limit?`                                                 | `content`, `details?`                           | 按 glob 查找文件路径，例如 `*.ts`、`**/*.json`、`src/**/*.spec.ts`。                      |
| `ls`    | 是       | `path?`, `limit?`                                                            | `content`, `details?`                           | 列目录，目录名带 `/` 后缀。                                                               |
| `bash`  | 条件允许 | `command`, `timeout?`                                                        | `content`, `details?`                           | 执行本地命令；`timeout` 使用秒，泛用命令需要 approval。                                   |
| `edit`  | 否       | `path`, `edits: [{ oldText, newText }]`                                      | `content`, `details.diff`                       | 对单文件做精确替换；兼容模型把 `edits` 发成 JSON 字符串，或发旧式 `oldText` / `newText`。 |
| `write` | 否       | `path`, `content`                                                            | `content`, `details?`                           | 创建或覆盖 UTF-8 文本文件，并自动创建父目录。                                             |

## Profile 暴露规则

- `general-purpose`、`explore`、`review` 默认只暴露 Pi 只读集合：`read`、`grep`、`find`、`ls`。
- `coder` 默认暴露完整 Pi 集合：`read`、`bash`、`edit`、`write`、`grep`、`find`、`ls`。
- `plan` 使用只读集合，并在开启 delegation 时额外暴露 `agentCoder` / `agentExplore`。
- `harness-operator` 只保留 runtime 诊断工具：`agentEventsSearch`、`agentRunInspect`。

## Approval 边界

- `read`、`grep`、`find`、`ls` 是只读工具，默认可自动执行，但仍受 workspace 边界、secret-like path、symlink 规则限制。
- `edit`、`write` 永远需要 approval，`requireApprovalForWrites=false` 这类旧设置不会绕过写入确认。
- `bash` 默认需要 approval；`vp check`、`vp test run`、`vp run ...` 等 bounded verification command 可以自动允许。
- 禁止破坏性命令、非 `vp` 包管理器命令、越界 cwd、secret-like path。

## AI SDK 连续性

模型上下文必须满足 AI SDK 的 tool-call continuity：如果历史 assistant message 留下未完成 tool call，下一次普通用户 follow-up 前会插入 synthetic `tool-result`，而不是删除原始 tool call。该结果使用 AI SDK 合法的 `error-text` output，避免出现：

```text
Invalid request: an assistant message with 'tool_calls' must be followed by tool messages
```

这样与 Pi 的 agent loop 原则一致：不能从悬空 assistant tool call 继续，必须先让模型看到对应的 tool result。
