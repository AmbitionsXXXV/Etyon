# Agents 能力设计

## 目标

在当前 Etyon 桌面端 chat 能力之上，设计一套可渐进落地的 Agents 架构。目标不是直接复制 Codex、Claude Code、Pi 或 Mastra，而是把它们的可复用结构收敛成适合 Etyon 的本地能力：

- 保留当前 `AI SDK v6 useChat + DefaultChatTransport + Hono /api/chat` 链路。
- 让普通 chat 可以开启 agent 能力，而不是另开一套平行聊天系统。
- 支持 tool call、用户审批、可观测事件、可回放运行记录。
- 支持 multi-agent：主 agent 可以把独立任务委派给子 agent，但子 agent 的上下文、工具、预算和输出要受控。
- 支持 Harness Engineering：把模型调用、上下文构建、工具执行、权限、事件、持久化、压缩与恢复拆成明确层级。

## 设计起点与约束

本设计从既有 chat 基础设施出发，首版不能破坏这些约束：

- Renderer 使用 `useChat<ChatUiMessage>()` 和 `DefaultChatTransport` 请求本地 Hono `/api/chat`。
- `/api/chat` 负责读取 session memory、long-term memory、skills 与 `@` 项目上下文，然后调用 `streamText({ model, messages })`。
- `chat_messages` 目前保存的是完整 `UIMessage[]` 快照，适合恢复 UI，但不适合作为 agent run 的审计日志。
- Renderer 仍以 chat viewport 为主要交互载体；tool trace 只做紧凑投影，完整 sub-agent trace 留在 event store。
- `settings.ai`、`settings.chat`、`settings.memory`、`settings.skills` 已存在，`settings.agents` 需要以默认关闭的方式向后补齐。
- `doc/code-agent-tools.md` 已经定义了首版 code agent tool surface；本设计在其基础上补齐 runtime、multi-agent 和 harness 层。

因此首版不迁移 transport，不引入全新 chat 协议，不破坏现有 session / memory / mention 行为。

## 当前落地状态

截至当前实现，Etyon 已经完成首版 chat 内 agent runtime 接入：

- `packages/rpc/src/schemas/settings.ts` 已新增 `settings.agents`，默认 `enabled=false`，旧 settings 会自动补齐 disabled 默认值。
- `/api/chat` 在 agents 关闭时继续走原有 `streamText` 路径；开启后通过 `apps/desktop/src/main/agents/agent-runtime.ts` 注入 profile instructions、tools 与 `stopWhen` 预算。
- `apps/desktop/src/main/agents/` 已包含 built-in profiles、tool registry、permission engine、event store 与 runtime facade。
- 数据库已新增 `agent_runs`、`agent_events`、`agent_tool_calls`，用于记录 run lifecycle、tool call lifecycle 和 harness inspection。
- 首版工具包含只读的 `searchFiles`、`readFile`、`listProjectTree`、`gitDiff`，写入/检查类 `applyPatch`、`runCheck`、`rtkCommand` 进入权限判断；`harness-operator` 可用 `agentEventsSearch` 与 `agentRunInspect` 做只读诊断。
- `coder` / `plan` profiles 在开启 `allowSubagentDelegation` 后会暴露受控 delegation tools，例如 `agentExplore` 和 `agentReview`；子 agent 使用独立 child run、独立 tool trace、受限 context，并且不会拿到需要 approval 的工具。
- Chat viewport 会渲染 tool trace；当 AI SDK tool part 进入 `approval-requested` 状态时，可直接在 trace 行内批准或拒绝，并继续同一条 chat stream；同时会把文本流里的 `<antThinking>`、`Executed in ...` 和 `<function_calls><invoke ...>` transcript 解析成紧凑 trace，避免原始工具标签直接漏进正文。Assistant 输出不使用整块 bubble 包裹，而是以无背景的连续流式内容和 trace 卡片向下展开；请求提交后如果还没有第一段 assistant part，会先显示轻量 live 状态行。
- Settings 新增 `Agents` tab，用于控制 global enable、default profile、tool step budget、delegation 开关、write approval 与 trace visibility；profile 编辑、approval inbox 和完整 run graph 仍保留在后续阶段。
- 与本地 Pi 仓库（`/Users/jiantianjianghui/gh_projects/pi`）的模块、数据流与测试覆盖对照见下文「Etyon 与 Pi Harness 对照」。

## 激进架构进步方向

如果目标不是低风险接入，而是尽快追上当前 Pi、Mastra 这类 agent runtime，Etyon 需要把架构重心从 “chat app 增强” 转成 “本地 Agent Workbench”。这意味着要主动推翻一些现有假设。

### 需要推翻的现有假设

| 现有假设                                       | 激进路线                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `chat_messages` 是会话事实来源                 | append-only `agent_events` / `agent_messages` 是事实来源，chat 只是投影                                         |
| `/api/chat` 负责 prompt、memory、model、stream | `AgentKernel` 负责 run orchestration，HTTP route 只是入口 adapter                                               |
| 一个 session 选一个 model                      | 每个 step / sub-agent / tool summary 都可由 model router 决定                                                   |
| `@` 文件 snapshot 是主要项目上下文             | 项目上下文升级为 workspace substrate：文件、symbols、git、diagnostics、memory、artifacts 都是 context providers |
| skills 主要是 system prompt 文本               | skills 升级为可声明 capabilities、tools、processors、context loaders 的 agent package                           |
| tool call 是一次请求内的临时过程               | tool call 是可持久化、可审批、可恢复、可审计的 state machine                                                    |
| UI 以 chat transcript 为中心                   | UI 以 run graph / timeline / artifacts / approvals 为中心，chat 是其中一个视图                                  |

### `AgentKernel` 成为主架构

建议新增一个独立的 main-process kernel，而不是把能力继续堆进 `/api/chat`：

```text
Renderer surfaces
  Chat View
  Agent Workbench
  Approval Inbox
  Run Timeline
  Artifacts / Diff View
        ↓
Agent UI Adapter
        ↓
AgentKernel
  Run Scheduler
  Context Graph
  Model Router
  Tool Runtime
  Permission Engine
  Event Store
  Memory Writer
  Stream Multiplexer
        ↓
Workspace Substrate / Providers / Tools / Models
```

`AgentKernel` 的职责：

- 接收来自 chat、Telegram、快捷命令、后台任务的 run request。
- 创建 `agent_run`，分配 profile、model policy、tool policy 和 budget。
- 构建 context graph，而不是直接拼 system prompt 字符串。
- 驱动 step loop、tool call、approval、sub-agent run、retry 和 abort。
- 写入 append-only event log。
- 把内部事件转换成 UI stream、chat message projection 和通知。

`/api/chat` 在激进路线里只做兼容入口：

```text
/api/chat request
  -> AgentKernel.startRun({ source: "chat", ... })
  -> AgentUIAdapter.toAiSdkUiStream(runId)
  -> response
```

### 事件溯源替代消息快照

当前 `replaceChatMessages()` 整体替换 `UIMessage[]`，适合简单 chat，但不适合 agent：

- 无法表达 tool pending / approved / denied / resumed 的生命周期。
- 无法可靠重放 sub-agent trace。
- 难以保留 provider payload、tool output、截断引用、错误、重试和 abort。
- regenerate、fork、branch、compaction 会和 snapshot 互相覆盖。

激进路线应把 event log 做成核心表：

```text
agent_runs
agent_run_edges
agent_events
agent_messages
agent_steps
agent_tool_calls
agent_approvals
agent_artifacts
agent_context_items
agent_checkpoints
```

`chat_messages` 变成 projection：

- chat 列表从 `agent_runs` / `agent_messages` 派生。
- assistant bubble 从 `agent_events` 聚合成 `UIMessage`。
- tool trace、approval、sub-agent child messages 从 event store 懒加载。
- regenerate / fork 本质是从某个 event checkpoint 新建 branch run。

这会更接近 Pi 的 append-only session tree，也更适合 Mastra 的 durable / resumable tool flow。

### Workspace Substrate

Etyon 已经有 project snapshot、文件树、Shiki preview、git status 和 skills。激进路线应把这些从 UI / chat helper 升级为 workspace substrate：

```text
Workspace
  File Index
  Symbol Index
  Git Index
  Diagnostics Index
  Command History
  Tool Output Cache
  Project Memory
  Artifacts
  Context Packs
```

核心变化：

- `@` 文件引用不再直接拼 preview，而是生成 `context_item`。
- context builder 从多个 provider 拉取结构化 context，再按模型预算编译成 prompt。
- code tools 读取同一个 workspace index，避免 `rg`、snapshot、UI tree 各扫各的。
- 诊断、测试失败、git diff、最近修改、用户选区都成为可查询 context provider。
- 长期 memory 与项目 index 关联，不只是 `source=chat-session` 的文本摘要。

这样 agent 才能在大型项目中持续工作，而不是每次从 chat 文本和零散文件 preview 重新开始。

### Agent Graph 而不是 Sub-Agent Tool 列表

保守路线用 `agent_<profileId>` tool 足够起步，但激进路线应把 multi-agent 建模成 run graph：

```text
Parent Run
  Step: plan
  Child Run: explore-auth
  Child Run: explore-ui
  Step: synthesize
  Child Run: coder
  Child Run: review
  Step: final-response
```

每个 node 都有：

- `profileId`
- `role`
- `inputContextRefs`
- `outputArtifactRefs`
- `modelPolicy`
- `toolPolicy`
- `budget`
- `status`
- `parentRunId`

优势：

- 子 agent 不只是一个 tool result，而是可观察、可恢复、可独立测试的 run。
- planner、executor、reviewer、harness-operator 可以形成固定 graph template。
- 并发 explore 可以天然表达为 sibling runs。
- UI 可以按 graph 展示每个 agent 做了什么，而不是在一条 assistant 消息里折叠所有信息。

首批可内置这些 graph template：

| Template              | 结构                                           | 用途            |
| --------------------- | ---------------------------------------------- | --------------- |
| `solo-coder`          | `coder -> review`                              | 小范围实现      |
| `plan-execute-review` | `plan -> explore* -> coder -> review -> final` | 中等复杂度任务  |
| `investigation`       | `plan -> explore* -> synthesize`               | 只读排查        |
| `harness-debug`       | `inspect-run -> inspect-events -> propose-fix` | 调试 agent 自身 |

#### Plan / Execute 工程详设

Pi 的 plan/execute 不在 core agent 包里，而是作为 **extension**（`examples/extensions/plan-mode/`）实现，以证明 extension 机制足够支撑此类高级流程。Etyon 目标在 agent graph 层面内置 plan/execute，同时保留 Pi 的核心思路。

**Plan 阶段（read-only）：**

- 用户通过 `/plan` 命令或 `Ctrl+Alt+P` 进入 plan mode。
- `setActiveTools(["read", "bash", "grep", "find", "ls", "questionnaire"])` — 仅暴露只读工具。
- `tool_call` hook 拦截非 allowlist 的 bash 命令。
- `before_agent_start` 注入 `[PLAN MODE ACTIVE]` custom message，指导模型输出结构化 plan。
- plan 输出格式：numbered todo list，每条包含 action、files、risk level。

**Execute 阶段：**

- 用户确认执行 plan 后切换到 `executionMode = true`。
- `setActiveTools(NORMAL_MODE_TOOLS)` — 恢复 edit / write 工具。
- `before_agent_start` 注入 `[EXECUTING PLAN]` + 剩余 todo items。
- 解析 assistant 回复中的 `[DONE:n]` 标记更新进度。
- 状态通过 session custom entry `plan-mode` 持久化（支持断点续做）。

**Handoff 协议：**

- plan agent 产出 JSON 结构化 plan → parent run 验证格式 → 用户 confirm → 创建 execute child run。
- execute child run 的 context 只包含 plan 内容 + 必要的 file summaries，不含 plan 阶段的完整探索对话。
- 每个 plan step 完成后 emit `plan_step_completed` event，UI 可实时显示进度。
- execute child run 失败时，parent run 可根据 `failFast` 策略决定跳过 / retry / abort。

**Etyon 首版路径：**

- P4 用 `agentPlan` + `agentCoder` 子 agent 模拟 plan-execute 工作流。
- P5 用 run graph 建模 `plan-execute-review` template。

### Durable Execution

Agent 要追上 Pi / Mastra，必须支持 run 的暂停与恢复：

- 等待用户 approval。
- 等待长命令完成。
- app 重启后恢复 pending run。
- 网络 / provider 报错后可 retry。
- 用户中断后保留 checkpoint。
- 子 agent 失败后父 run 可继续或重试。

这需要每个 tool call 都有明确 state：

```text
created -> approval_requested -> approved -> running -> succeeded
                          └── denied -> skipped
                   running -> failed -> retrying -> succeeded
                   running -> aborted
```

`AgentKernel` 不能依赖单个 HTTP request 生命周期。HTTP stream 断开时 run 可以继续、暂停或取消，UI 重新连接时从 event store 恢复。

#### Durable Approval 恢复流程

1. tool call 到达 approval 阶段 → `tool_call_approval_requested` event + `status: "approval_requested"` 写入 `agent_tool_calls`。
2. run 进入 suspended 状态，harness phase 仍为 `turn`。
3. UI disconnect 或 app 关闭时，run status 在 DB 记为 `suspended`。
4. app 重启 → 扫描 `agent_runs` 中 `status = "suspended"` 的 runs。
5. 恢复 run：从 `agent_events` 重建 context（messages + tools + model），恢复到 approval 等待点。
6. 用户 approve → emit `tool_call_approved` → 执行 tool → loop 继续。
7. 用户 deny → emit `tool_call_denied` → tool result `isError: true` + reason → loop 继续（模型看到拒绝原因）。

#### App 重启后的 Run 恢复

Pi 的 `durable-harness.md` 描述了半持久化设计：session 是 append-only 的真相源，但 tools / model / hooks 需要 app 重新注入。

Etyon 恢复流程：

1. 读取 `agent_runs` 中未终结的 run（`status IN ("running", "suspended")`）。
2. 从 `agent_events` 重建到最后一个 save-point 的 model context。
3. 从 settings 重新绑定 tools / model / profile（不持久化运行时闭包）。
4. 如果 run 是因 approval 暂停 → 保持 suspended，等待用户操作。
5. 如果 run 是因 crash 中断 → 标记为 `failed`，提供手动 retry 按钮。
6. pending session writes（queue 中的 steer / follow-up 消息）可选持久化到 `agent_events` 的 custom entry，恢复时 replay。

### Capability-Based Tool Runtime

Mastra 的工具来源很多，Pi 的执行边界很清晰。Etyon 可以把 tools 统一成 capability manifest：

```ts
type ToolManifest = {
  capabilities: Array<
    "read-fs" | "write-fs" | "shell" | "network" | "git" | "memory" | "ui"
  >
  id: string
  inputSchema: unknown
  outputSchema: unknown
  owner: "builtin" | "skill" | "mcp" | "project" | "provider"
  riskLevel: "safe" | "medium" | "high"
}
```

然后由 policy compiler 决定：

- 当前 profile 能不能看到这个 tool。
- 当前 workspace 能不能执行这个 capability。
- 当前 input 是否需要 approval。
- 当前 tool result 对父模型可见多少。
- 当前输出是否需要 summary / artifact 化。

这会比 “工具数组 + needsApproval” 更适合长期扩展到 MCP、skills、workspace tools、provider-defined tools 和 app 内 UI tools。

### Model Router

当前 session 只有一个 `modelId`，但 agent runtime 需要 step-level model routing：

- planner 可用强推理模型。
- explorer 可用便宜快速模型。
- tool result summary 可用本地或低成本模型。
- reviewer 可用偏严格模型。
- provider 报错时 fallback。
- long-context 文件分析可选大上下文模型。
- structured output 可选 schema-following 更稳定的模型。

建议新增 `ModelRouter`：

```text
resolveModelForStep({
  budget,
  desiredCapabilities,
  fallbackChain,
  profileId,
  runId,
  stepKind,
  userSelectedModel
})
```

这样 chat toolbar 选的 model 只是 user preference，不再硬绑定每一步。

### Memory 分层

当前 memory 已经有 session memory 和 long-term memory，但 agent 需要更多层：

| Memory            | 作用                              |
| ----------------- | --------------------------------- |
| run scratchpad    | 当前 run 内 plan、假设、临时发现  |
| branch memory     | fork / regenerate 后保留分支差异  |
| project memory    | 项目约定、架构事实、历史决策      |
| tool result cache | 大型 grep、测试、构建输出摘要     |
| user preference   | 用户对风格、权限、流程的偏好      |
| artifact memory   | patch、diff、报告、生成文件的引用 |

关键是 memory write 必须显式：

- 哪个 run 写入。
- 哪个 event 触发。
- 是否来自模型总结还是确定性摘要。
- 可见范围是什么。
- 何时过期或需要重新验证。

不要让 `replaceChatMessages()` 顺手写长期 memory 成为 agent 时代的主写入路径。

### Hook / Middleware 系统

Pi 的 hook 设计非常值得 Etyon 学。激进路线需要一套 kernel middleware：

```text
before_context_build
after_context_build
before_model_resolve
before_provider_request
before_provider_payload
after_provider_response
before_tool_call
after_tool_call
before_subagent_start
after_subagent_finish
before_memory_write
after_run_finish
```

用途：

- 调试 provider payload。
- 注入 tracing。
- 修改 stream options。
- 拦截危险工具。
- 压缩 tool output。
- 写 Token Savings。
- 做 regression capture。
- 给 project skill / plugin 提供安全扩展点。

这比把所有逻辑写进 `AgentRuntime` 更可维护。

### UI 升级为 Agent Workbench

如果架构激进，UI 也要从 chat 页面升级：

- 左侧：sessions / runs / branch tree。
- 中间：chat projection。
- 右侧：run graph、event timeline、tool trace、sub-agent runs。
- 底部或侧栏：approval inbox。
- 文件区：artifacts、diff、test output、tool output。
- 顶部：profile、graph template、model policy、run budget。

chat bubble 不应承载全部细节。用户真正需要的是：

- 当前 agent 卡在哪里。
- 哪个 tool 想执行什么。
- 子 agent 发现了什么证据。
- 哪些文件被读 / 写。
- 当前 patch 和测试状态。
- 这次 run 是否可恢复、可 fork、可 replay。

### 流式协议和 Projection 层

AI SDK UI stream 适合 chat，但 agent workbench 需要更丰富事件。建议分两层：

```text
Agent Event Stream
  kernel-native events, durable, replayable

AI SDK UI Stream
  chat-compatible projection, generated from Agent Event Stream
```

Renderer 的 chat 继续吃 AI SDK `UIMessage`，Workbench 吃 native agent events。这样既不丢 AI SDK 生态，又不会被 `UIMessage` 限制 agent 表达能力。

### 激进路线的落地顺序

如果选择激进路线，不建议先做一堆 UI。应先完成 runtime 基座：

1. 新建 `AgentKernel`、`AgentEventStore`、`RunScheduler`，让现有 `/api/chat` 通过 kernel 跑一个 text-only run。
2. 把 `chat_messages` 改成 projection 写入，原始事实进入 `agent_events`。
3. 引入 `ToolRuntime` 和只读 tools，让 tool call 也通过 event log。
4. 引入 durable approval，支持 app 重启后恢复 pending tool。
5. 引入 workspace substrate，统一 project snapshot、file tree、git diff、search。
6. 引入 run graph 和 sub-agent child runs。
7. 引入 Agent Workbench UI。
8. 引入 skill / MCP / provider-defined tool packages。
9. 引入 model router、tool summary cache、evaluation / regression capture。

这条路线比保守路线更慢见效，但上限更高。它能把 Etyon 从 “桌面 chat + 工具” 推到 “本地 agent 操作系统”。

## 外部调研结论

### Pi Harness

Pi 的设计重点不是单个 tool，而是 agent harness。完整架构分为两个包：

**`packages/agent/`（`@earendil-works/pi-agent-core`）— 底层引擎**

核心模块：

- `agent-loop.ts`：双层循环引擎（内层 tool call + steering；外层 follow-up）。事件驱动，全程通过 `AgentEventSink` 推送 `AgentEvent`。
- `agent.ts`：`Agent` 有状态封装，持有 `state`（systemPrompt、model、tools、messages），提供 `subscribe`、`prompt()`、`continue()`、mutators、并发 guard。
- `harness/agent-harness.ts`：`AgentHarness` 编排层。Phase 状态机（idle / turn / compaction / branch_summary / retry）。持有 session、环境、队列、hooks。公开 API 分为运行（`prompt`、`skill`、`promptFromTemplate`）、队列（`steer`、`followUp`、`nextTurn`）、配置 setter、`abort`、`waitForIdle`、`subscribe`/`on`。
- `harness/session/`：append-only 树结构。Entry 类型：message / thinking_level_change / model_change / compaction / branch_summary / custom / custom_message / label / session_info / leaf。`buildContext()` 从 leaf 沿 parentId 重建 model context，处理 compaction skip 和 branch summary 注入。持久化支持 `InMemorySessionStorage` 和 `JsonlSessionStorage`（v3 格式）。
- `harness/compaction/`：token 估算（usage + 启发式）、切分点（keepRecentTokens）、LLM summary 生成（支持增量更新 + reasoning model）、split-turn 并行 summary、branch summarization。
- `harness/env/nodejs.ts`：`NodeExecutionEnv = FileSystem & Shell`。FileSystem 20+ 方法全部返回 `Result<T, FileError>`；Shell 返回 `Result<ShellResult, ExecutionError>`。大输出落盘 + 二进制清理（`sanitizeBinaryOutput`）。
- `harness/messages.ts`：declaration merge `CustomAgentMessages` 扩展应用消息；`convertToLlm` 过滤非 LLM 消息。
- `harness/skills.ts` + `prompt-templates.ts`：从 `SKILL.md` / `.md` 文件结构化加载，支持 frontmatter、source 元数据、参数替换。
- `harness/utils/`：`truncateHead/Tail/Line`（UTF-8 安全）、`formatSize`、`executeShellWithCapture`（大输出落盘）。
- `proxy.ts`：HTTP 代理 LLM stream，partial message 重建。
- `types.ts`：全部核心类型，含 `AgentToolCall`、`BeforeToolCallContext`/`Result`、`AfterToolCallContext`/`Result`、`AgentLoopConfig`、`AgentEvent`、`ThinkingLevel` 等。

**`packages/coding-agent/`（CLI / `AgentSession` 集成）— 应用层**

核心模块：

- `core/agent-session.ts`：`AgentSession` 类，包装 `Agent`（不是 `AgentHarness`）。职责：event → 持久化 + extension 分发 + auto-compaction + retry + bash 状态管理。公开方法：`prompt()`、`steer()`、`followUp()`、`setModel()`、`compact()`、`navigateTree()`、`executeBash()`、`dispose()` 等。
- `core/agent-session-runtime.ts`：`AgentSessionRuntime`，持有 session + cwd-bound services，支持 `/new`、`/resume`、`/fork`、`/import` 时 teardown + 重建。
- `core/sdk.ts`：`createAgentSession()` 工厂：创建 `Agent` + `AgentSession`，是正常启动入口。
- `core/extensions/`：四层扩展机制——loader（jiti 加载 `.ts`）→ types（`ExtensionFactory`、lifecycle events）→ runner（`ExtensionRunner`：event 分发、core binding）→ wrapper（tool 包装注入 `ExtensionContext`）。Extension 可通过 `pi.registerTool()`、`pi.registerCommand()`、`pi.registerFlag()`、`pi.on(event)` 扩展行为。
- `core/tools/`：7 个内置 tool（read、bash、edit、write、grep、find、ls）。双工厂模式：`createXxxToolDefinition()` → `ToolDefinition` + `createXxxTool()` → `AgentTool`。工具注册通过 `_toolRegistry` Map，`setActiveToolsByName()` 写入 `agent.state.tools` 并重建 system prompt。
- `core/compaction/`：应用层 compaction（在 core agent 的 compaction 基础上加 auto-compaction 触发和 branch summary 调度）。
- `examples/extensions/plan-mode/`：plan/execute 工程示例——plan 阶段只暴露只读 tools，execute 阶段恢复写入 tools，`[DONE:n]` 进度追踪，session custom entry 持久化。

关键设计模式（对 Etyon 全部目标复刻）：

- **事件驱动**：`AgentEvent` / `AgentHarnessEvent` / `AgentSessionEvent` 全链路；UI 与持久化通过 subscribe/on 解耦。
- **双层循环状态机**：外层 follow-up、内层 tool+steering；Phase 限制并发操作。
- **Append-only 树**：Session entries 带 `parentId`；`leaf` entry 标记当前分支；fork/navigate 不删历史。
- **Snapshot 隔离**：Turn snapshot 与 harness config 分离；in-flight provider 请求不受 setter 影响。
- **Result 错误边界**：底层用 `Result<T,E>` 不抛异常；高层 throw `AgentHarnessError`（typed code）。
- **Declaration merging**：`CustomAgentMessages` 扩展应用层消息类型。
- **Hook 拦截链**：`beforeToolCall`/`afterToolCall`、`context`、`session_before_compact/tree` 可 patch 或 cancel。hook 异常不回滚已 commit 状态。
- **Queue 模式**：steering / follow-up 支持 `"all"` 或 `"one-at-a-time"` drain。
- **工具双工厂**：`ToolDefinition`（含 render、promptSnippet）→ `AgentTool`（含 execute），分离定义与运行时。
- **测试基础设施**：`test/suite/harness.ts` 创建完整 `AgentSession` + faux provider（`registerFauxProvider` → `setResponses`/`appendResponses`），零网络确定性测试。回归测试 `regressions/` 按 issue 编号命名。

对 Etyon 的启发：不要把工具执行直接塞进 `/api/chat` route。需要一个 agent runtime facade，route 只负责把 chat 请求转成 agent run，并把 UI stream 返回给 renderer。

对照基准：本地 Pi 仓库 [`/Users/jiantianjianghui/gh_projects/pi`](file:///Users/jiantianjianghui/gh_projects/pi)，核心包为 `packages/agent/`（harness + loop）与 `packages/coding-agent/`（CLI / `AgentSession` 集成）。下文「Pi」若无特别说明，均指该仓库。

### Etyon 与 Pi Harness 对照

Etyon 当前是 **AI SDK `streamText` + profile / tool 注册 + SQLite 事件旁路** 的首版 chat 内 agent；Pi 是 **自研 `AgentHarness` + `agentLoop` + append-only Session 树 + `ExecutionEnv`** 的完整 harness runtime。二者目标相近，分层不同。

#### 架构模块映射

| Pi 概念 / 模块                | Pi 路径（相对 `pi/`）                                                               | Etyon 对应                                                                                                                                                            | 关系说明                                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentHarness`                | `packages/agent/src/harness/agent-harness.ts`                                       | 无独立类；[`agent-runtime.ts`](../apps/desktop/src/main/agents/agent-runtime.ts) 中 `streamAgentChat()`                                                               | **部分**：创建 `agent_run`、写 events、子 agent 委派；**缺** phase（idle/turn/compaction）、`steer` / `followUp` 队列、`waitForIdle`、save-point 刷新快照   |
| `runAgentLoop` / `agentLoop`  | `packages/agent/src/agent-loop.ts`                                                  | AI SDK `streamText({ tools, stopWhen })` / 子 run 用 `generateText`                                                                                                   | **委托**：多步 tool loop 由 SDK 承担；**缺**自研 loop 上的 `beforeToolCall` 阻断、`afterToolCall` terminate batch、parallel 完成顺序 vs 写回顺序分离        |
| Turn 快照 `createTurnState()` | `packages/agent/docs/agent-harness.md`                                              | 无                                                                                                                                                                    | 每请求直接拼 `profile.instructions` + `buildAgentTools()` + 既有 chat system prompts；运行中改 model/tools 不影响在途 provider 请求（Pi 用快照显式保证）    |
| `Session`（append-only 树）   | `packages/agent/src/harness/session/`                                               | [`chat_messages`](../apps/desktop/src/main/chat-messages.ts) 快照 + [`agent_events`](../apps/desktop/src/main/agents/agent-event-store.ts)                            | **双轨**：UI 恢复靠 `UIMessage[]`；审计靠 `agent_runs` / `agent_events` / `agent_tool_calls`。**缺** branch、leaf move、从 event log 单独重建 model context |
| `ExecutionEnv`                | `packages/agent/src/harness/env/nodejs.ts`                                          | [`tool-registry.ts`](../apps/desktop/src/main/agents/tool-registry.ts) 内联 `spawn`、`readProjectFile` 等                                                             | **未抽象**：无统一 cwd / abort / 大输出落盘 / symlink 策略模块                                                                                              |
| Tool 钩子                     | `beforeToolCall` / `afterToolCall`（`packages/agent/src/types.ts`）                 | `experimental_onToolCallStart` / `Finish`（仅写 event store）                                                                                                         | **观测为主**：无改参、阻断、patch result、终止循环                                                                                                          |
| Tool 注册与过滤               | `coding-agent` tools + harness active tools                                         | [`profiles.ts`](../apps/desktop/src/main/agents/profiles.ts) + [`tool-registry.ts`](../apps/desktop/src/main/agents/tool-registry.ts)                                 | **已对齐思路**：profile `toolPolicy` 决定暴露工具；子 agent scope 可去掉 approval / delegation tools                                                        |
| 权限 / 审批                   | extension、`AgentSession` 层                                                        | [`permission-engine.ts`](../apps/desktop/src/main/agents/permission-engine.ts) + AI SDK `needsApproval`                                                               | Etyon **更显式**；UI 侧 `approval-requested` + `addToolApprovalResponse()`。**缺** durable approval 恢复专用测试与持久化状态机                              |
| 子 agent                      | `coding-agent` extensions（非 agent 包核心测试）                                    | `agentExplore` / `agentPlan` / `agentReview` → child `generateText` run                                                                                               | **agent-as-tool**：独立 `parentRunId`、摘要回父模型、child 禁用 delegation。**待加强测试**：父 history 不进入 child messages                                |
| Provider stream 配置          | `packages/agent/test/harness/agent-harness-stream.test.ts`                          | 无                                                                                                                                                                    | **未做** request hook、headers/metadata patch、在途请求与 config 分离                                                                                       |
| Compaction                    | `packages/agent/src/harness/compaction/`                                            | [`chat-session-memory.ts`](../apps/desktop/src/main/chat-session-memory.ts)、`settings.chat.autoCompact`                                                              | **不在 agent 层**；与 Pi harness compaction 不同域                                                                                                          |
| 应用集成层                    | `packages/coding-agent/src/core/agent-session.ts`                                   | [`chat.ts`](../apps/desktop/src/main/server/routes/chat.ts) → [`build-chat-stream-response.ts`](../apps/desktop/src/main/server/routes/build-chat-stream-response.ts) | route 已经 `streamAgentChat` 注入 tools，但 memory / `@` / skills 仍在 route 层拼装，尚未收成 `AgentKernel`                                                 |
| `AgentLoop` 双层循环          | `packages/agent/src/agent-loop.ts`（内层 tool+steering；外层 follow-up）            | AI SDK `streamText` 内部 loop                                                                                                                                         | **委托**：自研 loop 的 `prepareNextTurn`、双层 follow-up、steering inject 点不可见                                                                          |
| Plan / Execute 工程           | `packages/coding-agent/examples/extensions/plan-mode/`                              | `agentPlan` / `agentCoder` delegation tool                                                                                                                            | **缺** plan mode 的 tool allowlist 切换、`[DONE:n]` 进度追踪、session custom entry 持久化、execute handoff 协议                                             |
| Extension 机制                | `packages/coding-agent/src/core/extensions/`（loader → types → runner → wrapper）   | 无                                                                                                                                                                    | **缺**：jiti 加载、lifecycle events、`pi.registerTool()`、`pi.on(event)` 扩展点。Etyon 后续可用 Hook/Middleware 替代                                        |
| 错误处理分层                  | `packages/agent/src/harness/types.ts`（`Result<T,E>`）+ `AgentHarnessError`         | 无显式分层                                                                                                                                                            | **缺**：底层 Result 模式、高层 typed error、hook 错误不回滚语义                                                                                             |
| Prompt Template               | `packages/agent/src/harness/prompt-templates.ts`                                    | system prompt 硬拼                                                                                                                                                    | **缺**：`$1`/`$2` 参数替换、shell 风格 args 解析、template 加载与格式化                                                                                     |
| Skills 结构化加载             | `packages/agent/src/harness/skills.ts`                                              | context-builder 步骤 5 文本注入                                                                                                                                       | **缺**：`SKILL.md` frontmatter 解析、source 元数据、model-disabled 跳过                                                                                     |
| 消息类型扩展                  | `packages/agent/src/harness/messages.ts`（declaration merge `CustomAgentMessages`） | 无                                                                                                                                                                    | **缺**：`AgentMessage` 扩展、`convertToLlm` 对自定义消息的排除/转换                                                                                         |
| Truncate 工具                 | `packages/agent/src/harness/utils/truncate.ts`                                      | tool result budget（散在各 tool）                                                                                                                                     | **缺**：统一 `truncateHead/Tail/Line`、UTF-8 安全截断、`formatSize`                                                                                         |
| Shell 输出捕获                | `packages/agent/src/harness/utils/shell-output.ts`                                  | inline spawn in tool-registry                                                                                                                                         | **缺**：`executeShellWithCapture` 大输出落盘、`sanitizeBinaryOutput` 二进制清理                                                                             |
| Agent 有状态封装              | `packages/agent/src/agent.ts`（`Agent` 类：state、subscribe、mutators、并发 guard） | `streamAgentChat` 无状态函数                                                                                                                                          | **缺**：有状态 Agent 实例、subscriber 模式、并发 guard                                                                                                      |
| Proxy Stream                  | `packages/agent/src/proxy.ts`（`streamProxy`、HTTP 代理 LLM、partial message 重建） | 无                                                                                                                                                                    | **不适用于首版**（Etyon 走 renderer ↔ Hono 本地通信）                                                                                                       |

#### 数据流对照（简图）

```text
Pi:
  AgentHarness.prompt()
    -> createTurnState()
    -> runAgentLoop (before/afterToolCall, steer queue)
    -> Session append (tree) + ExecutionEnv
    -> stream hooks -> provider

Etyon（当前）:
  POST /api/chat
    -> memory / @ / skills（route 层）
    -> streamAgentChat()
         -> createAgentRun + agent_events（旁路）
         -> streamText(tools, stopWhen) 或 generateText（子 agent）
         -> onFinish -> replaceChatMessages（UI 快照）
```

#### 测试覆盖映射

Pi `packages/agent/test/` 约 16 个专项文件；Etyon `apps/desktop/test/main/agents/` 当前 5 个文件。下表说明 Pi 用例形态与 Etyon 落地状态（截至文档更新时）。

| Pi 参考测试                            | 覆盖意图                                          | Etyon 对应测试                                    | 状态                                                               |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `agent-loop.test.ts`                   | mock 两轮：tool 执行 → result 进下一轮；事件顺序  | —                                                 | **未开始**（runtime 仅断言 `streamText` 选项，未 mock 两轮 model） |
| `agent-loop.test.ts`                   | parallel 完成顺序 vs tool result 写回顺序         | —                                                 | **未开始**                                                         |
| `agent-loop.test.ts`                   | steering 队列在 tool batch 完成后注入             | —                                                 | **未开始**（无 steering 功能）                                     |
| `agent-loop.test.ts`                   | `beforeToolCall` 改参 / `afterToolCall` terminate | —                                                 | **未开始**                                                         |
| `harness/agent-harness.test.ts`        | steer / follow-up / abort 队列、hook settlement   | —                                                 | **未开始**                                                         |
| `harness/agent-harness-stream.test.ts` | stream options 与 provider hook                   | —                                                 | **未开始**                                                         |
| `harness/session.test.ts`              | branch、leaf、compaction 上下文重建               | —                                                 | **未开始**（agent 层无 Session 树）                                |
| `harness/nodejs-env.test.ts`           | `ExecutionEnv` 边界                               | —                                                 | **未开始**（无 `execution-env` 模块）                              |
| `harness/compaction.test.ts`           | token 切分、summary                               | —                                                 | **不适用**（走 chat auto-compact）                                 |
| Mastra 形态 `tool-call-step`           | approval suspend → approve/deny                   | `tool-registry.test.ts`（`needsApproval` 存在性） | **部分**（无完整 approval-flow 用例）                              |
| Mastra 形态 `subagent-tool`            | 子 agent 上下文隔离、无 metadata 泄漏             | `agent-runtime.test.ts`（delegation 一条）        | **部分**                                                           |
| —                                      | profile / 工具策略                                | `profiles.test.ts`、`tool-registry.test.ts`       | **已落地**                                                         |
| —                                      | allow / ask / deny                                | `permission-engine.test.ts`                       | **已落地**                                                         |
| —                                      | event store 顺序与 tool_calls                     | `agent-event-store.test.ts`                       | **已落地**                                                         |
| —                                      | agents 关/开、route 注入 tools                    | `agent-runtime.test.ts`、`app.test.ts`            | **部分**（route 测在 `app.test.ts`，非 `chat.test.ts`）            |

**Pi `packages/agent/test/` 完整参考（16 个文件）：**

| 测试文件                               | 测试数 | 覆盖域                                                                                                                               |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-loop.test.ts`                   | 20     | 双层循环、事件序列、custom message、transformContext、parallel/sequential、steering、prepareNextTurn、shouldStopAfterTurn、terminate |
| `agent.test.ts`                        | 16     | Agent 类构造、订阅、async listener、abort signal、mutators、队列、并发 guard、continue 语义                                          |
| `e2e.test.ts`                          | 10     | Agent + faux provider 端到端                                                                                                         |
| `harness/agent-harness.test.ts`        | 10     | 队列、hooks、save point、pending writes、waitForIdle、tool hooks、resources                                                          |
| `harness/agent-harness-stream.test.ts` | 4      | stream options snapshot、patch 链、payload hooks                                                                                     |
| `harness/session.test.ts`              | 18     | branch、leaf、compaction context 重建（in-memory + JSONL 参数化）                                                                    |
| `harness/storage.test.ts`              | 13     | InMemorySessionStorage + JsonlSessionStorage                                                                                         |
| `harness/repo.test.ts`                 | 3      | session 仓库                                                                                                                         |
| `harness/compaction.test.ts`           | 17     | token 计算、cut point、prepare/compact、generateSummary、split-turn                                                                  |
| `harness/nodejs-env.test.ts`           | 18     | FS 全量、symlink、exec、timeout、abort、大输出                                                                                       |
| `harness/skills.test.ts`               | 5      | skill 加载                                                                                                                           |
| `harness/system-prompt.test.ts`        | 3      | system prompt 格式化                                                                                                                 |
| `harness/prompt-templates.test.ts`     | 5      | prompt 模板加载与格式化                                                                                                              |
| `harness/truncate.test.ts`             | 8      | 输出截断                                                                                                                             |
| `harness/session-uuid.test.ts`         | 1      | UUIDv7                                                                                                                               |
| `harness/resource-formatting.test.ts`  | 2      | 资源格式化                                                                                                                           |

**Pi `packages/coding-agent/test/suite/` 参考（AgentSession 层 8 个文件 + 17 个回归）：**

| 测试文件                                 | 覆盖域                                                               |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `agent-session-prompt.test.ts`           | prompt → agent loop → event 序列                                     |
| `agent-session-queue.test.ts`            | steer / followUp 队列行为                                            |
| `agent-session-compaction.test.ts`       | auto-compaction 触发与 summary                                       |
| `agent-session-bash-persistence.test.ts` | bash 命令状态持久化                                                  |
| `agent-session-model-extension.test.ts`  | 模型切换与 extension 交互                                            |
| `agent-session-retry-events.test.ts`     | 自动 retry 事件序列                                                  |
| `agent-session-runtime.test.ts`          | runtime teardown / rebuild                                           |
| `regressions/*.test.ts` (17 个)          | event settlement、stale resource、skill collision、tool allowlist 等 |

**Etyon 与 Pi 测试工厂对照：**

| Pi 工厂（`test/suite/harness.ts`）               | Etyon 对应                                                          | 说明                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `createHarness(options?)`                        | `agent-runtime.test.ts` 内 `vi.mock()` + 直接调用 `streamAgentChat` | Pi 创建完整 `AgentSession` + faux provider；Etyon 仅 mock `streamText` |
| `registerFauxProvider()` → `faux.setResponses()` | 无                                                                  | **需补**：确定性 LLM 响应工厂                                          |
| `harness.session.subscribe()` → `events[]`       | `agent-runtime.test.ts` 中 `onToolCallStart`/`Finish` callback      | **更弱**：只观测 tool，不收集全量 agent 事件                           |
| `harness.faux.appendResponses()`                 | 无                                                                  | **需补**：多轮 response 序列注入                                       |

**建议补测优先级**（对齐 Pi 收益最高、且不改架构即可做的项）：

1. mock 两轮 `LanguageModel`：`agent-runtime.test.ts` 扩展为完整 loop + `agent_events` 序列断言。
2. 新增 `approval-flow.test.ts`：suspend / approve / deny 与 tool error 文案。
3. 子 agent：断言 `generateText` 的 `messages` 不含父会话 parts。
4. 抽 `execution-env.ts` 后再 port Pi `nodejs-env.test.ts` 子集（symlink、timeout、截断）。
5. 引入 faux provider 工厂（参考 Pi `createHarness`），支持确定性多轮响应序列。
6. 新增 `agent-loop.test.ts`：parallel 完成顺序 vs 写回顺序、beforeToolCall 阻断、afterToolCall terminate。
7. 新增 `stream-options.test.ts`：stream options 快照隔离与 provider hook 链。
8. 新增 `session-tree.test.ts`：branch、leaf move、compaction context 重建（P5 阶段）。
9. 新增回归测试文件夹 `regressions/`：按 Pi 模式为每个 bug fix 创建编号测试。

### Mastra

Mastra 的重点是 tool registry、agent-as-tool 和 stream 转换：

- Agent 会合并静态 tools、memory tools、toolsets、client-side tools、agent tools、workflow tools、workspace tools、skill tools 等来源。
- tool 名称会被标准化，并检测 provider 限制与名称冲突。
- 子 agent 被包装成普通 tool：父 agent 只看到一个 `agent_<name>` tool。
- 子 agent 有独立 thread / resource / memory，父 agent 上下文可以按策略传入，但不直接污染子 agent 持久化消息。
- 子 agent 输出默认只给父 agent 一个摘要，完整 tool details 保存在 trace / memory 里。
- 委派有 `onDelegationStart` 和 `onDelegationComplete` hook，可拒绝、修改或记录委派。
- stream 会经过转换层映射到 AI SDK UI stream，而不是把内部事件直接混入 UI message。
- 大型 tool result 可以被 summary processor 压缩和缓存，避免后续上下文被工具输出撑爆。

对 Etyon 的启发：multi-agent 首版应采用 agent-as-tool，而不是让多个模型共享同一上下文并自由互调。子 agent 输出应拆成 “父模型可见摘要” 与 “UI / audit 可见完整 trace”。

### AI SDK v6

AI SDK v6 已经覆盖首版所需的 tool 能力：

- `streamText()` 可以直接接 `tools` 和 `stopWhen: stepCountIs(n)` 实现多步 tool loop。
- `ToolLoopAgent` 是更结构化的 agent wrapper，支持 `tools`、`instructions`、`stopWhen`、`prepareStep`、`onStepFinish` 等。
- `tool()` 支持 `inputSchema`、`execute`、`needsApproval`、`toModelOutput`。
- `useChat` 可以渲染 `part.type === "tool-<toolName>"` 的 tool part。
- 需要审批的 server-side tool 会进入 `approval-requested` 状态，renderer 通过 `addToolApprovalResponse()` 继续或拒绝。
- 子 agent 可以作为 tool 执行，但 AI SDK 文档明确指出 sub-agent 内部 tool 不能使用 `needsApproval`。
- `createAgentUIStreamResponse()` 可以把实现了 `.stream()` 的 agent 直接转换成 UI response，适合 agent runtime 成熟后替换 route 内部实现。

对 Etyon 的启发：首版可以继续用 `/api/chat + streamText`，先打通 tool parts、approval 和事件记录；runtime 稳定后再把内部实现切到 `ToolLoopAgent` 或 `createAgentUIStreamResponse()`。

## 架构分层

建议新增 `apps/desktop/src/main/agents/`，把 agent 能力拆成以下模块。

### `AgentProfile`

描述一个 agent 预设：

- `id`
- `name`
- `description`
- `instructions`
- `modelPolicy`
- `thinkingPolicy`
- `toolPolicy`
- `delegationPolicy`
- `contextPolicy`
- `approvalPolicy`
- `budgetPolicy`

profile 是配置，不直接执行工具。内建 profile 走代码常量，用户自定义 profile 后续再进入 settings。

### `AgentLoop`

Pi 的 `agentLoop`（`packages/agent/src/agent-loop.ts`）是独立于 harness 的底层循环引擎。Etyon 首版委托给 AI SDK `streamText({ tools, stopWhen })`，后续可抽出自研 loop 获得以下细粒度控制。

#### 双层循环

```text
agentLoop(prompts, context, config)
  └─ runLoop
       ├─ 外层：消费 follow-up（agent 本应停止时插入新任务）
       └─ 内层（一次 turn）
            ├─ inject pendingMessages（steering）
            ├─ transformContext → convertToLlm → streamFn
            ├─ executeToolCalls（sequential 或 parallel）
            │    ├─ prepareToolCall（validate + beforeToolCall）
            │    ├─ executePreparedToolCall
            │    └─ finalizeExecutedToolCall（afterToolCall）
            ├─ prepareNextTurn（可替换 context / model / thinkingLevel）
            ├─ shouldStopAfterTurn → agent_end
            └─ getSteeringMessages / getFollowUpMessages
```

#### 工具并行调度

- 默认并行执行 tool batch；如果某 tool 声明 `executionMode: "sequential"` 则整个 batch 退化为串行。
- preflight（`beforeToolCall`）始终按 assistant 消息中的 source order 顺序执行。
- `tool_execution_end` 事件按**完成顺序**发出；`toolResult` 消息按**source order** 持久化回上下文，保证模型看到稳定顺序。

#### 终止条件

- `shouldStopAfterTurn` 返回 `true`。
- 同一 batch 中全部 tool result 均标记 `terminate: true`（部分 terminate 不停止）。
- `afterToolCall` hook 返回 `{ terminate: true }` 可覆盖。
- assistant `stopReason` 为 `error` 或 `aborted` 时立即结束。

#### Steering 与 Follow-Up

- `steer(message)` 在当前 tool batch 完成后注入新的 user message，驱动下一轮 turn。
- `followUp(message)` 在 agent 本应结束时注入新任务，驱动外层循环。
- 两种队列支持 `"all"` 和 `"one-at-a-time"` drain 模式。

#### `prepareNextTurn`

每轮 turn 结束后 harness 可通过回调替换下一轮的 `context.messages`、`model`、`thinkingLevel`，用于 save-point 快照刷新。

Etyon 首版用 AI SDK loop，以上行为不可见。待自研 loop 落地后，`AgentRuntime.streamChat` 内部切到 `runAgentLoop`。

### `AgentRuntime`

每次 chat 生成都创建一个 run：

- 解析 session、settings、model、mentions、skills。
- 构建 turn state。
- 选择 active profile 和 active tools。
- 调用 `streamText()` 或 `ToolLoopAgent.stream()`。
- 接收 step / tool / error callbacks。
- 写入 agent event store。
- 返回 AI SDK UI stream 给 `/api/chat`。

首版 route 仍可直接调用 runtime：

```ts
const response = await agentRuntime.streamChat({
  abortSignal,
  messages,
  modelId,
  profileId,
  sessionId
})
```

#### Phase 状态机

Pi `AgentHarness` 使用显式 phase 限制并发操作。Etyon 目标复刻以下模型：

```ts
type AgentRuntimePhase =
  | "idle"
  | "turn"
  | "compaction"
  | "branch_summary"
  | "retry"
```

- 结构性操作（`prompt` / `compact` / `navigateTree`）要求 `phase === "idle"`，开始前同步置 phase。
- `steer` / `followUp` / `abort` / 配置 setter 可在 turn 中调用。
- 并发结构操作会抛 `AgentRuntimeError("busy")`。

#### Turn 快照（TurnState）

每轮 turn 开始前创建只读快照，包含当前的 session messages、resolved resources、system prompt、active tools、model、thinking level、stream options。

- harness config setter 更新的是**下一轮**快照，不影响当前在途 provider 请求。
- system prompt provider 回调在 `createTurnState()` 中仅调用一次。
- stream options 中 `headers` 和 `metadata` 浅拷贝。
- provider 凭证（API key）在每次 provider request 时重新获取（支持 token 刷新）。

#### Settlement / `waitForIdle`

- `waitForIdle()` 阻塞直到当前结构操作完成、listener 结束、pending session writes flush。
- hook 失败不回滚状态变更，但 public method reject 为 `AgentRuntimeError("hook")`。

### `ToolCallEngineering`

Pi 的 tool call 工程化程度显著高于 Etyon 首版。Etyon 目标逐步对齐以下能力。

#### Tool Hook 合约

```ts
interface BeforeToolCallContext {
  toolCall: AgentToolCall
  args: Record<string, unknown>
  signal?: AbortSignal
}

interface BeforeToolCallResult {
  block?: boolean
  reason?: string
  args?: Record<string, unknown> // 改参后不重新 validate
}

interface AfterToolCallContext extends BeforeToolCallContext {
  result: AgentToolResult
  isError: boolean
}

interface AfterToolCallResult {
  details?: string
  isError?: boolean
  terminate?: boolean // 标记 batch 终止
}
```

- `beforeToolCall` 可以阻断（`block: true`），也可以改写 args（不重新走 schema validate）。
- `afterToolCall` 可以 patch `details`、覆盖 `isError`、设置 `terminate`。
- hook 抛异常时转成 error tool result，不 abort 整个 batch（Pi #3084 修复）。

#### Parallel vs Sequential

- tool 声明 `executionMode: "parallel" | "sequential"`；混合 batch 中只要有一个 sequential 就退化全部为串行。
- 首版 AI SDK loop 全部由 SDK 调度并行；自研 loop 后需自行实现此语义。

#### Tool Result Budget 与大输出处理

每个 tool 的 `execute` 返回值经过统一截断：

- 文本截断到 `AGENT_TOOL_OUTPUT_MAX_CHARS`（当前 12000）。
- 完整输出写入 temp artifact（event payload ref）。
- 截断时在 model 返回中标注 `[truncated, full output saved to ...]`。
- Pi 通过 `executeShellWithCapture` + `sanitizeBinaryOutput` 实现大输出落盘 + 二进制清理。

### `SessionTree`

Pi 的 session 是以 append-only 树结构持久化的核心数据模型。Etyon 当前用 `chat_messages`（UIMessage 快照）+ `agent_events`（旁路日志），后续目标对齐以下设计。

#### Entry 类型

```ts
type SessionTreeEntryType =
  | "message" // user / assistant / tool_result
  | "thinking_level_change"
  | "model_change"
  | "compaction" // summary + firstKeptEntryId
  | "branch_summary" // 分支切换时的上下文摘要
  | "custom" // 扩展 entry（不进 model context）
  | "custom_message" // 扩展 entry（进 model context）
  | "label" // 命名标签
  | "session_info" // session 名称等元数据
  | "leaf" // 当前分支指针
```

每个 entry 有 `id`（UUIDv7）、`parentId`（链到父节点）、`timestamp`。

#### 树操作

- `appendMessage(message)` → 追加到当前 leaf，更新 leaf。
- `moveTo(entryId | null, summary?)` → 移动 leaf（分支切换），可选附带 `branch_summary`。
- `buildContext()` → 从 leaf 沿 `parentId` 到 root 收集路径 entries，处理 compaction（跳过压缩区间以前的消息），处理 branch_summary。

#### 持久化

- JSONL v3 格式，每行一个 entry，首行为 session header。
- `InMemorySessionStorage` 用于测试和临时场景。
- `JsonlSessionRepo` 按 cwd 编码组织 session 文件目录。
- leaf 变更是持久化操作（append `leaf` entry），不是纯内存指针。

Etyon 首版可先不引入完整 Session 树，但 event store 的 `agent_events` 应支持从 event log 重建部分 model context（用于 replay 和 harness-operator 诊断）。P5 引入 branchable session log 时再完整迁移。

### `CompactionEngine`

Pi 的 compaction 是 harness 内建的上下文压缩引擎。Etyon 当前走 `chat-session-memory.ts` + `settings.chat.autoCompact`（chat 层），agent 层目标对齐以下设计。

#### Token 估算

- `calculateContextTokens(usage)` 从最后 assistant 的 provider usage 读总 token。
- `estimateContextTokens(messages)` 混合 usage + 启发式（text length / 4）。
- `shouldCompact(tokens, contextWindow, settings)` 判断是否超 `contextWindow - reserveTokens`。

#### 切分算法

- `findCutPoint(entries, keepRecentTokens)` 从后向前累计 token，找到 `keepRecentTokens` 对应的 turn 起点。
- 切分点必须落在 user message 的 turn 边界（`findTurnStartIndex`）。
- 被切走的消息进入 summary；切分点之后的消息保留。

#### Summary 生成

- `generateSummary(model, messages, previousSummary?, systemPrompt?, details?)` 调用 LLM 生成/增量更新摘要。
- reasoning model（thinking 开启时）通过 `reasoning` 参数传入。
- `maxTokens` 上限不超模型 output cap。

#### Split-Turn Compaction

当 compaction 的切分点落在一个 turn 中间（assistant 有多个 tool call，只保留最后几个）时，做两段并行 summary：history summary + turn-prefix summary。

#### Branch Summary

- 分支切换（`moveTo`）时 `collectEntriesForBranchSummary` 收集旧分支 entries。
- `generateBranchSummary` 生成摘要，append 为 `branch_summary` entry。
- `buildContext` 遇到 `branch_summary` 时把摘要注入 model context。

#### File Operations 追踪

- compaction utils 追踪 `readFiles` / `modifiedFiles`，附加到 summary 末尾作为 XML 标签。
- `serializeConversation` 将对话文本化（tool result 截断 2000 字符），用于 summary prompt。

Etyon 首版不在 agent 层实现 compaction；chat 层的 `autoCompact` 覆盖基本场景。P5 引入 agent-layer compaction 和 branch summary 时再完整实现。

### `ErrorHandling`

Pi 的错误处理分两层：底层 `Result<T, E>` 不抛异常；高层 `AgentHarnessError` typed throw。Etyon 目标复刻此分层。

#### 底层：Result 模式

`ExecutionEnv`、compaction helper、文件操作等底层模块返回 `Result<TValue, TError>`：

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

调用方必须显式检查 `result.ok`，不能忽略错误。适用于预期内失败（文件不存在、命令超时、权限不足等）。

#### 高层：Typed Error

`Session`、`AgentRuntime` 等编排层直接 throw typed error：

```ts
class AgentRuntimeError extends Error {
  code:
    | "busy"
    | "session"
    | "compaction"
    | "branch_summary"
    | "hook"
    | "provider"
    | "tool"
  cause?: Error
}
```

- `"busy"` → 并发结构操作。
- `"session"` → session 存储读写失败。
- `"hook"` → hook/listener 执行后 commit 状态已变更但 hook 本身失败。
- subsystem error 保留为 `cause`。

#### 错误传播规则

- `beforeToolCall` 抛错 → 转成 blocked tool result（`{ block: true, reason }`），不 abort 其他工具。
- `afterToolCall` 抛错 → 转成 error tool result，不 abort 其他工具（Pi #3084）。
- tool 执行失败 → `isError: true` 的 tool result，loop 继续下一 turn（模型可读错误并调整）。
- provider 请求失败 → `stopReason: "error"`，emit `agent_run_failed`，harness 可通过 retry phase 重试。
- listener 失败 → 不回滚已 commit 状态，public method reject。

### `StreamEngineering`

Pi 的 stream 层在 provider request 前后有完整 hook 链。Etyon 首版无此能力，目标对齐以下设计。

#### Stream Options 快照

每轮 turn 的 `createTurnState()` 浅拷贝当前 stream options（`headers`、`metadata` 等），provider 请求用快照而非 live config。Turn 进行中修改 stream options 不影响在途请求。

#### Provider Request Hook 链

```text
before_provider_request(options)
  → patch: { headers?, metadata?, transport?, timeoutMs?, maxRetries? }
  → merge into turn snapshot（可链式叠加多个 hook）
  → headers 支持 deletion（value = undefined 删除该 key）
  → metadata 同理

before_provider_payload(payload)
  → 检查 / 修改最终发给 provider 的 payload（messages, model, etc.）
  → 用于 tracing、cost annotation、model override

after_provider_response(response)
  → 记录 usage、cost、cache hit 等
```

#### 与 AI SDK 的集成

首版 Etyon 通过 `streamText` 的 `experimental_providerMetadata` 传递 headers；自研 loop 后通过 `streamFn` wrapper 注入完整 hook 链。

### `SkillAndPromptTemplate`

Pi 的 `packages/agent/src/harness/skills.ts` 和 `prompt-templates.ts` 提供了结构化的 skill / prompt 模板加载。Etyon 目标对齐以下设计。

#### Skill 加载

- 从 `SKILL.md` 文件加载，支持 frontmatter（name、description、visible 等）。
- 支持 symlink 目录。
- `loadSkills(dirs, env)` 遍历目录，每个子目录的 `SKILL.md` 解析为一个 `Skill`。
- `loadSourcedSkills(skillSources, env)` 支持 `source` 元数据（project / user / git 来源）。
- model-disabled skill 不进 system prompt 但仍可被引用。

#### Prompt Template 加载

- 从 `.md` 文件加载，支持 `$1`、`$2` 位置参数替换。
- `loadPromptTemplates(dirs, env)` 非递归遍历（只读根目录 `.md`）。
- `formatPromptTemplateInvocation(template, args)` 做参数替换和输出格式化。
- `parseCommandArgs(text)` 解析 shell 风格参数（支持引号）。

#### System Prompt 格式化

- `formatSkillsForSystemPrompt(skills)` 生成 XML 格式的 skill 列表，注入 system prompt。
- 字段需要 XML 转义。
- model-invisible skill 被跳过。

Etyon 当前 skill 作为 system prompt 文本注入（`context-builder` 步骤 5）。Pi 的结构化加载可在 P5 阶段引入。

### `ToolRegistry`

集中注册、过滤和格式化 tools：

- 内建 tools：`readFile`、`searchFiles`、`listProjectTree`、`gitDiff`、`rtkCommand`、`runCheck`、`applyPatch`。
- 子 agent tools：`agent_explore`、`agent_plan`、`agent_review` 等。
- 后续扩展 tools：project snapshot search、memory search、browser、MCP、workflow。

registry 负责：

- 生成 AI SDK `tools` object。
- 根据 profile 和权限规则过滤 active tools。
- 校验 tool name，避免 provider 不支持字符和命名冲突。
- 统一包一层 tracing、timeout、abort、output budget。

### `PermissionEngine`

所有会改变环境或暴露敏感信息的 tool 都必须先经过权限判断：

| 结果    | 行为                                      |
| ------- | ----------------------------------------- |
| `allow` | 自动执行                                  |
| `ask`   | 产生 approval request，等待 renderer 确认 |
| `deny`  | 直接返回可解释的 tool error               |

默认策略：

- `allow`：项目内只读文件、`rg` 搜索、目录树、`git diff`、短时间 `vp` / `rtk` check。
- `ask`：写文件 patch、安装依赖、网络请求、raw shell、长时间命令、跨 workspace 读取。
- `deny`：读取 secret 文件、系统目录写入、破坏性 `rm` / `git reset --hard` / `git checkout --`、未知二进制自执行。

deny 优先于 ask，ask 优先于 allow。

### `ExecutionEnv`

工具不要直接调用 `node:child_process` 和 `fs`。本地执行统一通过环境抽象。

Pi 将 `ExecutionEnv` 拆成 `FileSystem` + `Shell` 两个接口，所有文件操作返回 `Result<T, FileError>` 而非抛异常。Etyon 目标复刻此边界。

#### FileSystem 接口

```ts
interface FileSystem {
  cwd: string
  absolutePath(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<string, FileError>>
  readTextFile(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<string, FileError>>
  readTextLines(
    path: string,
    options?: { maxLines?: number; signal?: AbortSignal }
  ): Promise<Result<string[], FileError>>
  readBinaryFile(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<Uint8Array, FileError>>
  writeFile(
    path: string,
    content: string | Uint8Array,
    signal?: AbortSignal
  ): Promise<Result<void, FileError>>
  appendFile(
    path: string,
    content: string,
    signal?: AbortSignal
  ): Promise<Result<void, FileError>>
  fileInfo(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<FileInfo, FileError>>
  listDir(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<FileInfo[], FileError>>
  canonicalPath(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<string, FileError>>
  exists(
    path: string,
    signal?: AbortSignal
  ): Promise<Result<boolean, FileError>>
  createDir(
    path: string,
    options?: { recursive?: boolean; signal?: AbortSignal }
  ): Promise<Result<void, FileError>>
  remove(
    path: string,
    options?: { recursive?: boolean; force?: boolean; signal?: AbortSignal }
  ): Promise<Result<void, FileError>>
  createTempDir(
    prefix?: string,
    signal?: AbortSignal
  ): Promise<Result<string, FileError>>
  createTempFile(options?: {
    prefix?: string
    suffix?: string
    signal?: AbortSignal
  }): Promise<Result<string, FileError>>
  cleanup(): Promise<void>
}
```

#### Shell 接口

```ts
interface Shell {
  exec(
    command: string,
    options?: ShellExecOptions
  ): Promise<Result<ShellResult, ExecutionError>>
  cleanup(): Promise<void>
}

interface ShellExecOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
  abortSignal?: AbortSignal
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number
}
```

#### 错误类型

- `FileError`：`{ code: "not_found" | "permission" | "is_directory" | "aborted" | "unknown"; message: string }`
- `ExecutionError`：`{ code: "timeout" | "aborted" | "spawn" | "shell_unavailable" | "unknown"; message: string; exitCode?: number }`

#### 实现要点

- `NodeExecutionEnv` 基于 `node:fs/promises` + `child_process.spawn`（bash/sh）。
- pre-aborted 的 AbortSignal 会直接返回 `aborted` result，不启动实际操作。
- 大输出通过 `executeShellWithCapture` 落盘到 temp file，`sanitizeBinaryOutput` 清理非 UTF-8 字节。
- symlink 在 `fileInfo` 和 `listDir` 中不 follow，返回 `isSymlink: true`。
- `cleanup()` 最佳努力删除 temp 文件，不抛异常。

Etyon 首版 tool-registry 内联了 spawn 和 fs，P3 引入 `ExecutionEnv` 后将 tool 实现迁移到此接口。

### `AgentEventStore`

`chat_messages` 继续保存 UI 快照；agent 运行细节进入独立 append-only event store。

建议新增表：

```text
agent_runs
  id
  chat_session_id
  parent_run_id
  profile_id
  model_id
  status
  started_at
  finished_at
  error_message

agent_events
  id
  run_id
  sequence
  type
  payload_json
  created_at

agent_tool_calls
  id
  run_id
  parent_tool_call_id
  tool_name
  state
  input_json
  output_json
  error_message
  approval_state
  started_at
  finished_at
```

首版事件类型：

- `agent_run_started`
- `agent_step_started`
- `agent_step_finished`
- `tool_call_requested`
- `tool_call_approval_requested`
- `tool_call_approved`
- `tool_call_denied`
- `tool_call_started`
- `tool_call_delta`
- `tool_call_finished`
- `tool_call_failed`
- `subagent_started`
- `subagent_finished`
- `agent_run_finished`
- `agent_run_failed`

### `DelegationManager`

multi-agent 不直接让模型自由调用所有 profile。委派必须通过受控 tool：

```ts
agent_explore({
  task: string,
  contextPolicy: "none" | "summary" | "selected-files" | "recent-messages",
  maxSteps: number,
  activeTools: string[],
  returnFormat: "summary" | "findings" | "plan"
})
```

子 agent 输出：

```ts
{
  evidence: Array<{ path?: string; quote?: string; summary: string }>,
  filesRead: string[],
  subRunId: string,
  summary: string,
  toolResultsRef?: string
}
```

父模型默认只看到 `summary`、`evidence` 和 `filesRead`。完整 tool input / output 和 stream 进入 `agent_events`，由 UI 展示。

委派规则：

- 默认最大嵌套深度为 `1`。
- 默认最大并发子 agent 数为 `2`。
- 子 agent 不允许执行需要 `needsApproval` 的工具。
- 如果子 agent 需要高风险操作，必须返回 `needs_parent_approval`，由父 run 触发 approval。
- 子 agent 不共享父 agent 的完整消息历史，只接收必要任务说明、选中文件、摘要和预算。
- 子 agent run 可独立失败；失败应转成父 agent 可读的 tool error，不直接终止父 run，除非 profile 指定 `failFast`。

### `AgentUIAdapter`

Renderer 不应理解底层 harness event 的全部细节。建议加一个 UI adapter：

- AI SDK `UIMessage` 继续驱动 chat bubble。
- tool part 渲染由 `part.type === "tool-<toolName>"` 分发。
- approval part 展示确认 / 拒绝按钮，并调用 `addToolApprovalResponse()`。
- sub-agent trace 通过 `subRunId` 懒加载 `agent_events`，避免把完整 trace 塞进 assistant message。
- 大输出默认展示 preview，提供 “展开” 或 “查看完整输出”。

## Agent 预设

内建预设先满足常见本地开发任务。`general-purpose` 是默认 profile；其他 profile 可以通过 chat toolbar 或 `@` / `$` 后续入口选择。

| Profile            | 用途                | 默认工具                                                       | 委派 | 写入 | 审批策略                    |
| ------------------ | ------------------- | -------------------------------------------------------------- | ---- | ---- | --------------------------- |
| `general-purpose`  | 默认对话和轻量分析  | `searchFiles`、`readFile`、`gitDiff`                           | 否   | 否   | 只读自动执行                |
| `explore`          | 代码库探索和定位    | `listProjectTree`、`searchFiles`、`readFile`                   | 否   | 否   | 只读自动执行                |
| `plan`             | 方案设计和任务拆解  | `searchFiles`、`readFile`、`gitDiff`、`agent_explore`          | 是   | 否   | 子 agent 只读               |
| `coder`            | 小范围实现和修复    | `searchFiles`、`readFile`、`gitDiff`、`applyPatch`、`runCheck` | 是   | 是   | 写入 / 长命令需要审批       |
| `review`           | 代码审查和风险定位  | `gitDiff`、`searchFiles`、`readFile`、`runCheck`               | 可选 | 否   | read-only，check 可条件执行 |
| `harness-operator` | 调试 agent run 本身 | `agentEventsSearch`、`agentRunInspect`、`gitDiff`              | 否   | 否   | 只读自动执行                |

说明：

- `coder` 不应默认暴露 unrestricted bash；命令执行仍走 `rtkCommand` / `runCheck` 的 schema 和权限判断。
- `review` 默认不能 `applyPatch`，避免审查任务悄悄修改代码。
- `plan` 可以委派 `explore` 做独立检索，但最终计划由父 agent 归纳。
- `harness-operator` 是内部可观测性 profile，用于排查 tool loop、approval、sub-agent trace 和 event store。

## Context Builder

每次 run 的 system prompt 建议按稳定顺序组装：

1. 产品级基础规则。
2. 当前 `AgentProfile.instructions`。
3. session memory。
4. long-term memory。
5. selected skills。
6. `@` 文件 / 文件夹 project context。
7. active tools 与权限摘要。
8. 当前 run budget。

profile instruction 应在 memory 和 project context 之前，确保模型先知道自己扮演什么 agent，再消费上下文。

子 agent context 默认只包含：

- 委派任务。
- 父 agent 指定的 context summary。
- selected files 或 file snippets。
- 必要的 profile instruction。
- tool policy 和 budget。

不要默认传入父 agent 的完整 messages，否则子 agent 会继承过多噪声，也会放大隐私和 token 成本。

## Tool Result Budget

所有 tool output 都必须有预算：

- 文本输出只进入 model preview，不直接塞入完整 stdout / 文件内容。
- 完整输出写入 temp artifact 或 event payload ref。
- `readFile` 支持 line range 和最大字符数。
- `searchFiles` 默认限制 match 数、每条上下文行数和总字符数。
- `rtkCommand` / `runCheck` 分别截断 stdout、stderr，并记录完整输出引用。
- 对大型结果生成 deterministic summary；后续再引入模型 summary processor。

父 agent 看到的是 “足够继续推理的摘要”，UI 和 event store 保存 “足够审计的细节”。

## 设置结构预留

建议后续在 `packages/rpc/src/schemas/settings.ts` 增加：

```ts
const AgentSettingsSchema = z.object({
  allowSubagentDelegation: z.boolean().default(false),
  defaultProfileId: z.string().default("general-purpose"),
  enabled: z.boolean().default(false),
  maxConcurrentSubagents: z.number().int().min(1).max(4).default(2),
  maxSteps: z.number().int().min(1).max(20).default(8),
  profiles: z.array(AgentProfileSchema).default([]),
  requireApprovalForWrites: z.boolean().default(true),
  showToolTraces: z.boolean().default(true)
})
```

默认 `enabled = false`，保证现有 chat 行为不变。后续 UI 中可以先放在 Settings 的 `Chat` 或独立 `Agents` tab。

## 分阶段落地

### P0：文档与 schema 预留

- 新增本设计文档。
- 在 settings schema 中预留 `agents`。
- 定义内建 `AgentProfile` 常量和类型。
- 不改变默认 chat 行为。

### P1：单 agent tool loop

- 在 `/api/chat` 内引入 `tools` 和 `stopWhen: stepCountIs(8)`。
- 首批只启用只读 tools：`searchFiles`、`readFile`、`listProjectTree`、`gitDiff`。
- Renderer 渲染 tool parts。
- `chat_messages` 继续保存完整 UI snapshot。
- 加入最小 event callbacks，记录 tool call 和 tool result。

### P2：权限与写入工具

- 增加 `PermissionEngine`。
- 增加 `applyPatch`、`runCheck`、`rtkCommand`。
- Renderer 支持 approval UI 和 `addToolApprovalResponse()`。
- 高风险动作默认 `ask` 或 `deny`。
- 增加 focused tests：权限判断、tool registry、route tool call、renderer approval。

### P3：Harness Runtime

- 新增 `apps/desktop/src/main/agents/`。
- `/api/chat` 从直接调用 `streamText()` 改为调用 `AgentRuntime`。
- 新增 `agent_runs`、`agent_events`、`agent_tool_calls`。
- 引入 `ExecutionEnv`。
- UI 可查看当前 run 的 tool trace。

### P4：Multi-Agent

- 将子 agent 暴露为 `agent_<profileId>` tools。
- 子 agent 使用独立 run、独立 event trace、受限 context。
- 父 agent 只接收子 agent summary。
- 子 agent 内部禁用 approval tools；需要审批时向父 run 冒泡。
- 支持最多 `2` 个并发子 agent 和最大深度 `1`。

### P5：高级 Harness Engineering

- 评估把内部执行从 `streamText()` 升级到 `ToolLoopAgent` 或 `createAgentUIStreamResponse()`。
- 引入自研 `AgentLoop`（见架构分层 §AgentLoop）替换 SDK 内部 loop，获得 `beforeToolCall` 阻断、`afterToolCall` terminate、steering/follow-up、`prepareNextTurn` 等细粒度控制。
- 引入 append-only branchable session log（见 §SessionTree），而不是只依赖 `chat_messages` 快照。
- 引入 `AgentRuntime` Phase 状态机（见 §AgentRuntime.Phase）。
- 引入 `ErrorHandling` 分层（见 §ErrorHandling）：底层 `Result<T,E>`、高层 `AgentRuntimeError`。
- 增加 tool result summary cache。
- 增加 compaction summary、branch summary 和 run replay（见 §CompactionEngine）。
- 引入 stream hook 链（见 §StreamEngineering）。
- 引入 prompt template 加载和格式化（见 §SkillAndPromptTemplate）。
- 引入 plan/execute 工程（见 §Plan/Execute 工程详设）。
- 引入 durable approval 恢复流程（见 §Durable Execution）。
- 评估 `DirectChatTransport` 用于测试、CLI 或单进程场景，而不是替换默认 renderer transport。

## 非目标

首版明确不做：

- 不替换当前 Hono `/api/chat` transport。
- 不暴露 unrestricted bash。
- 不让 skills 自动变成可执行 tools；skills 仍先作为 instruction / context。
- 不默认启用 web / network tools。
- 不让子 agent 执行需要用户审批的工具。
- 不把 agent trace 全量塞进 assistant message。
- 不引入新的包管理器或绕过项目 `vp` / `rtk` 规则。

## 后续可能触达的文件

| 文件或目录                                             | 说明                                                     |
| ------------------------------------------------------ | -------------------------------------------------------- |
| `packages/rpc/src/schemas/settings.ts`                 | 增加 `settings.agents` schema                            |
| `apps/desktop/src/main/server/routes/chat.ts`          | 接入 tools / runtime                                     |
| `apps/desktop/src/main/agents/`                        | 新增 agent runtime、profiles、tools、permissions、events |
| `apps/desktop/src/main/db/schema.ts`                   | 新增 agent run / event / tool call 表                    |
| `apps/desktop/src/main/chat-messages.ts`               | 保持 UI snapshot，同时关联 latest agent run              |
| `apps/desktop/src/renderer/routes/chat.$sessionId.tsx` | 渲染 tool parts、approval、sub-agent trace               |
| `apps/desktop/src/renderer/components/chat/`           | 拆出 tool call、approval、trace UI 组件                  |
| `doc/code-agent-tools.md`                              | 和具体 tool surface 保持同步                             |

## 测试策略

Agents 能力的风险不在单个函数，而在 “模型流式输出 -> tool call -> 权限 / 审批 -> tool result -> 下一步模型输入 -> UI message / event store” 这条链路。因此测试要借鉴 Pi 和 Mastra 的覆盖方式，先做确定性 harness 测试，再补 UI 和集成测试。

### 可借鉴的测试形态

Pi 的测试用例值得借鉴这些方向：

- `agent-loop.test.ts`：用 mock assistant stream 驱动两轮模型响应，断言 tool 被执行、tool result 回到下一轮上下文、事件顺序正确。
- `agent-loop.test.ts`：覆盖 parallel tool call 的执行完成顺序与 tool result 回放顺序分离，避免并发工具导致上下文顺序漂移。
- `agent-loop.test.ts`：覆盖 queued steering message 必须等当前 assistant 的全部 tool calls 完成后再注入。
- `harness/agent-harness-stream.test.ts`：覆盖 provider request hook、stream options patch、headers / metadata 合并和删除语义。
- `harness/session.test.ts`：覆盖 append-only session、branch、leaf move、compaction summary 和自定义 message entry 的上下文重建。
- `harness/nodejs-env.test.ts`：覆盖 `ExecutionEnv` 的文件读写、symlink、abort、timeout、stdout / stderr streaming 与错误标准化。
- `coding-agent/test/agent-session-runtime-events.test.ts`：覆盖 session / runtime lifecycle event，确保切换、fork、shutdown、start 这些事件可取消、顺序稳定。

Mastra 的测试用例值得借鉴这些方向：

- `tool-call-step.test.ts`：覆盖 approval required 时先 enqueue approval、suspend，不执行工具；approve 后执行；deny 后返回明确 result。
- `tool-builder/builder.test.ts`：覆盖 `requireApproval` 为 boolean 和 function 两种形态，function 要被保留成 `needsApprovalFn`。
- `harness/subagent-tool.test.ts`：覆盖 sub-agent 不把内部 metadata 注入 model-facing content，metadata 只能走结构化 event / output。
- `harness/subagent-tool.test.ts`：覆盖 sub-agent request context 是父 context 的 copy，并清理父 thread / resource id。
- `agent/__tests__/supervisor-integration.test.ts`：覆盖父 agent tool call / tool result 不泄漏到子 agent 模型上下文。
- `client-sdks/react/.../toUIMessage.test.ts`：覆盖 sub-agent `childMessages`、`subAgentThreadId`、nested tool results 在 UI message 转换中不丢失。
- `server/handlers/responses.test.ts`：覆盖 streaming tool call delta、late canonical tool call、zero-argument tool call 和 tool result 对齐。
- `workspace/tools/__tests__/*`：覆盖 read / grep / list / write / execute-command 这类 workspace tools 的路径、权限和输出边界。

### Etyon 首批测试矩阵

「Pi 参考」列指向 [`pi/packages/agent/test/`](/Users/jiantianjianghui/gh_projects/pi/packages/agent/test/) 或 Mastra 文档中提到的同类用例。「状态」反映当前仓库是否已有对应测试文件并通过基本覆盖。

| 层级               | 目标                                                                                                                                        | 建议文件                                                                       | Pi 参考（形态）                                   | 状态                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------- |
| profile / settings | `settings.agents.enabled = false` 默认不改变 chat；profile id、工具策略、预算默认值稳定                                                     | `packages/rpc/src/schemas/settings.test.ts` 或现有 settings test               | —                                                 | 部分                         |
| tool registry      | profile 只暴露允许工具；tool name 标准化；重复名称报错；子 agent tools 只在 delegation 开启时出现                                           | `apps/desktop/test/main/agents/tool-registry.test.ts`                          | workspace tools 边界                              | **已落地**                   |
| permission engine  | `allow` / `ask` / `deny` 优先级；secret 文件、破坏性命令、跨 workspace 路径、网络命令判断                                                   | `apps/desktop/test/main/agents/permission-engine.test.ts`                      | —（Etyon 独有层）                                 | **已落地**                   |
| execution env      | workspace 路径规范化、symlink 处理、abort、timeout、stdout / stderr 截断、完整输出引用                                                      | `apps/desktop/test/main/agents/execution-env.test.ts`                          | `harness/nodejs-env.test.ts`                      | 未开始                       |
| tool execution     | `readFile` range、`searchFiles` 预算、`gitDiff` 路径过滤、`runCheck` 输出归一化、`applyPatch` 审批前不写入                                  | `apps/desktop/test/main/agents/tools/*.test.ts`                                | workspace tools                                   | 部分（合并在 tool-registry） |
| agent runtime      | mock model 第一次返回 tool call，第二次返回 final text；断言 tool result 进入下一步输入，事件顺序稳定                                       | `apps/desktop/test/main/agents/agent-runtime.test.ts`                          | `agent-loop.test.ts`                              | 部分                         |
| approval flow      | 需要审批时暂停，不执行工具；approve 后继续；deny 后给模型明确 tool error；approval state 可持久化                                           | `apps/desktop/test/main/agents/approval-flow.test.ts`                          | Mastra `tool-call-step`                           | 未开始                       |
| event store        | `agent_runs`、`agent_events`、`agent_tool_calls` 顺序号、parent run、tool call id、失败状态可重建                                           | `apps/desktop/test/main/agents/agent-event-store.test.ts`                      | `harness/session.test.ts`（持久化语义不同）       | **已落地**                   |
| chat route         | `/api/chat` 在 agents 关闭时走旧路径；开启时注入 tools / stopWhen；`UIMessage` 持久化包含 tool parts                                        | `apps/desktop/test/main/server/app.test.ts`（agents 相关用例）                 | —                                                 | 部分                         |
| renderer UI        | tool part 的 `input-streaming`、`approval-requested`、`output-available`、`output-error` 状态渲染；审批按钮调用 `addToolApprovalResponse()` | `apps/desktop/src/renderer/components/chat/*.test.tsx`                         | Mastra `toUIMessage`                              | 未开始                       |
| sub-agent          | 子 agent run 独立；父模型只看到 summary；完整 trace 存 event store；父 tool parts 不进入子 agent context                                    | `apps/desktop/test/main/agents/delegation-manager.test.ts` 或扩展 runtime test | Mastra `subagent-tool` / `supervisor-integration` | 部分                         |
| stream adapter     | sub-agent `subRunId`、child events、tool result summary 转成 UI 可消费结构，不污染 assistant text                                           | `apps/desktop/test/main/agents/agent-ui-adapter.test.ts`                       | —                                                 | 未开始                       |

### 测试夹具

实现时应优先创建本地 deterministic fixtures：

- `createMockLanguageModel()`：固定输出 text、tool call、tool call delta、tool error。
- `createAgentTestRuntime()`：注入 in-memory settings、in-memory event store、temp workspace、mock transport。
- `createTempWorkspace()`：生成文件、git diff、symlink、large output、secret-like 文件。
- `collectUiStream()`：消费 AI SDK UI stream，返回 message parts 和 agent events。
- `expectEventSequence()`：用事件 type 序列断言，不依赖不稳定 timestamp。

不要把首批测试建立在真实 provider 上。真实 provider 只适合少量 skip-by-default smoke / e2e，默认 `vp test run` 必须离线、可重复。

### 必须覆盖的回归点

- agents 关闭时，现有 chat 文本生成、memory 注入、`@` 文件上下文不变。
- tool call id 在 UI message、event store、tool result、approval response 之间一致。
- parallel tools 可以并发执行，但写回模型上下文的 tool result 顺序稳定。
- approval 函数抛错时默认进入 `ask`，不要误执行高风险工具。
- deny approval 后不能执行工具，且模型收到的是明确、可继续推理的 tool error。
- sub-agent 输出不能把内部 XML / metadata / trace 文本泄漏给父模型。
- 子 agent 不继承父 agent 的 thread id、resource id、approval tools 和完整 tool history。
- route 中的 abort signal 必须传到 model stream、tool execution 和子 agent。
- tool output 被截断时，UI 有 preview，event store 有完整输出引用。
- persistence 恢复后，approval pending / approved / denied 状态可以正确继续或显示。

## 验收标准

Agent 能力完成到可用阶段时，应满足：

- `settings.agents.enabled = false` 时，现有 chat 行为不变。
- `explore` profile 能自动调用只读工具，并把结果流式展示到 chat。
- `coder` profile 遇到写入或高风险命令时会暂停并请求用户审批。
- 拒绝审批后，模型能收到明确的 tool error 并继续给出替代方案。
- 子 agent run 在 UI 中可见，父 agent 只接收摘要。
- tool output 有稳定截断和完整输出引用，不会把上下文撑爆。
- agent run 可以从数据库事件中回放关键步骤。
- 权限、tool registry、chat route、renderer tool part、event store 都有针对性测试。
