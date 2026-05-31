# Code Agent Tools

## 目标

Etyon 的 code agent tool surface 不再按“完整复刻外部项目”推进。当前基线是：

- **架构边界归入 Etyon Workspace**：workspace 负责 filesystem / sandbox / LSP 类能力，tool registry 负责命名、启用、审批、只读 / 写入边界和 hook 包装。
- **模型交互使用 Etyon 短别名**：保留 `read`、`grep`、`find`、`ls`、`stat`、`bash`、`processOutput`、`stopProcess`、`mkdir`、`delete`、`edit`、`smartEdit`、`write` 这组短别名，让 code agent prompt 更紧凑；`plan` / `coder` 可额外暴露 approval-gated `requestAccess` 作为无副作用授权 checkpoint；显式选中的 skill 声明 `network` capability 时，可额外暴露 approval-gated `webSearch` / `webExtract`。
- **Etyon 旧工具保留为内部兼容 / harness 工具**：`readFile`、`searchFiles`、`applyPatch`、`runCheck` 等不作为内建 code-agent profile 的默认可见 surface。

Etyon workspace 层暴露 `view`、`search_content`、`find_files`、`file_stat`、`execute_command`、`process_output`、`stop_process`、`mkdir`、`delete_file`、`string_replace_lsp`、`ast_smart_edit`、`write_file`、`lsp_inspect`、`web_search`、`web_extract` 等内部操作。`requestAccess` 属于 tool registry 的人工授权 checkpoint，不是 filesystem / shell / network workspace op。Etyon 现阶段保持短别名作为 model-facing alias，但实现和后续演进要按 workspace/tool registry 分层收口。外部设计来源统一在根目录 `README.md` 中说明。

本地 `opencode`（`/Users/jiantianjianghui/gh_projects/opencode`，`dev` at `c7e1fc5e4260fc3e1aea24e26d67ed4074e3575d`）的 LSP 实现作为 `LSPManager` 参考：按 file extension + root resolver 懒启动 server；用 `root + serverId` 去重并发 spawn；维护 broken server 集合；client 负责 `initialize`、`initialized`、`didOpen` / `didChange`、push diagnostics 与 pull diagnostics 合并；对外提供 `status`、`hasClients`、`touchFile`、`diagnostics`、`hover`、`definition`、`implementation`、`references`、document / workspace symbol 等接口，并通过事件通知 `lsp.updated` / `lsp.client.diagnostics`。Etyon v1 只取这个生命周期形状，不照搬 opencode 的多语言内置 server 矩阵和自动下载策略；当前已按最近 lockfile package root 懒启动 TS/JS client，暴露 `status` / `hasClients` / `touchFile` / `diagnostics` / `inspect`，并在 initialize failure 或 server close / error 后把 root 标记为 broken，后续同 root 请求 fail closed，不继续复用已退出的 server；`edit` / `smartEdit` / `write` 后置诊断已走 `touchFile`。Desktop 运行时依赖显式包含 `typescript-language-server` 和 `typescript`，真实 `inspect` 不依赖开发机 PATH 或全局安装。

新增能力的优先级固定为：先补 `Workspace Substrate`，再接 `sandbox`，最后接 `LSP`。`sandbox` 不是 permission mode，也不能直接塞进 `bash`；它是 workspace substrate 的 OS 级执行边界，负责 filesystem / network isolation。`bash`、`ExecutionEnv.backgroundProcesses` 和 LSP server spawn 都必须走同一个 `WorkspaceSandbox`，不可用时按 `settings.agents.sandbox.failIfUnavailable=true` fail closed，不静默回退到裸执行。LSP server 本身是本地进程，`inspect` 只能在 `settings.agents.lsp.enabled && settings.agents.sandbox.enabled` 时暴露。

## Model-facing Tool Surface

内建 code agent 默认暴露 13 个核心工具；`plan` / `coder` 额外暴露 `requestAccess`；开启 sandbox + LSP 后，`coder` / `explore` / `review` 额外暴露 `inspect`；选中的 skill 声明 `network` capability 时额外暴露 `webSearch` / `webExtract`：

| Tool            | 自动执行 | 输入                                                                         | 结果                                                                 | 说明                                                                                              |
| --------------- | -------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `read`          | 是       | `path`, `offset?`, `limit?`                                                  | `content: [{ type: "text", text }]`, `details?`                      | 读取 workspace 内文件；大文件用 `offset` / `limit` 分段读取。                                     |
| `grep`          | 是       | `pattern`, `path?`, `glob?`, `ignoreCase?`, `literal?`, `context?`, `limit?` | `content`, `details?`                                                | 底层使用 BurntSushi `ripgrep` (`rg --json`) 搜索文件内容，返回 `path:line:text` 形态。            |
| `find`          | 是       | `pattern`, `path?`, `limit?`                                                 | `content`, `details?`                                                | 底层使用 `fd` 按 glob 查找文件路径，例如 `*.ts`、`**/*.json`、`src/**/*.spec.ts`。                |
| `ls`            | 是       | `path?`, `limit?`                                                            | `content`, `details?`                                                | 列目录，目录名带 `/` 后缀。                                                                       |
| `stat`          | 是       | `path`                                                                       | `content`, `details?`                                                | 读取单个 project path 的 kind、size、mtime、language、symlink metadata，不跟随 symlink。          |
| `bash`          | 条件允许 | `command`, `timeout?`, `background?`                                         | `content`, `details?`                                                | 执行本地命令；`timeout` 使用秒，`background=true` 返回 Etyon processId，泛用命令需要 approval。   |
| `processOutput` | 是       | `processId`                                                                  | `content`, `details.process`                                         | 读取 Etyon-managed background process 的 bounded stdout / stderr。                                |
| `stopProcess`   | 是       | `processId`                                                                  | `content`, `details.process`                                         | 停止 Etyon-managed background process。                                                           |
| `mkdir`         | 否       | `path`, `recursive?`                                                         | `content`, `details?`                                                | 创建目录，默认递归创建父目录；写入类 filesystem op，必须 approval。                               |
| `delete`        | 否       | `path`, `recursive?`                                                         | `content`, `details?`                                                | 删除文件或目录；目录删除需 `recursive=true`，必须 approval。                                      |
| `edit`          | 否       | `path`, `edits: [{ oldText, newText }]`                                      | `content`, `details.diff`                                            | 对单文件做精确替换；兼容模型把 `edits` 发成 JSON 字符串，或发旧式 `oldText` / `newText`。         |
| `smartEdit`     | 否       | `path`, `symbol`, `replacement`, `kind?`                                     | `content`, `details.diff`                                            | 对 TS/JS 文件中唯一命名声明做 AST 边界替换，并在写入后追加 LSP diagnostics。                      |
| `write`         | 否       | `path`, `content`                                                            | `content`, `details?`                                                | 创建或覆盖 UTF-8 文本文件，并自动创建父目录。                                                     |
| `requestAccess` | 否       | `reason`, `scope?`, `actions?`                                               | `approved`, `reason`, `scope`, `actions`                             | 只在 `plan` / `coder` 暴露；不执行底层动作，只让模型请求用户批准一个窄 scope。                    |
| `inspect`       | 是       | `path`, `line`, `match`                                                      | `hover`, `definition`, `implementation`, `references`, `diagnostics` | LSP 位置检查；`match` 必须匹配目标行，并用唯一 `<<<` 标记光标，结果由 sandboxed LSP server 提供。 |
| `webSearch`     | 否       | `query`, `limit?`                                                            | `content`, `details.results`                                         | 只在 selected skill 声明 `network` capability 时暴露；查询会离开本地 workspace，必须 approval。   |
| `webExtract`    | 否       | `url`, `maxChars?`                                                           | `content`, `contentType`, `title`, `truncated`                       | 只在 selected skill 声明 `network` capability 时暴露；抓取网页并提取 bounded readable text。      |

## Etyon Workspace 对照

| Etyon alias     | Etyon workspace op   | 当前 Etyon 实现边界                                                                                                            |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `read`          | `view`               | 通过 `ExecutionEnv.fileSystem` 读取 bounded text。                                                                             |
| `grep`          | `search_content`     | 使用 `rg --json`，保留 secret-like path 排除和输出截断；开启 sandbox 时复用当前 `AgentWorkspace.executionEnv` 执行。           |
| `find`          | `find_files`         | 使用 `fd --glob` 做路径查找；开启 sandbox 时复用当前 `AgentWorkspace.executionEnv` 执行，后续可收敛到 workspace list/search。  |
| `ls`            | `find_files` / list  | 目录列举别名，输出紧凑 entries。                                                                                               |
| `stat`          | `file_stat`          | 读取 metadata，不跟随 symlink，保留 secret-like path 边界。                                                                    |
| `bash`          | `execute_command`    | 走 permission engine；泛用命令需要 approval。                                                                                  |
| `processOutput` | `process_output`     | 读取当前 Etyon workspace 内由 `bash background=true` 启动的 background process 输出。                                          |
| `stopProcess`   | `stop_process`       | 停止当前 Etyon workspace 内由 `bash background=true` 启动的 background process。                                               |
| `mkdir`         | `mkdir`              | 创建目录，写入类 tool，永远走 approval。                                                                                       |
| `delete`        | `delete_file`        | 删除文件或目录，写入类 tool，永远走 approval。                                                                                 |
| `edit`          | `string_replace_lsp` | 当前是 exact replacement；写入后追加 LSP diagnostics。                                                                         |
| `smartEdit`     | `ast_smart_edit`     | 对唯一命名 TS/JS declaration 做 AST 边界替换；写入类 tool，永远走 approval。                                                   |
| `write`         | `write_file`         | 写入 / 覆盖文件，永远走 approval。                                                                                             |
| `requestAccess` | `request_access`     | tool registry 级授权 checkpoint；执行前必须 approval，成功后只返回已批准的 `scope` / `reason` / `actions`。                    |
| `inspect`       | `lsp_inspect`        | 只在 sandbox + LSP 同时开启时暴露；通过 TS/JS LSP 返回 hover / 跳转 / references / 诊断。                                      |
| `webSearch`     | `web_search`         | selected skill 声明 `network` capability 时暴露；当前通过 bounded DuckDuckGo Instant Answer API 查询并必须 approval。          |
| `webExtract`    | `web_extract`        | selected skill 声明 `network` capability 时暴露；当前通过 fetch 读取 http(s) 页面并返回 bounded readable text，必须 approval。 |

## Profile 暴露规则

- `general-purpose`、`explore`、`review` 默认只暴露只读 alias 集合：`read`、`grep`、`find`、`ls`、`stat`。
- `coder` 默认暴露完整 code-agent alias 集合：`read`、`grep`、`find`、`ls`、`stat`、`bash`、`processOutput`、`stopProcess`、`mkdir`、`delete`、`edit`、`smartEdit`、`write`，并额外暴露 `requestAccess` 用于请求窄 scope 授权。
- `explore`、`review`、`coder` 的 profile policy 允许 `inspect`，但 tool registry 只有在 `settings.agents.lsp.enabled && settings.agents.sandbox.enabled` 时才实际暴露。
- `plan` 使用只读集合，并额外暴露 `requestAccess`；开启 delegation 时还会暴露 `agentCoder` / `agentExplore`。
- `harness-operator` 只保留 runtime 诊断工具：`agentEventsSearch`、`agentRunInspect`。
- `webSearch` / `webExtract` 不随 profile 默认暴露；只有显式选中的 skill 声明 `network` capability，且本次 request 允许 approval-gated tools 时才进入工具集合。

## Approval 边界

- `read`、`grep`、`find`、`ls`、`stat` 是只读工具，默认可自动执行，但仍受 workspace 边界、secret-like path、symlink 规则限制。
- `mkdir`、`delete`、`edit`、`smartEdit`、`write` 永远需要 approval，`requireApprovalForWrites=false` 这类旧设置不会绕过写入确认。
- `bash` 默认需要 approval；`vp check`、`vp test run`、`vp run ...` 等 bounded verification command 可以自动允许。
- `bash background=true` 即使命令本身像 bounded check，也需要 approval；`processOutput` / `stopProcess` 只能访问 Etyon 当前 workspace 内已登记的 processId。
- 禁止破坏性命令、非 `vp` 包管理器命令、越界 cwd、secret-like path。
- `webSearch` / `webExtract` 永远需要 approval；即使来自 `network` skill capability，也不能自动执行。
- `requestAccess` 永远需要 approval，且只确认用户批准的窄 scope；它不会直接放宽后续 filesystem / shell / network 工具的 permission engine。
- `sandbox` 与 permission / approval 是互补层：permission 决定工具能否开始执行，sandbox 限制进程启动后能访问的文件和网络。`settings.agents.sandbox.autoAllowSandboxedShell=false` 是 v1 默认值，通过测试前不因为 sandbox 存在而减少审批。

## Workspace Substrate 目标

当前已新增 `AgentWorkspace`，持有 `projectPath`、`fileSystem`、`sandbox`、`lsp`。现有 `ExecutionEnv` 已先适配到这个 substrate，并新增内部 `backgroundProcesses` 管理器；model-facing 层使用 Etyon alias `processOutput` / `stopProcess`，不暴露外部命名。`AgentWorkspace` 按 `projectPath + chatSessionId` 复用 process registry，因此同一 chat 的后续 turn 可以继续读取 / 停止前一轮启动的 process；LSP manager 按 `projectPath + chatSessionId + sandbox/LSP settings` 复用，避免每次 toolset 构建都新建 language server lifecycle；`cleanupAgentWorkspaceResources()` 会在 app `before-quit` 时统一停止 cached background processes、关闭 cached LSP managers 并清空 workspace caches；app restart 后 registry 丢失时，`processOutput` / `stopProcess` 会从当前 chat session 的 `agent_events` 恢复 process metadata / bounded output，并在 pid 仍存活时继续停止进程组。

首批 settings：

- `settings.agents.sandbox`: `enabled=false`、`failIfUnavailable=true`、`allowNetwork=false`、`autoAllowSandboxedShell=false`。
- `settings.agents.lsp`: `enabled=false`、`requireSandbox=true`、`initTimeoutMs=15000`、`diagnosticTimeoutMs=5000`。

平台策略：

- macOS 优先 `sandbox-exec` / Seatbelt。
- Linux 优先 `bwrap`。
- Windows v1 标记 unsupported。
- sandbox 不可用时 fail closed，不做 unsandbox fallback。

事件类型沿用现有 append-only `agent_events`，不新增表。当前已登记 `sandbox_command_started`、`sandbox_command_output`、`sandbox_command_finished`、`background_process_started`、`background_process_output`、`background_process_finished`、`lsp_server_started`、`lsp_diagnostics_collected`；`ExecutionEnv.shell.exec()` 已提供通用 `started` / `output` / `finished` telemetry stream，显式 `execute_command` lifecycle / output 会通过这条 stream 转成 workspace event sink，LSP server start / diagnostics 也会写入 workspace event sink。Agent Workbench 会把 `sandbox_command_output` / `background_process_output` 聚合为按 command / process / channel 分组的 bounded shell output live tail。`grep` / `find` / `searchFiles` 这类只读搜索命令复用同一个 sandbox spawn 边界但不把大段搜索输出写进 command lifecycle event；`backgroundProcesses` 提供 start / list / get / stop / cleanup / recover 和 bounded output preview，model-facing `bash background=true` 会把 start / output / finished 事件写入 workspace event sink，并通过 `processOutput` / `stopProcess` 暴露当前 workspace 内的 background process 控制；registry miss 会从当前 chat session 的 background process events 恢复 snapshot。LSP cleanup 会释放 `WorkspaceSandboxSpawnConfig.cleanup()` 里的临时资源，`LSPManager.status()` 可用于查看 running / starting / broken roots。

## AI SDK 连续性

模型上下文必须满足 AI SDK 的 tool-call continuity：如果历史 assistant message 留下未完成 tool call，下一次普通用户 follow-up 前会插入 synthetic `tool-result`，而不是删除原始 tool call。当前 `prepareAgentChatContext()` 会在 `convertToModelMessages()` 后统一调用 Etyon continuity helper，因此 Agents enabled / disabled 路径都会拿到补齐后的 `ModelMessage[]`。该结果使用 AI SDK 合法的 `error-text` output，避免出现：

```text
Invalid request: an assistant message with 'tool_calls' must be followed by tool messages
```

这与 Etyon durable tool call 原则一致：不能从悬空 assistant tool call 继续，必须先让模型看到对应的 tool result。
