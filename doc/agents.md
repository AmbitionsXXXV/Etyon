# Agents 能力设计

## 目标

在当前 Etyon 桌面端 chat 能力之上，设计一套可渐进落地的 Agents 架构。目标不是复刻外部 runtime，而是把可复用结构收敛成适合 Etyon 的本地能力：

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

## 落地状态 Checklist

### Chat / AI SDK 消息主线

- [x] `useChat<ChatUiMessage>()` + `DefaultChatTransport` + Hono `/api/chat` 仍是唯一 chat transport，Agents 关闭时继续走原有 `streamText` 路径。
- [x] Agents 开启时，主 run 走 Etyon self-managed loop；AI SDK 仍执行 provider streaming 与 tool schema 暴露，Etyon loop 通过单步 provider turn 接管 tool execute、approval suspend 与 event settlement。
- [x] 主 provider `fullStream` 会实时转成 AI SDK `UIMessageChunk`，覆盖 `text-*`、`reasoning-*`、`source-*`、`file`、`tool-input-*`、`tool-output-*`、`tool-approval-request`、`start-step` / `finish-step`。
- [x] Chat timeline 按 `UIMessage.parts` 渲染 provider 文本、reasoning、tool trace、source、document source 与 file part，不再只等最终 assistant 文本结果。
- [x] `agent_ui_stream_snapshot_created` 保存可恢复的可见 assistant parts；`start-step` / `finish-step` 保持为 live stream 边界，不写入 snapshot，避免恢复时出现空结构 part。
- [x] Approval resume 继续使用 AI SDK `originalMessages` / `start.messageId` continuation 语义，把 approve / deny 后的真实 tool result 接回原始 assistant tool-call。
- [ ] 子 agent / run graph node 的实时输出需要从“父 tool result 摘要 + child trace 懒加载”升级为 AI SDK preliminary tool output / nested `UIMessage` 投影，让父消息可直接显示完整 child progress，同时父模型仍只看到 summary。
- [ ] Provider source / file 的 UI 目前是紧凑基础展示；后续需要加入展开、复制、打开 artifact、引用跳转和 bounded preview。

### Agent 工作流与 Workbench

- [x] `agent_runs`、`agent_events`、`agent_tool_calls`、`agent_approvals`、`agent_artifacts` 已作为 run lifecycle、tool lifecycle、approval、artifact 的 append-only 事实来源。
- [x] Chat 内 Agent Workbench panel 与独立 `/agents/$sessionId` 页面已能查看 run graph、timeline、tool calls、artifacts、approval、diff 和 retry 状态。
- [x] Graph template、stage start、node execute、advance、retry、skip、until-idle 和 run graph approval continue-until-idle 已接入。
- [ ] Workbench 还需要产品化 node 输出的 inline streaming 展示，而不是主要依赖右侧 timeline / artifact 详情。

### Agent Mode / Composer

- [x] `/plan` 与 `Ctrl+Alt+P` 已能把当前请求临时切换为 read-only plan profile，并把 plan progress 写回 session events。
- [ ] Chat panel 需要新增 `Shift+Tab` 快捷键切换 agent mode；切换结果必须体现在 prompt input 最左侧的 mode indicator / segmented control，提交请求时写入 request body 或 session custom entry。
- [ ] Agent mode indicator 需要和 queued follow-up / steering 状态共存：请求中输入时显示本次消息将进入当前 active run，空闲时显示下一次 root run mode。

## P0–P5 状态快照

| Phase              | 状态   | 关键交付                                                                                                       |
| ------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| P0 文档与 schema   | 已落地 | `settings.agents` 默认关闭、profile 常量、基础 schema 预留                                                     |
| P1 单 agent loop   | 已落地 | `/api/chat` agent 开关、profile tools、tool step budget、provider stream 投影                                  |
| P2 权限与写入工具  | 已落地 | `permission-engine`、write / patch / shell approval、bounded `vp` check 与只读 Git inspection                  |
| P3 Harness Runtime | 已落地 | `agent-runtime`、`Agent` facade、`ExecutionEnv`、append-only event store、approval suspend / resume            |
| P4 Multi-Agent     | 已落地 | `agentExplore` / `agentPlan` / `agentReview` / `agentCoder`、run graph template、Workbench inspection          |
| P5 高级 Harness    | 部分   | AgentLoop outer、stream hooks、prompt templates、plan mode 已落地；compaction、branch summary、run replay 待补 |

## AI SDK Message 渲染架构

Etyon 的 agent 渲染边界以 AI SDK `UIMessage` 为准，而不是把 provider 输出先聚合成最终文本再二次投影。主路径分成三层：

```text
streamText().fullStream
  -> collectAiSdkStreamTurn()
  -> AI SDK UIMessageChunk live sink
  -> useChat<ChatUiMessage>() message.parts
```

`collectAiSdkStreamTurn()` 同时做两件事：

- 为 self-managed loop 收集 `content`、`toolCalls`、`toolResults`，保持 Etyon tool runtime / permission / approval / retry 的控制权。
- 把 provider stream part 同步转换成 AI SDK `UIMessageChunk`，直接写入 chat response stream，让 renderer 实时看到 provider 的每一个可渲染 part。

这条边界的约束：

- Provider-facing history 必须始终是合法 AI SDK `ModelMessage` 序列，尤其是 `assistant(tool-call) -> tool(tool-result)` adjacency；approval request / response 只作为 Etyon 内部元数据或 UI chunk，不直接污染 provider prompt。
- Renderer 只消费 `UIMessage.parts`；tool trace、reasoning、source、file、step boundary 都必须由 AI SDK chunk 进入同一条 assistant message。
- Event store 保存审计事实，`agent_ui_stream_snapshot_created` 只保存可恢复的可见 parts；最终 `chat_messages` 仍是 UI projection，不是 agent run 的事实来源。
- Subagent streaming 的后续目标是使用 AI SDK 文档推荐的 preliminary tool output / nested `UIMessage` 形态：用户看到完整 child progress，父模型通过 summary / `toModelOutput` 只看到受控输出。

## 当前实现注记

- Approval resume 的 projection 以最后一条 user message 作为合并边界；若恢复前已有 assistant tool-call 气泡，新的 event-derived assistant suffix 会带 `metadata.continuation = true`，renderer 在 timeline 顶部显示紧凑续接标记。
- `bash` / `rtkCommand` / `runCheck` 的命令记忆规则不是无限泛化：只在同一 workspace、同一 cwd、同一 tool 且双方都属于 bounded intent（只读 Git inspection 或 bounded `vp` check）时覆盖不同 argv；destructive / unsupported package manager / network / raw output / long-running / background / cwd 边界仍先于 allowlist 生效。
- `agent_events.payload` 当前是软 schema：reader 必须容忍旧行缺字段，新增 event 类型优先使用 union 类型与可选字段；需要强校验的读取边界使用 `assertAgentEventShape()`，暂未引入 `event_version` 列。
- `chat_messages` 是 `agent_events` 的 UI projection。当前 repair 路径可从最新 active / completed root run 重建 assistant suffix；assistant projection 会同时写入 `metadata.agentProjection` 和 `chat_messages.agent_projection_run_id`，后者用于 metadata 损坏或缺失时继续识别 projection run；跨设备只同步 `chat_messages` 而不带 `agent_events` 的场景仍不是首版保证。
- `suspended` approval run 会在 app 重启后保留未超期的 pending 状态；`settings.agents.approvals.approvalTtlMs` 超期后会在 startup recovery 标记为 `failed(reason="approval_timeout")`，并通过 recoverable runs 暴露。
- Run graph 自动 retry 只覆盖 read-only 且 active tools 均为 safe / idempotent 的 provider / timeout 这类 transient 失败；写入类工具、网络工具和泛用 shell 不会自动 retry，只能由用户手动 retry。
- Breaking contract：active run 的 chat projection 读取时总是从 `agent_events` / 最新 stream snapshot 重建，`chat_messages` 只作为 completed projection cache；即使缓存里已有非空 assistant projection，也不能覆盖当前 active response。
- `chat-branch` custom entry 的不变量：fork / regenerate 只改变 projection leaf 与 retained message ids，不继承未完成 tool call row；pending approval 仍归属原 run，但当前可操作 approval 只来自该 session 最新顶层 active root run，旧 suspended branch 的 approval 会留在审计历史中，不再出现在 Workbench / approval inbox，也不能通过 `pendingApprovalOnly` resume。
- Tool output summary cache 只缓存同一 root run 内的 dependency summary；缓存命中不能替代后续显式 `read` / `grep` 对最新文件状态的刷新。

## 已落地实现明细

截至当前实现，Etyon 已经完成首版 chat 内 agent runtime 接入：

- `packages/rpc/src/schemas/settings.ts` 已新增 `settings.agents`，默认 `enabled=false`，旧 settings 会自动补齐 disabled 默认值；`settings.agents.approvals.approvalTtlMs` 默认 7 天；`settings.agents.retry` 默认 `maxAutomaticRetries=1` / `retryTransientFailures=true`；`settings.agents.sandbox` 默认 `enabled=false` / `failIfUnavailable=true` / `allowNetwork=false` / `autoAllowSandboxedShell=false`，`settings.agents.lsp` 默认 `enabled=false` / `requireSandbox=true` / `initTimeoutMs=15000` / `diagnosticTimeoutMs=5000`。
- `/api/chat` 在 agents 关闭时继续走原有 `streamText` 路径；开启后通过 `apps/desktop/src/main/agents/agent-runtime.ts` 注入 profile instructions、tools 与 `stopWhen` 预算。
- `apps/desktop/src/main/agents/` 已包含 built-in profiles、tool registry、permission engine、event store 与 runtime facade。
- 数据库已新增 `agent_runs`、`agent_events`、`agent_tool_calls`、`agent_approvals`、`agent_artifacts`，用于记录 run lifecycle、tool call lifecycle、durable approval projection、tool output artifact catalog 和 harness inspection；`chat_messages.agent_projection_run_id` 用于把 UI projection 与源 `agent_run` 做结构化绑定，避免仅依赖 `metadata_json`；`agent_tool_calls` 对内按 run scope 存储 provider tool call id，对外仍保持 UI / approval 使用的 tool call id；`agent_approvals` 按 approval id 持久化 request / response 状态，并用 `tool_call_row_id` 绑定 run-scoped tool call row；`agents.listRuns` RPC 已能按 session 返回 root / child run 列表，`agents.inspectRun` RPC 已能按 `runId + sessionId` 返回 run / events / toolCalls / artifacts 只读 trace，`agents.readArtifact` 已能按 artifact id + session 边界返回 bounded artifact content preview；runtime harness 已覆盖带 `outputRef` 的 tool output 会同时产生 UI preview、`agent_artifacts` catalog 与 `tool_call_finished.artifactIds`；renderer tool trace 会从 delegation tool output 的 `subRunId` 懒加载 child run trace，`agent-run-trace.ts` 已能把 inspected traces 投影成稳定 run graph preview nodes / edges、artifact / event / tool 紧凑 display rows，并可从 root run events 提取最新 run graph execution plan；approval suspend / resume 场景下，chat projection 会把恢复后的 assistant continuation 和 approval-only assistant resume entry 合并回原始 assistant 气泡，而不是拆成第二条 assistant message；child trace 面板在有 `parentRunId` 时会加载父 trace 并展示父子 run graph preview 与 artifact 列表；chat 页面已接入基础 Agent Workbench panel，独立 `/agents/$sessionId` workbench 页面也已复用同一 surface，可按 session 列出 run graph、选择 run、查看 timeline / artifacts / tool calls，选择 artifact 时读取 bounded content preview，并通过已有 RPC 创建 template graph、启动下一 stage、推进 graph、重试 failed node；Workbench 也会过滤当前 graph 的 pending approvals，并通过 `agents.respondToRunGraphApproval` 做 approve / deny 后恢复挂起节点；Workbench 已接入当前 workspace diff preview，展示变更文件、增删统计与截断提示；Workbench 的 run 选择、root trace、graph plan、approval 过滤、diff preview 与操作按钮状态已抽到 `agent-workbench.ts` 并补纯逻辑回归；`AgentWorkbenchPanel` 已有 SSR 级 React render 回归，覆盖 query data、i18n、run list 与 diff preview。
- 默认 code agent tool surface 已按 `doc/code-agent-tools.md` 重新定义为 Etyon workspace 分层 + Etyon 短别名：模型当前默认看到 `read`、`grep`、`find`、`ls`、`stat`、`bash`、`processOutput`、`stopProcess`、`mkdir`、`delete`、`edit`、`smartEdit`、`write`，但它们只是 Etyon workspace tool 的 model-facing alias，不是完整复刻外部项目。Etyon workspace 暴露 `view`、`search_content`、`find_files`、`file_stat`、`execute_command`、`process_output`、`stop_process`、`mkdir`、`delete_file`、`string_replace_lsp`、`ast_smart_edit`、`write_file`、`lsp_inspect`、`lsp_workspace_symbols`、`lsp_symbols`、`web_search`、`web_extract` 等内部操作，tool registry 暴露 `request_access` 作为无副作用授权 checkpoint；Etyon 当前 alias 映射为 `read -> view`、`grep -> search_content`、`find/ls -> find_files`、`stat -> file_stat`、`bash -> execute_command`、`processOutput -> process_output`、`stopProcess -> stop_process`、`mkdir -> mkdir`、`delete -> delete_file`、`edit -> string_replace_lsp`、`smartEdit -> ast_smart_edit`、`write -> write_file`、`inspect -> lsp_inspect`、`symbolSearch -> lsp_workspace_symbols`、`symbols -> lsp_symbols`、`requestAccess -> request_access`、`webSearch -> web_search`、`webExtract -> web_extract`。其中 `stat` 是只读 metadata alias；`mkdir` / `delete` / `edit` / `smartEdit` / `write` 是写入类 filesystem alias，永远需要 approval；`smartEdit` 对 TS/JS 文件中唯一命名声明做 AST 边界替换，并在写入后追加 LSP diagnostics；`inspect` 会从 sandboxed TS/JS LSP 聚合 hover、definition、implementation、references、incoming / outgoing calls 和当前行 diagnostics，且路径越界或读取失败时 fail closed 为结构化 `failed` result，不启动 server；`inspect` / `symbolSearch` / `symbols` 只在 `settings.agents.lsp.enabled && settings.agents.sandbox.enabled` 时进入 `coder` / `explore` / `review` 的可见工具集合；`requestAccess` 只在 `plan` / `coder` 暴露，永远需要 approval，且只确认用户批准的窄 scope，不直接放宽后续 filesystem / shell / network 工具权限；`webSearch` / `webExtract` 只在 selected skill 声明 `network` capability 且本次 request 允许 approval-gated tools 时暴露，并永远需要 approval，其中 `webExtract` 还会在 workspace 层拒绝输入 URL、每个 redirect `Location` 或最终响应 URL 指向 localhost、回环地址、私网地址、链路本地地址和本地域名，approval 不能绕过网络隔离边界；`bash background=true` 会启动 Etyon-managed background process 并返回 `processId`，`processOutput` / `stopProcess` 只访问当前 workspace 已登记的 processId；`grep` 底层走 BurntSushi `ripgrep` (`rg --json`)，`find` 底层走 `fd --glob --hidden --no-require-git --max-results`，且 `grep` / `find` / 兼容 `searchFiles` 已复用当前 `AgentWorkspace.operations`，开启 sandbox 时通过同一个 `WorkspaceSandbox` 准备 `rg` / `fd` 进程。旧 Etyon 形态的 `searchFiles`、`findFiles`、`fileInfo`、`listDirectory`、`readFile`、`listProjectTree`、`gitDiff`、`memorySearch`、`applyPatch`、`editFile`、`writeFile`、`runCheck`、`rtkCommand` 保留为内部兼容 / harness 工具，不再作为内建 code-agent profile 默认可见 surface；file-like tools 已补 secret-like path 与 symlink 边界保护，`fileInfo` / `listDirectory` / `readFile` / `editFile` / `writeFile` / `stat` / `mkdir` / `delete` / `smartEdit` 已消费 `AgentWorkspace.operations` Result 边界，其中 metadata / read 类不跟随目标 symlink，写入类会在 permission engine 里先拦截 secret-like / workspace 越界路径再进入 approval；`gitDiff` 已消费 workspace git context，`searchFiles` / `applyPatch` / `runCheck` / `rtkCommand` 已消费 workspace command Result，`webSearch` / `webExtract` 已消费 workspace network Result，`requestAccess` 已走 `ui` capability 并在执行前强制 approval，`applyPatch` 会在执行前解析 patch header 并拒绝 secret-like target path；`harness-operator` 可用 `agentEventsSearch` 与 `agentRunInspect` 做只读诊断，且 inspect 前会校验 run 仍属于当前 chat session / project。内建工具已补 capability manifest（`read-fs` / `write-fs` / `shell` / `network` / `git` / `memory` / `agent-run` / `sandbox` / `lsp` / `ui`），`tool-policy.ts` 已提供最小 policy compiler，用 manifest risk 和显式 skill capability 编译可见工具集合；permission engine 已用 manifest capability 做第一层读 / 写 / network / shell / sandbox / LSP / UI 分流，`runCheck` 会自动允许 `vp check` / `vp test run` / package-level `vp run ...` 这类 bounded verification command，为后续 MCP / skill extension policy compiler 铺底。
- `AgentWorkspace.operations.writeFile` 已支持 path 级写锁、读快照追踪和 `expectedMtimeMs` 写入快照校验；`edit` / `editFile` / `smartEdit` 在读到文件内容后写回时会校验读取时的 mtime，若文件已被外部修改则返回 `stale-write` 并要求重新读取；model-facing `write` 创建新文件时可直接写入，覆盖已有文件前必须先通过同一 workspace `read` 当前快照；同一文件的并发写入会串行执行，避免多个 stale snapshot 同时通过校验后 last-write-wins 覆盖用户或其他进程的更新。
- `coder` / `plan` profiles 会暴露 approval-gated `requestAccess`，用于让模型先请求用户确认一个窄 scope 再继续；在开启 `allowSubagentDelegation` 后会暴露受控 delegation tools，例如 `agentExplore` 和 `agentReview`；`coder` 额外暴露 `agentPlan`，用于把计划生成委派给 read-only plan child；`plan` 额外暴露 approval-gated `agentCoder`，用于在用户确认后创建 execute child run 并恢复 coder 工具集合。profile override 若切到 readonly，会保留该 profile 原本的 `safe` risk 工具并移除写入、shell、delegation 等非 safe 工具，不再把 operator / explore 等 profile 强行替换成通用只读工具集；普通子 agent 使用独立 child run、独立 tool trace、受限 context，并且 child tool scope 已按 tool manifest risk 只暴露 safe 工具，不会拿到需要 approval 或 delegation 的工具。
- 子 agent 的模型输入只包含 delegation task / context / expected output，不直接继承父消息历史；返回给父模型的 tool result 带 `subRunId` / `profileId` / `status` / `summary` / `truncated` 等结构化字段，summary 会清理 `<antThinking>`、`<function_calls>` 和命令 transcript 块；当 child 明确以 `needs_parent_approval` 开头返回时，runtime 会把 delegation output、`subagent_finished` event 和 extension `delegation_finished` lifecycle event 标记为 `status: "needs_parent_approval"` 并剥离 marker，避免把高风险需求混成普通 succeeded summary；当 delegation output 为 `status: "failed"` 或 `status: "rejected"` 时，父级 tool call 会记录为 model-visible tool error，同时保留原始结构化 output，父 run 可以继续处理；完整 trace 仍留在 child run event store。
- Chat viewport 会渲染 tool trace；当 AI SDK tool part 进入 `approval-requested` 状态时，可直接在 trace 行内批准或拒绝，并通过 AI SDK `originalMessages` / `start.messageId` continuation 机制继续同一条 assistant message，不在 approve 后新建 tool message、空 message 或文本 message；`git diff` / `git status` / `git log` / `git show` 这类安全只读 Git inspection 命令会直接通过 permission engine，且 `rtk git ...` 与 `runCheck` 路径也走同一只读 Git 判断。对 `bash` / `rtkCommand` / `runCheck` 这类仍需 approval 的命令，用户也可以选择批准并记住；runtime 会把 `projectPath + toolName + command + cwd` 写入 `settings.agents.approvals.commandAllowlist`，后续仅在同一 workspace、cwd、tool 且同属 bounded intent 时覆盖不同 argv，deny / risky 边界仍先执行。关闭普通 tool trace 时仍保留 approval 卡片，避免暂停 run 失去继续入口；相邻重复的终态 structured tool part 会折叠为单张 trace 卡并显示重复次数。同时会把文本流里的 `<antThinking>`、`Executed in ...` 和 `<function_calls><invoke ...>` transcript 解析成紧凑 trace，避免原始工具标签直接漏进正文。Assistant 输出不使用整块 bubble 包裹，而是以无背景的连续流式内容和 trace 卡片向下展开；请求提交后如果还没有第一段 assistant part，会先显示轻量 live 状态行，并能通过 `chat-request-phase` 展示 memory loading、model start 与 agent turn 状态。
- Settings 新增 `Agents` tab，用于控制 global enable、default profile、tool step budget、delegation 开关、trace visibility 与 profile override 编辑，并提供只读 approval inbox 查看当前 pending tool approvals；写入、网络与泛用本地命令审批由 permission engine 和 AI SDK approval message 强制执行，不再提供可关闭的 write approval 开关；命令 allowlist 是显式用户选择后的精确记忆规则，不会覆盖 deny 类边界或高风险命令检查；普通 chat stream 的直接 approve / deny / approve-and-remember 保留在 chat tool trace，run graph approval 的 approve / deny 已进入 chat Workbench，基础 run graph create / start / execute / run-until-idle / advance / retry 也已进入 chat Workbench，并已提供独立 `/agents/$sessionId` Workbench 页面用于离开 chat transcript 后继续查看 run graph / timeline / artifacts / approvals / diff。
- 与本地参考仓库的模块、数据流与测试覆盖对照见下文「Etyon 与参考 Harness 对照」；approval resume 已补充真实本地工具执行闭环测试，并过滤未匹配当前 run 的旧 approval response，避免重复执行旧工具。恢复 provider 请求时会从 session entry event 重建已持久化 model context，再合并当前 approval response；进入 AI SDK 前会把内部 approval request / response 元数据剥离，并把 approve / deny 后的真实 tool result 放回原始 assistant tool-call 后方，保证 provider 只看到连续的 `assistant(tool-call) -> tool(tool-result)` 历史，不会把 approval resume 结果追加成孤立 tool message；该路径已用 runtime harness 覆盖真实 session entry event 重建、pending queued steering replay、missing-only append 和 approved result provider adjacency。包含多个 pending approval 的 assistant step 会等所有 approval 都响应后再继续；如果恢复流结束时同一 run 仍有 pending approval，runtime 会保持 suspended，pending 查询与 resume 查询都能覆盖短暂 running 状态；approvalId 查询也按 run scope 匹配，避免复用 provider tool call id 时错配。app startup 会把重启前遗留的 `running` run 标记为 failed，保留未超期的 `suspended` approval run，并把超出 `approvalTtlMs` 的 suspended approval run 标记为 `failed(reason="approval_timeout")`；只有每个 session 最新的失败顶层 run 会通过 `agents.listRecoverableRuns` 查询，chat route 会显示基于 `regenerate()` 的手动重试入口，避免正常后续 run 之后继续展示旧的 `Agent run was stopped.`。
- `ExecutionEnv` 已支持统一 cwd 约束、abort / timeout、截断预览、完整输出 artifact（内含 stdout / stderr deterministic summary）、binary output 清理，并使用 stream decoder 保留跨 stdout / stderr chunk 的 UTF-8 字符；Etyon `fileSystem` Result API 已覆盖路径解析、存在性、文本/二进制读取、分行读取、文件写入/追加、目录创建、删除、临时文件/目录、cleanup、metadata 和目录列举，把 abort、越界、缺失、类型不匹配等文件错误标准化为 `{ ok: false, error }`；`AgentWorkspace.operations` 已把 `canonicalPath`、`absolutePath`、`fileStat`、`listDir`、`listProjectSnapshotFiles`、`memorySearch`、`readTextFile`、`view`、`mkdir`、`deleteFile`、`writeFile`、`executeCommand`、`searchContent`、`findFiles`、`gitDiff`、`lspInspect`、`lspDocumentSymbols`、`lspWorkspaceSymbols`、`lspTouchFile`、`webSearch`、`webExtract`、`startProcess`、`getProcess`、`recoverProcess`、`stopProcess` 暴露为首批 workspace substrate 操作，`read` / `grep` / `find` / `ls` / `stat` / `mkdir` / `delete` / `edit` / `smartEdit` / `write` / `inspect` / `symbolSearch` / `symbols` / `bash` / `memorySearch` / `processOutput` / `stopProcess` / `webSearch` / `webExtract` 等 model-facing alias 通过这层执行底层 filesystem / search / network / command / git / process / memory / LSP 动作；`shell.exec()` 已提供 `Result<ShellResult, ExecutionError>` 边界和结构化 `onOutput({ channel, chunk, sequence })` streaming 事件，区分 pre-aborted、timeout 与 spawn error，且 timeout / abort / spawn error 会把已捕获的 stdout / stderr 继续透传给 tool preview / artifact；background process 启动同样复用 `WorkspaceSandbox`，保留 bounded stdout / stderr preview，并把 `background_process_started` / `background_process_output` / `background_process_finished` 写入 workspace event sink；Agent Workbench 已能把 `sandbox_command_output` / `background_process_output` 聚合成按 command / process / channel 分组的 shell output live tail；`AgentWorkspace` 会按 `projectPath + chatSessionId` 复用 process registry，支持同一 chat 的后续 turn 继续读取 / 停止进程；`AgentWorkspace` 也会按 `projectPath + chatSessionId + sandbox/LSP settings` 复用 LSP manager，避免每次 toolset 构建都新建 language server lifecycle；当 `settings.agents.lsp.requireSandbox=true` 但 sandbox 关闭时，workspace 直接不创建 LSP manager，LSP operations fail closed 为 unavailable；`cleanupAgentWorkspaceResources()` 已接入 app `before-quit`，统一停止 cached background processes、关闭 cached LSP managers 并清空 workspace caches；如果 app restart 后 registry 为空，`processOutput` / `stopProcess` 会按当前 chat session 的 `agent_events` 恢复 process metadata / bounded output，并在 pid 仍存活时继续按进程组停止。
- `apps/desktop/src/main/agents/agent-loop.ts` 已新增独立 self-managed loop 内核，覆盖两轮 mock model、tool result 写回下一轮、parallel 完成顺序与 source-order 写回顺序分离、mixed sequential batch、通用 active tool allowlist、`beforeToolCall` 改参 / 阻断、`afterToolCall` patch / terminate、hook 错误 settlement、tool execution failure 转 model-visible tool result、sequential batch 中途 abort settlement、in-flight parallel tool abort settlement、model / tool abort signal 传递、messages / resources / injected user messages / tool-call boundary / event payload 结构化 deep clone 隔离、steering message 在 tool batch 后注入、final turn follow-up、`prepareNextTurn` 替换 messages / model / resources / thinking level / active tools / tools，以及可把 async iterable / `ReadableStream` provider parts 汇总成 model turn 的 `createAgentLoopStreamModel()` adapter（含 abort cancellation）。主 `streamAgentChat()` 在 Agents 开启时已改为走同一 Etyon loop：AI SDK 仍执行 provider streaming 与 tool schema 暴露；Etyon loop 通过单步 provider turn 接管 tool execute、approval suspend 与 event settlement；adapter 已能把 provider `tool-input-start` / `tool-input-delta` / `tool-input-end` 聚合成 Etyon tool call，也会接收 AI SDK fullStream 的 `tool-result` / `tool-error` / `tool-output-denied`，把 provider-completed tool result 写入 Etyon model context / UI stream / tool lifecycle trace，把 provider tool error / invalid tool call / denied output 转成 model-visible error result，并按 `toolCallId` 跳过本地重复执行；tool 执行、审批暂停 / 恢复、`agent_loop_event`、session message append 和 UI stream 投影由 Etyon runtime 负责。
- `apps/desktop/src/main/agents/truncate.ts` 已提供统一 `truncateHead` / `truncateTail` / `truncateLine` / `formatSize` / `summarizeToolResult` / `summarizeToolResultWithProcessor` / `formatToolResultSummaryAnnotation` / `appendToolResultSummaryAnnotation` / `createToolResultSummaryCache` helper，避免 tool output 截断、模型可见截断标注与 deterministic summary cache 继续散落在各工具中；run graph dependency prompt 已复用同一个 tool result summary cache，同一 root run 内 sibling 节点引用同一大型依赖输出时只触发一次 model summary，并写入 `agent_tool_result_summary_cached` 事件；`ExecutionEnv` 继续 re-export `AGENT_TOOL_OUTPUT_MAX_CHARS` 与 `clampToolOutput`，现有调用方无需大面积迁移。
- `apps/desktop/src/main/agents/prompt-templates.ts` 已提供 prompt template 基础能力：非递归加载 `.md`、可选 frontmatter 元数据、`$1` / `$2` 参数替换、`$ARGUMENTS` 全量参数替换、`$$` 转义、shell 风格 args 解析和 XML 格式化输出；`agent.ts` 已通过 `promptFromTemplate()` 接入 runtime invocation，`skills.ts` 已通过 `listSkillPromptTemplates()` 加载可见 skill 目录下的 `prompts/*.md`，并提供 `formatSkillInvocation()` 作为 direct skill invocation 的模型可见 XML；`skills.listPromptTemplates` RPC 与 chat composer `/prompt` suggestion 已接入 UI，server 会在发给模型前把 `/prompt <template> ...` 展开为 prompt template XML。
- `apps/desktop/src/main/skills.ts` 的 skill 加载已补 `visible` / `model-visible` / `model-disabled` / `capabilities` / `commands` frontmatter 和 source 元数据，system prompt 输出改为 XML，并会跳过 model-invisible skill body；`model-disabled` skill 会以 `<skill_references>` 暴露引用元数据，避免隐藏正文进入模型上下文；显式选中的 skill capabilities 会从 chat route 传入 `streamAgentChat()` / `buildAgentTools()`，profile 默认工具保持由 profile policy 决定，skill capability 只补充匹配 manifest capability 的内建 supplemental 工具（当前为 `network` -> `webSearch` / `webExtract`）并过滤 extension tools，未知 capability 不会自动放大权限；composer `/skill <skill> <command> [flags] ...` 会校验 skill / command / declared flags，并在 provider 前展开为 `<skill_command_invocation>`。
- `apps/desktop/src/main/agents/agent-extensions.ts` 已提供 Etyon extension runner：支持 module export loading、`registerTool()`、`registerToolHooks()`、`registerStreamHooks()`、`on(event)` lifecycle handler、按 profile 与 selected skill capability 暴露 extension tool / tool hooks / stream hooks，并由 `buildAgentTools()` 包装成 AI SDK tool 接入主 `streamAgentChat()` loop；extension tool 已带 `owner` / `capabilities` / `riskLevel` metadata，默认 owner 为 `skill`、默认 risk 为 `medium`，非 `safe` 或显式 `requiresApproval` 的 extension tool 会自动进入 approval-gated 范围，且 `includeApprovalTools=false` 的 child scope 会过滤这些工具；runner 也已接受结构化 `AgentToolPackage` 输入，允许 `skill` / `project` / `provider` / `mcp` source 以统一 metadata 注册 tools / tool hooks / stream hooks，`streamAgentChat()` 已可接收 request-level `toolPackages` 并与 selected skill extension runner 合并后进入主 run 与 child run，为后续真实 MCP client 和 provider-defined tool packages 接入同一 policy 边界铺底；selected skill 可在 `SKILL.md` frontmatter 里用 `extensions` 声明相对 module 路径，chat route 会在 Agents 启用时加载这些 module 并把 runner 传入 runtime；extension tool 执行会发出 `tool_registered` / `tool_call_started` / `tool_call_finished` / `tool_call_failed` 事件，delegation 会发出 `delegation_started` / `delegation_finished` / `delegation_rejected` 事件，且都会进入既有 lifecycle 分发；extension tool hooks 可在主 chat run 和 delegated child run 的 self-managed loop 里执行 `beforeToolCall` / `afterToolCall`，用于阻断、改参、patch output 或 terminate，也可通过拦截 `agentExplore` / `agentReview` / `agentPlan` / `agentCoder` 这类 delegation tool 来调整或拒绝委派。
- `apps/desktop/src/main/agents/agent-messages.ts` 已提供基础 `AgentMessage` 扩展、`CustomAgentMessages` declaration merge 扩展点与 `convertAgentMessagesToLlm()`，可把内部 run / tool / branch / compaction 这类 custom message 排除在 LLM 输入之外；`prepareAgentChatContext()` 会在 `convertToModelMessages()` 后补齐未完成 assistant tool call 的 synthetic `tool-result`，确保 Agents enabled / disabled 路径都满足 AI SDK tool-call continuity；`buildProviderReadyModelMessages()` 会在 agent runtime 调用 provider 前剥离 `tool-approval-request` / `tool-approval-response` 内部元数据、丢弃重复 stale tool call，并把 approval 执行产出的 tool result 注入到匹配的原始 tool-call 后方，避免 OpenAI-compatible provider 收到 `tool_call_id is not found` 这类不连续历史；当前已用于从 session event log 重建 resume model context，并通过 `agent-chat-projection.ts` 把 event-derived model context 投影回 `chat_messages` 的 assistant suffix。`agent-chat-projection.ts` 会在 replay 时维护 `approvalId -> toolCallId` 映射，因此 split approval request 与不带 `toolCallId` 的 approved / denied response 也能恢复到同一个 tool part，并显示 `approval-requested` / `approval-responded` 状态；approve 后追加的 approval-only assistant resume entry 不会创建空 assistant message，而是只更新已有 tool part。`mergeAgentEventProjectionIntoChatMessages()` 在合并投影后缀前会用 `trimTrailingAssistantMessages()` 剥离 prefix 末尾的旧 assistant 消息，避免 approval resume 二次请求时 prefix 包含第一次 stream 的 assistant 消息与投影合并后的 assistant 消息同时出现、导致 UI 展示两条 message 的问题；`chatSessions.listMessages` 也会修复旧版本留下的空 projection assistant message。
- `buildChatStreamResponse()` 完成持久化时会用最新 user message 作为 projection 边界，而不是把完整 onFinish message list 当作原始 prefix；approval resume 场景下若请求前已有 assistant tool-call 气泡，投影后的 assistant suffix 会继承最新 stream metadata 并带 `metadata.continuation = true`，renderer timeline 会显示「续接上一条」标记。
- `apps/desktop/src/main/agents/agent-session-tree.ts` 已提供 in-memory append-only session tree：message / leaf / branch summary / compaction summary / custom message entry、leaf move、branch summary 注入、compaction context reset、自定义消息排除出 model context，并会拒绝移动到未知 entry；`agent-session-events.ts` 已把 prepared model messages、branch move、compaction summary、custom message、queued steering / follow-up / next-turn custom entry 和 provider finish 后的 assistant / tool response messages 都以 `agent_session_entry_appended` 持久化到 event store，支持从 event log 重建一轮完整 model context，并能列出尚未 replay 到 user model message 的 pending queue；`agent_session_save_point_created` 已持久化 provider request prepared / provider response committed 的 model context 快照，恢复路径会优先读取最后一个 save-point，没有 save-point 时回退到 session entry replay；`agent-session-binding.ts` 已提供 shared model context builder、missing-only committer、queued message drainer 和 `createAgentSessionQueuedMessageWriter()` 适配层，`streamAgentChat()` 的 approval resume、下一次请求 queue drain、active run queue drain 与 provider request / response session entry append 已复用这些 binding helper；同一 active run 内新排入的 queued follow-up / steering 也已由 self-managed loop drain，分别触发 final turn follow-up 或 tool batch 后 steering 注入，避免 UI 在运行中排入的消息停留在 event log；这些行为已从旧 `streamText` mock 迁到真实 runtime harness 覆盖。当前 chat route 已在 Agents 开启且请求进行中时通过 composer 调用 `agents.queueMessage` 写入 queued steering / follow-up；fork / regenerate 请求已写入 `chat-branch` custom entry，且 assistant submit trigger 不会被误判成分支；`agents.inspectSession` / `agents.moveSessionLeaf` / `agents.appendSessionCompactionSummary` 已提供 message-port RPC 面，可按 run scope 读取 snapshot、校验 branch target、追加 compaction summary；Agent Workbench 已接入 session tree 面板、leaf move 和 compaction summary 控件，并会把 `chat-branch` custom entry 展示为 regenerate / edit branch lifecycle entry；chat 完成持久化与 `chatSessions.listMessages` 读取修复都已接入 event-derived assistant suffix projection，且 repair 会按 `chat-branch.retainedMessageIds` 截断旧分支 suffix。
- `apps/desktop/src/main/agents/agent.ts` 已提供正式 stateful `Agent` 外壳：持有 model / tools / active tools / messages / resources / system prompt / thinking level，支持 `prompt()`、`continue()`、单项 mutators、原子 `setSettings()`、busy guard、`abort()`、`waitForIdle()`、`steer()` / `followUp()` 内存队列、`nextTurn()` 下一次显式请求注入队列、初始 queued message replay seed、外部 queued message drainer、loop `beforeToolCall` / `afterToolCall` / retry policy passthrough、`"all"` / `"one-at-a-time"` drain 模式、queued message 写入 callback 和 subscriber snapshot；对外 snapshot 的 messages / resources 会结构化 deep clone，caller / subscriber 原地修改 snapshot 不会污染下一轮模型输入；每个 provider turn 会隔离入口快照，运行中 mutator 可通过 `prepareNextTurn` 刷新同一 loop 的下一轮 model / resources / system prompt / thinking level / active tools / tools；subscriber 异常不会打断 turn。`agent-session-binding.ts` 已提供 `createSessionBoundAgent()`，可从 run events 恢复 pending queued messages，把 stateful `Agent` turn messages 持久化为 session entry，并把新的 `steer` / `followUp` / `nextTurn` 写回 `agent_events`；`agent-session-runtime.ts` 已提供 session runtime manager，用于在 `/new` / `/resume` / `/fork` / `/import` 这类会切换 session 的入口串行 teardown + rebuild 当前 session-bound `Agent`，并把 `agent_session_runtime_starting` / `agent_session_runtime_disposing` / `agent_session_runtime_started` / `agent_session_runtime_disposed` 写回 append-only `agent_events`；starting / disposing preflight listener 抛错会取消 session 切换或 shutdown，且不会提前 abort 现有 agent；主 chat runtime 已用该 manager 持有当前 session 的 provider-loop `Agent`，普通请求按 `new` / `resume` 启动，edit / regenerate 分支按 `fork` 重建，app 退出时会统一 dispose cached session runtimes；`chat_messages` 的新 assistant projection 会优先从 `agent_events` 重建 assistant suffix，并写入 `metadata.agentProjection = { source: "agent_events", runId }` 追溯对应 `agent_run`；`chatSessions.listMessages` 会在缺失 projection 时从最新 completed root run 主动 repair，并按 `chat-branch.retainedMessageIds` 移除旧分支 suffix；fork / regenerate 已通过 `chat-branch` custom entry 进入 event log，chat message action、server lifecycle branch 和 Workbench session tree entry 已形成同一条可追踪生命周期。
- `apps/desktop/src/main/agents/agent-state.ts` 已提供最小有状态 runtime 核心：显式 phase、busy guard、subscriber、async listener settlement、`waitForIdle()` 和 typed `AgentRuntimeError`；`buildChatStreamResponse()` 已为真实 chat stream 创建 runtime state 并传入 `streamAgentChat()`，主 provider turn 期间进入 `turn`、结束后回到 `idle`，并向 UI stream 写出 `agent-turn` request phase；stateful `Agent` 的 session-bound event store 持久化已有独立工厂，主 chat runtime 已复用 `Agent` 外壳和 binding helper，并把新 assistant chat message metadata 绑定到 root agent run；chat 完成持久化、读取修复与 fork / regenerate 分支事件已接入 event-derived projection 边界，branch leaf 移动、regenerate action 和 Workbench 分支 entry 也已接到同一 UI / RPC 生命周期。
- Agents enabled 的 HTTP request abort 不再直接传入 run abort signal；请求流断开只会写入 `agent_stream_disconnected` event，active run 继续由 event store / Workbench 可见，用户显式停止时仍通过 `agents.stopActiveRun` 取消当前 run。主 UI stream 会把当前 assistant parts 写入 append-only `agent_ui_stream_snapshot_created`，`chatSessions.listMessages` 可在 active run 未完成时临时从最新 snapshot 恢复 partial assistant text / tool parts，且不会把 running partial 写回 `chat_messages`；`agents.listUiStreamSnapshots` 已按 event `sequence` 提供 cursor 增量读取协议，chat renderer 会在 stream error 或已投影 active run 重新进入页面时轮询新增 snapshot 并原地更新 assistant message。
- `apps/desktop/src/main/agents/agent-turn-state.ts` 已提供每轮请求的只读快照：messages 会 clone 后递归冻结，stream options 会结构化 clone 后递归冻结，tools 做顶层快照冻结，system prompt provider 每轮只解析一次，provider credentials resolver 保留为请求期重取；`streamAgentChat()` 主 provider 请求已通过该快照生成 system / messages / headers / metadata，并把快照输入交给 self-managed loop 的 AI SDK stream adapter；stateful `Agent` 已补 `setSettings()`，可一次性更新 model / resources / system prompt / thinking level / active tools / tools 并作用于下一轮。
- `apps/desktop/src/main/agents/agent-errors.ts` 已提供共享 `AgentRuntimeError`：包含高层 runtime error code 与 `cause` 保留，并能从 `{ error }` / `{ message }` 这类结构化 tool output 提取稳定错误文本；`agent-state.ts` 的 busy guard 与 provider stream hook 已复用该错误类型，主 provider request 准备阶段的 hook 失败会把 run 标记为 failed，主 provider stream 创建失败会包装为 `AgentRuntimeError("provider")` 并保留 cause，tool lifecycle 失败会包装为 `AgentRuntimeError("tool")` 写入 `agent_tool_calls.errorMessage` 与 `tool_call_failed` event code，session tree / event replay 的非法 leaf move 会包装为 `AgentRuntimeError("session")`；stateful `Agent` 的 `onEvent` hook listener 失败会从 public method reject 为 `AgentRuntimeError("hook")` 并保留 cause，普通 state subscriber 失败只参与 settlement，不打断 turn。
- `apps/desktop/src/main/agents/agent-stream-hooks.ts` 已提供 provider stream hook 纯函数链：request headers / metadata patch、payload patch、response hook、hook 合并和 hook 错误的 `AgentRuntimeError("hook")` 包装；hook 链入口会 clone payload / request options / response，避免 hook 原地修改嵌套 messages / metadata / usage 时污染调用方持有的 turn snapshot 或 provider response；`agent-extensions.ts` 已允许 Etyon extension 注册同一套 stream hooks，并按 profile / selected skill capability 过滤后合并进入 `streamAgentChat()`；主 provider stream 与子 agent Etyon `Agent` loop 路径已接入 request / payload / response hook。
- `apps/desktop/src/main/agents/agent-plan-progress.ts` 已提供 Plan / Execute 的 `[DONE:n]` 进度标记解析、去重 summary、marker strip、结构化 JSON plan 验证、瞬态失败 retry 分类，以及 `failFast` / retry / skip 决策 helper；`agent-session-events.ts` 已提供 `plan-mode` custom session entry 持久化 helper；`buildChatStreamResponse()` 会识别最新用户消息的 `/plan` 命令，把当前请求临时切到 `plan` profile、剥离发给模型的命令 token，关闭本次请求的 `allowSubagentDelegation` 并显式传入 read-only active tool allowlist，再注入 `[PLAN MODE ACTIVE]` system prompt；renderer composer 已接入 `Ctrl+Alt+P`，会在当前输入前补 `/plan` 且保留 inline mentions；`streamAgentChat()` 会在 plan profile 完成 provider response 时把已完成步骤写入 `plan-mode` custom session entry、emit `plan_step_completed` events、对合法 JSON plan emit `plan_validated` event，并在持久化 assistant message 时从真实 AI SDK text part 中剥离这些内部标记；`agentCoder` 已作为审批式 execute handoff 入口接入，审批通过后 child `coder` run 会恢复完整 coder tool scope；自研 loop 层与主 `streamAgentChat()` request-level 均支持 active-tools allowlist，failed 顶层 run 已有手动 retry 入口，主 chat provider stream 已接入 self-managed loop，tool-level transient retry 已接入 `settings.agents.retry`，Workbench 已展示 retry strategy preview 与自动 / 手动 retry event preview；Settings 已提供自动重试开关与次数入口，run graph 级 retry policy 已可按 root run 持久覆盖。
- `apps/desktop/src/main/agents/agent-run-graph-templates.ts` 已把 `solo-coder`、`plan-execute-review`、`investigation`、`harness-debug` 固化为内建 run graph template 数据结构，包含 node role、profile、tool scope、parallel group、依赖边和 output contract；`agent-kernel.ts` 已提供 `startRun({ source })` 生命周期边界，chat root run、delegation child run、run graph root run 和 run graph node run 都会写入带 `source` 的标准 `agent_run_started` event；`agent-kernel.ts` 已能把 template 编译成 deterministic execution plan，解析每个 node 的 profile active tools、只读 / approval-gated tool scope、attempt、上次输出、失败原因和拓扑 stage，并通过 `agents.listRunGraphTemplates` / `agents.previewRunGraphTemplate` RPC 暴露给 renderer / workbench；`agents.instantiateRunGraphTemplate` 已能创建顶层 orchestrator run，并把完整 plan 写入 `agent_run_graph_instantiated` append-only event，作为后续 scheduler / UI 可恢复事实来源；`agents.startRunGraphNextStage` 已能 replay root run 的 graph events，启动下一批依赖满足的 ready nodes，创建 parent-linked child runs，并写入 `agent_run_graph_stage_started` / `agent_run_graph_node_started` events；run graph child run 已通过 Etyon `ModelRouter` 记录 profile model route，AI SDK graph node 执行可按 node route 选择 provider model，且 provider 抛错时会按 fallback chain 重试并记录 `agent_model_fallback_used`；`agents.executeRunGraphNode` 已通过 AI SDK provider 执行当前 running node；`agents.advanceRunGraph` 已能读取 running node 的 child run terminal status，把 succeeded / failed、输出和错误回写成 graph node event，并在依赖满足后自动启动下一批 ready nodes；`agents.runGraphUntilIdle` 已能循环 settle / start / execute graph，自动推进多节点 graph，直到 completed、blocked、suspended 或 iteration-limit；kernel 会在 stage start、node settlement 和 retry 后写 `agent_run_graph_checkpoint_created` checkpoint，后续节点 prompt 会带入依赖节点输出；`agents.retryRunGraphNode` 已能对 failed node 创建新 child run、递增 attempt 并保留前次错误上下文；`advanceRunGraph` 会按 `settings.agents.retry` 或 root run retry policy override 对 read-only 且 active tools 全部 safe / idempotent 的 provider / timeout 瞬态失败自动 retry，默认一次，写入 / shell / network 工具失败停在 failed 等待手动处理；`executeRunGraphNode()` 已能用 self-managed `AgentLoopModel` 执行 running graph node，写入 child `agent_loop_event` / run finished events，更新 child run status，再推进 graph；`executeRunGraphNodeWithAiSdk()` 已能把 AI SDK `LanguageModel` 和 tool set 接入同一 loop：provider 只看 tool schema，不自动执行 tool，实际执行走 Etyon tool registry / permission engine，并记录 child `tool_call_started` / `tool_call_finished` / `tool_call_failed` lifecycle；graph node 的 approval-gated tool 会按 Etyon HITL 语义 suspend child run，`agents.respondToRunGraphApproval` 会恢复原 assistant tool call 上下文，approve 后执行真实本地工具并继续推进对应 graph node，deny 后给模型明确 tool error；Workbench approval response 默认传入 `continueUntilIdle`，因此 approval 恢复当前 node 后会自动继续 run graph，直到再次 suspended / blocked / completed；tool output artifact 已写入持久 `agent_artifacts` catalog，通过 `agents.inspectRun` 返回，并可通过 `agents.readArtifact` 读取 bounded content preview，进入 renderer child trace / Agent Workbench panel；chat Workbench 已接入 template list、instantiate、start next stage、execute running node、run graph until idle、advance、failed node retry / skip、per-run retry policy、run graph approval approve / deny + continue-until-idle、stage / node / dependency graph panel、automatic / manual retry event preview、workspace diff preview 和 artifact content preview 操作，并补了 Workbench UI 决策 helper、message-port RPC 和 SSR render 回归。failed node 的 retry / skip 决策入口与 per-run retry policy 覆盖已接入。
- Chat `AgentWorkbenchPanel` 的 run 列表 / 详情双栏区使用 `max-h-[min(24rem,40vh)]`；左侧 run graph list 与右侧 timeline events 列各自嵌套 HeroUI `ScrollShadow`，避免长 run 列表把 Disclosure body 整体撑高。

## 激进架构进步方向

如果目标不是低风险接入，而是尽快追上成熟 agent runtime，Etyon 需要把架构重心从 “chat app 增强” 转成 “本地 Agent Workbench”。这意味着要主动推翻一些现有假设。

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

这会更接近 Etyon 自有的 append-only session tree，也更适合 durable / resumable tool flow。

### Workspace Substrate

Etyon 已经有 project snapshot、文件树、Shiki preview、git status 和 skills。激进路线应把这些从 UI / chat helper 升级为 workspace substrate：

```text
Workspace
  File Index
  Symbol Index
  Git Index
  Sandbox
  LSP
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
- `AgentWorkspace.operations.listProjectSnapshotFiles` 作为 project snapshot / file tree 的单一 workspace 入口，兼容 `findFiles` / `listProjectTree` 只在 registry 做 model-facing 输出包装。
- `AgentWorkspace.operations.lspInspect` / `lspWorkspaceSymbols` / `lspDocumentSymbols` / `lspTouchFile` 作为 LSP inspect、workspace 符号、文件符号与写入后 diagnostics 的 workspace 入口，registry 不直接操作 LSP manager。
- `AgentWorkspace.operations.memorySearch` 作为 project memory 的 workspace 入口，registry 不直接读取 memory retrieval 层。
- 诊断、测试失败、git diff、最近修改、用户选区都成为可查询 context provider。
- 长期 memory 与项目 index 关联，不只是 `source=chat-session` 的文本摘要。

这样 agent 才能在大型项目中持续工作，而不是每次从 chat 文本和零散文件 preview 重新开始。

当前新增目标的优先级是先补 `Workspace Substrate`，再接 `sandbox`，最后接 `LSP`：

- `AgentWorkspace` 持有 `projectPath`、`fileSystem`、`sandbox`、`lsp` 和 `operations`。现有 `ExecutionEnv` 先适配进去，保留 Etyon `Result` 错误边界、事件驱动和可恢复 tool lifecycle，不重写全部工具；首批 filesystem / search / network / command / process alias 已通过 `operations` 进入 workspace substrate，tool registry 只保留 alias、权限 / 审批、artifact 和输出包装。
- 写入类 workspace operation 支持 path 级写锁、读快照追踪和读取快照校验：`AgentWorkspace.operations.writeFile` 会按 resolved path 串行化同一文件写入，并可接收 `expectedMtimeMs` / `requireReadSnapshot`；`edit` / `editFile` / `smartEdit` 在 read 后 write 前会拒绝已被外部修改的文件，model-facing `write` 覆盖已有文件前要求同一 workspace 已读当前快照，避免覆盖用户或其他进程的更新。
- `sandbox` 是 workspace substrate 的执行隔离层，不是 permission mode，也不直接塞进 `bash`。permission / approval 决定工具能否开始执行，sandbox 约束本地进程启动后的 filesystem / network 访问。
- `bash`、`ExecutionEnv.backgroundProcesses`、LSP server spawn 都必须走 `WorkspaceSandbox`。macOS 优先 `sandbox-exec` / Seatbelt，Linux 用 `bwrap`，Windows v1 标记 unsupported；不可用时 fail closed，不静默回退到 unsandboxed 执行。
- `settings.agents.sandbox` 默认 `enabled=false`、`failIfUnavailable=true`、`allowNetwork=false`、`autoAllowSandboxedShell=false`。v1 先建立安全边界，通过测试后再考虑 sandboxed shell 自动允许。
- `settings.agents.lsp` 默认 `enabled=false`、`requireSandbox=true`、`initTimeoutMs=15000`、`diagnosticTimeoutMs=5000`。默认不允许 unsandboxed LSP server。
- `inspect` 是 model-facing alias，内部映射到 Etyon workspace 的 `lsp_inspect` / `etyon_workspace_lsp_inspect`；输入为 `path`、`line`、`match`，其中 `match` 用 `<<<` 标记光标位置；输出 hover、definition、implementation、references 和当前行 diagnostics。
- `symbolSearch` 是 model-facing alias，内部映射到 Etyon workspace 的 `lsp_workspace_symbols` / `etyon_workspace_lsp_workspace_symbols`；输入为 `query`、`limit?`，输出 workspace LSP symbol search 结果。
- `symbols` 是 model-facing alias，内部映射到 Etyon workspace 的 `lsp_symbols` / `etyon_workspace_lsp_symbols`；输入为 `path`、`query?`、`limit?`，输出当前文件的 LSP document symbols。
- `LSPManager` 参考本地 `opencode`（`/Users/jiantianjianghui/gh_projects/opencode`，`dev` at `c7e1fc5e4260fc3e1aea24e26d67ed4074e3575d`）的 lazy client lifecycle。Etyon v1 已实现 TS/JS client 按最近 `tsconfig.json` / `jsconfig.json` / `package.json` / lockfile root 懒启动并复用、同 root 并发 startup 去重、`status()` 暴露 starting / running / broken、`initialize` / `initialized`、`didOpen` / `didChange`、push diagnostics 与 document pull diagnostics 合并、file-level diagnostics、hover、definition、implementation、references、workspace symbols、document symbols、server request / client response 双向 JSON-RPC 边界、初始化 / 诊断超时、server crash 结果边界、`hasClients` / `touchFile` lifecycle API、root broken 状态，以及 sandbox spawn config cleanup；`typescript-language-server` 启动命令优先解析 workspace / project `.bin`，再使用 Etyon desktop dependency 中的 `lib/cli.mjs`，找不到时 fail closed，不回退到裸命令或全局安装；暂不引入 opencode 的多语言内置 server 矩阵和自动下载。
- `edit` 仍然做 exact replacement，不直接升级成复杂 code action；写入后已在 LSP 开启时附加 file-level diagnostics，让模型基于诊断修正。
- 新事件沿用现有 append-only `agent_events`：`sandbox_command_started`、`sandbox_command_output`、`sandbox_command_finished`、`background_process_started`、`background_process_output`、`background_process_finished`、`lsp_server_started`、`lsp_diagnostics_collected`，不新增表；当前 sandboxed command lifecycle / output、background process lifecycle / output 与 LSP start / diagnostics 都通过 workspace event sink 写入。`AgentWorkspace.operations.executeCommand` 复用 `ExecutionEnv.shell.exec()` 的 `started` / `output` / `finished` telemetry stream。

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

参考实现的 plan/execute 不在 core agent 包里，而是作为 **extension**（`examples/extensions/plan-mode/`）实现，以证明 extension 机制足够支撑此类高级流程。Etyon 目标在 agent graph 层面内置 plan/execute，同时保留 extension 可组合的核心思路。

**Plan 阶段（read-only）：**

- 用户通过 `/plan` 命令或 `Ctrl+Alt+P` 进入 plan mode。
- `setActiveTools(["read", "grep", "find", "ls", "stat", "requestAccess"])` — 仅暴露只读 workspace 工具与无副作用授权 checkpoint。
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

- P4 先把 `agentPlan` 暴露给 `coder`，让执行 profile 可委派 read-only plan child 生成 numbered plan；再把 approval-gated `agentCoder` 暴露给 `plan`，用用户审批作为 execute handoff 确认边界，创建 child `coder` run。
- `/plan` generation 请求会临时关闭 sub-agent delegation，避免全局 delegation 开关把 `agentCoder` 暴露给 plan 阶段；execute handoff 仍由审批式 `agentCoder` child run 承担。
- P5 用 run graph 建模 `plan-execute-review` template。

### Durable Execution

Agent 要追上成熟 runtime，必须支持 run 的暂停与恢复：

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

1. tool call 到达 approval 阶段 → `tool_call_approval_requested` event + `status: "approval_requested"` 写入 `agent_tool_calls`，并把 request 投影到 `agent_approvals`。
2. run 进入 suspended 状态，harness phase 仍为 `turn`。
3. UI disconnect 或 app 关闭时，run status 在 DB 记为 `suspended`。
4. app 重启 → 扫描 `agent_runs` 中 `status = "suspended"` 的 runs。
5. 恢复 run：从 `agent_events` 重建 context（messages + tools + model），恢复到 approval 等待点。
6. 用户 approve → emit `tool_call_approved`，更新 `agent_approvals.state` → 执行 tool → loop 继续。
7. 用户 deny → emit `tool_call_denied`，更新 `agent_approvals.state` → tool result `isError: true` + reason → loop 继续（模型看到拒绝原因）。

#### App 重启后的 Run 恢复

参考 runtime 的 `durable-harness.md` 描述了半持久化设计：session 是 append-only 的真相源，但 tools / model / hooks 需要 app 重新注入。

Etyon 恢复流程：

1. 读取 `agent_runs` 中未终结的 run（`status IN ("running", "suspended")`）。
2. 从 `agent_events` 重建到最后一个 save-point 的 model context。
3. 从 settings 重新绑定 tools / model / profile（不持久化运行时闭包）。
4. 如果 run 是因 approval 暂停 → 保持 suspended，等待用户操作。
5. 如果 run 是因 crash 中断 → 标记为 `failed`，通过 `agents.listRecoverableRuns` 暴露给 chat route，并提供手动 retry 按钮。
6. pending session writes（queue 中的 steer / follow-up / next-turn 消息）已有 `agent_events` custom entry helper、`createAgentSessionQueuedMessageWriter()` 适配层、pending replay 计算、下一次请求 drain 最新 completed run queue，以及 active run 内 queued follow-up / steering 进入 self-managed loop 的 runtime 接线；当前 chat route 已能通过 composer 写入 queued steering / follow-up，后续补完整 chat session 生命周期。

### Capability-Based Tool Runtime

外部 runtime 的工具来源与执行边界各有侧重。Etyon 可以把 tools 统一成 capability manifest：

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
- 当前 skill 声明的 capability 能不能绑定到这个 tool。
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

当前已新增 Etyon `resolveAgentModelRoute()` 基座：按 profile `preferredModel`、用户选中 model、fallback chain、隐式 provider 默认值的顺序解析 step model route；run graph child run 会把解析出的 `modelId` 和 `modelRoute` 写入 run metadata 与 `agent_run_graph_node_started` event，AI SDK run graph 执行入口也可通过 `resolveModel` resolver 按 node route 选择实际 provider model。若 graph node 的 profile model 抛出 provider 错误，kernel 会按 `modelRoute.fallbackChain` 尝试备用模型，并把 `agent_model_fallback_used` 写入 child run event。

这样 chat toolbar 选的 model 只是 user preference，不再硬绑定每一步。

### Memory 分层

当前 memory 已经有 session memory 和 long-term memory，但 agent 需要更多层：

| Memory            | 作用                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| run scratchpad    | 当前 run 内 plan、假设、临时发现                                                                                                       |
| branch memory     | fork / regenerate 后保留分支差异                                                                                                       |
| project memory    | 项目约定、架构事实、历史决策                                                                                                           |
| tool result cache | 大型 grep、测试、构建输出摘要；run graph dependency prompt 已有 per-root-run summary cache 与 `agent_tool_result_summary_cached` event |
| user preference   | 用户对风格、权限、流程的偏好                                                                                                           |
| artifact memory   | patch、diff、报告、生成文件的引用                                                                                                      |

关键是 memory write 必须显式：

- 哪个 run 写入。
- 哪个 event 触发。
- 是否来自模型总结还是确定性摘要。
- 可见范围是什么。
- 何时过期或需要重新验证。

不要让 `replaceChatMessages()` 顺手写长期 memory 成为 agent 时代的主写入路径。

### Hook / Middleware 系统

参考 runtime 的 hook 设计值得 Etyon 吸收。激进路线需要一套 kernel middleware：

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

### Mastra 参考取舍

Mastra 更贴近 Etyon 当前的 AI SDK 接入方式：它把 workflow snapshot、suspend / resume、tool approval、memory thread 与 AI SDK stream transform 作为可组合层，而不是强迫应用放弃现有 UI stream。Etyon 不需要整体迁移到 Mastra runtime，但应吸收这些更低层、更贴近 AI SDK 的语义。

| Mastra 能力                         | Etyon 当前对应                                                                                      | 取舍                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Workflow snapshot / suspended state | `agent_events` + `agent_ui_stream_snapshot_created` + `agent_run_graph_checkpoint_created`          | 继续用 SQLite event store；新增 `chat_messages.agent_projection_run_id` 作为 UI projection snapshot identity。 |
| Human-in-the-loop suspend / resume  | `agent_approvals` + `tool_call_approval_requested` / `tool_call_approved` / `tool_call_denied`      | 保留 Etyon approval 表；用 `approvalTtlMs` 给 suspended approval 补 abandonment 策略。                         |
| Tool approval stream transform      | AI SDK `tool-approval-request` UI chunk + Etyon `originalMessages` / `start.messageId` continuation | 不把 approval response 污染 provider prompt；resume 时把真实 tool result 回填到原始 assistant tool-call 后方。 |
| AI SDK model wrapper / processors   | `agent-loop-ai-sdk.ts` + provider-ready message builder + stream hooks                              | 不引入 Mastra wrapper；继续让 AI SDK provider call 可替换，processors / hooks 放在 Etyon extension runner。    |
| Workflow retry attempts             | `settings.agents.retry` + run graph retry policy override + `agent-retry-policy.ts`                 | 自动 retry 只允许 read-only / safe / idempotent tools；write / shell / network 等风险工具需要用户手动 retry。  |
| Thread memory / storage             | `chat_session_memories`、`memory_entries`、session tree event replay                                | 保持 Etyon 自有 memory；后续可借鉴 Mastra thread id + resource id 的读取 API，而不是复制存储层。               |

因此当前方向是 **Mastra-like semantics, Etyon-owned runtime**：用 AI SDK 兼容的 stream / approval / snapshot 形态对接 UI，同时让事实来源、权限、SQLite persistence 和桌面 workspace 仍归 Etyon 控制。

### 参考 Harness

> 参考仓库在 `c7e1fc5e` 之后已重组为 `packages/core/src/{agent, session-event, session-prompt, permission, event, provider, plugin}.ts` 等布局。下文 `packages/agent/` / `packages/coding-agent/` 路径保留作历史对照；评估具体 capability 时应按新 `packages/core/src/` 布局重新锚定。

该参考实现的设计重点不是单个 tool，而是 agent harness。完整架构分为两个包：

**`packages/agent/`（core agent package）— 底层引擎**

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
- `core/extensions/`：四层扩展机制——loader（jiti 加载 `.ts`）→ types（`ExtensionFactory`、lifecycle events）→ runner（`ExtensionRunner`：event 分发、core binding）→ wrapper（tool 包装注入 `ExtensionContext`）。Extension 可通过 `registerTool()`、`registerCommand()`、`registerFlag()`、`on(event)` 扩展行为。
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

对照基准：本地参考仓库，核心包为 `packages/agent/`（harness + loop）与 `packages/coding-agent/`（CLI / `AgentSession` 集成）。

### Etyon 与参考 Harness 对照

Etyon 当前是 **AI SDK `streamText` + profile / tool 注册 + SQLite 事件旁路** 的首版 chat 内 agent；参考实现是 **自研 `AgentHarness` + `agentLoop` + append-only Session 树 + `ExecutionEnv`** 的完整 harness runtime。二者目标相近，分层不同。

#### 架构模块映射

| 参考概念 / 模块               | 参考路径（相对参考仓库）                                                            | Etyon 对应                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 关系说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentHarness`                | `packages/agent/src/harness/agent-harness.ts`                                       | [`agent-runtime.ts`](../apps/desktop/src/main/agents/agent-runtime.ts) 中 `streamAgentChat()` + [`agent.ts`](../apps/desktop/src/main/agents/agent.ts) + [`agent-state.ts`](../apps/desktop/src/main/agents/agent-state.ts) + [`agent-session-binding.ts`](../apps/desktop/src/main/agents/agent-session-binding.ts)                                                                                                                                                                                                                                                                             | **部分**：创建 `agent_run`、写 events、子 agent 委派；已补 stateful `Agent` 外壳、最小 phase（idle / turn / compaction / branch_summary / retry）、busy guard、subscriber、async listener settlement、turn snapshot 隔离、resources 快照、`abort()`、`steer()` / `followUp()` / `nextTurn()` 队列、外部 queued message drainer、loop hook / retry policy passthrough、初始 queued message replay seed、queued message 写入 callback、`waitForIdle()`、`skill()`、`promptFromTemplate()`、`"all"` / `"one-at-a-time"` drain 模式，以及同一 loop 下一轮的 model / resources / system prompt / thinking level / active tools / tools 刷新；主 runtime 已接入 turn snapshot、provider stream hooks、可选 turn phase tracking、approval resume queue replay、下一次请求 drain 最新 completed run queue、active run 内 queued follow-up / steering 自动进入 self-managed loop、provider request / response 的 model context save-point，并通过 `Agent` facade 驱动 provider loop，通过 `agent-session-binding.ts` shared helper 统一 context / queue / missing-only append 语义；session event 层已有 queued `steer` / `followUp` / `nextTurn` custom entry helper、save-point helper、`chat-branch` branch lifecycle entry 与 `Agent.onQueuedMessage` 适配层；`createSessionBoundAgent()` 已把 stateful `Agent` turn messages、pending queue replay、skill / template invocation 和 queued message 写入接到 run event store；当前 chat route 已有 queued steering / follow-up UI + RPC 入口，并在完成时从 event stream 投影 assistant suffix，读取消息时也能 repair 缺失 suffix，且 repair 会按 `chat-branch.retainedMessageIds` 截断旧分支；branch leaf 移动、regenerate action 与 Workbench 分支 entry 已接到同一生命周期入口 |
| `runAgentLoop` / `agentLoop`  | `packages/agent/src/agent-loop.ts`                                                  | [`agent-loop.ts`](../apps/desktop/src/main/agents/agent-loop.ts)；主 chat 与子 run 都用 AI SDK provider adapter + Etyon self-managed loop                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **部分**：已落地独立 self-managed loop 的两轮上下文写回、parallel 完成顺序 vs source-order 写回、mixed sequential batch、通用 active tool allowlist、`beforeToolCall` 阻断 / 改参、`afterToolCall` patch / terminate、hook 错误 settlement、tool error continuation、tool-level retry policy、sequential batch abort settlement、in-flight parallel tool abort settlement、model / tool abort signal、model-visible messages / resources / injected user messages / tool-call boundary / event payload 结构化 deep clone 隔离、steering 注入、final turn follow-up、`prepareNextTurn` 替换 messages / model / resources / thinking level / active tools / tools，以及 async iterable / `ReadableStream` provider stream adapter、tool input delta 聚合、provider-completed tool result passthrough、provider tool error / denied output 转换与 cancellation；主 `streamAgentChat()` 和 delegated child run 已用该 loop 驱动 provider stream / generate provider request、真实 tool lifecycle、approval suspend / resume、`agent_loop_event`、UI stream 投影、`settings.agents.retry` risk-aware transient tool retry，以及持久化 queue 的 resume / next-request / active-run drain；Workbench 已展示 retry strategy preview 与 retry event preview；Settings 已提供自动重试开关与次数入口，run graph 级 retry policy 已可按 root run 持久覆盖                                                                                                                                                                                                                                                                                                                                                                              |
| Turn 快照 `createTurnState()` | `packages/agent/docs/agent-harness.md`                                              | [`agent-turn-state.ts`](../apps/desktop/src/main/agents/agent-turn-state.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **部分**：已落地每轮只读快照，messages clone 后递归冻结，stream options 结构化 clone 后递归冻结，tools 做顶层快照冻结，system prompt provider 只解析一次，provider credentials resolver 不进快照内容、保留请求期重取；`streamAgentChat()` 主 provider 请求已接入，并把 hooked payload 交给 self-managed loop 的 AI SDK stream adapter；stateful `Agent` 已通过 `prepareNextTurn` 刷新下一轮 model / system prompt / thinking level / tools，并补 `setSettings()` 原子更新入口；fork / regenerate 的 `chat-branch` 事件已进入当前 turn 生命周期，读取修复也会按 retained message IDs 截断旧分支 suffix；branch leaf 移动、regenerate action 与 Workbench 分支 entry 已接到同一生命周期入口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Session`（append-only 树）   | `packages/agent/src/harness/session/`                                               | [`agent-session-tree.ts`](../apps/desktop/src/main/agents/agent-session-tree.ts) + [`agent-session-events.ts`](../apps/desktop/src/main/agents/agent-session-events.ts) + [`chat_messages`](../apps/desktop/src/main/chat-messages.ts) 快照 + [`agent_events`](../apps/desktop/src/main/agents/agent-event-store.ts)                                                                                                                                                                                                                                                                             | **部分 + 双轨**：已有 in-memory append-only tree，覆盖 message / leaf / branch summary / compaction summary / custom message entry、leaf move、branch summary 注入、compaction context reset 和未知 entry 拒绝；prepared model messages、branch move、compaction summary、custom message、queued steering / follow-up / next-turn、`chat-branch` 与 provider finish 后的 assistant / tool response messages 已写入 `agent_session_entry_appended`，approval resume 会从 event log 重建 provider context、replay pending queue 并只追加缺失消息；pending queued messages 可从 event log 计算，且 stateful `Agent` 的 queued write callback 已有 event-store writer 适配层；chat route 已有 queued steering / follow-up composer 入口，下一次请求会 drain 最新 completed run queue，active run 内 queued follow-up / steering 也会进入 self-managed loop；main RPC 已提供 `inspectSession`、`moveSessionLeaf` 与 `appendSessionCompactionSummary`，并按 chat session / run scope 拒绝跨 session run；Agent Workbench 已接入 session tree snapshot、leaf move 和 compaction summary 控件；chat route 完成时已用 `agent-chat-projection.ts` 从 event stream 重建 assistant suffix，`chatSessions.listMessages` 也会 repair 最新 completed run 的缺失 suffix，并按 `chat-branch.retainedMessageIds` 删除旧分支 suffix。UI 恢复入口仍是 `UIMessage[]` 快照；branch leaf 移动、regenerate action 与 Workbench 分支 entry 已接到同一生命周期入口                                                                                                                                                                                                                                                                                   |
| `AgentSessionRuntime`         | `packages/coding-agent/src/core/agent-session-runtime.ts`                           | [`agent-session-runtime.ts`](../apps/desktop/src/main/agents/agent-session-runtime.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **部分**：已提供 Etyon session runtime manager，持有当前 session-bound `Agent`，在 `/new` / `/resume` / `/fork` / `/import` 这类 session 切换入口串行 abort + `waitForIdle()` 旧 agent，再创建新 agent；并发 rebuild 会排队，创建失败会清空旧 session 并抛 `AgentRuntimeError("session")`，listener 失败会抛 `AgentRuntimeError("hook")`；主 chat provider loop 已接入该 manager，普通请求按 `new` / `resume` 启动，edit / regenerate 分支按 `fork` 重建，并把 starting / disposing / started / disposed lifecycle 写入 append-only `agent_events`；starting / disposing preflight 可取消 session 切换或 shutdown，且取消时不会提前 abort 当前 agent；Workbench 可从 run trace 看到 session runtime 切换。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ExecutionEnv`                | `packages/agent/src/harness/env/nodejs.ts`                                          | [`execution-env.ts`](../apps/desktop/src/main/agents/execution-env.ts) + [`agent-workspace.ts`](../apps/desktop/src/main/agents/agent-workspace.ts) + [`tool-registry.ts`](../apps/desktop/src/main/agents/tool-registry.ts)                                                                                                                                                                                                                                                                                                                                                                     | **部分**：已有统一 cwd、abort、timeout、大输出 artifact、二进制输出清理、symlink 边界，并提供基础 `fileSystem` Result API（含 temp / cleanup）与 `shell.exec()` Result 错误层；`AgentWorkspace.operations` 已承接首批 filesystem / search / command / process ops（path、stat、list、read、view、mkdir、delete、write、searchContent、findFiles、executeCommand、start/get/recover/stop process），`readFile` / `editFile` / `writeFile` / `listDirectory` / `fileInfo` / `read` / `grep` / `find` / `ls` / `stat` / `mkdir` / `delete` / `smartEdit` / `write` / `bash` / `processOutput` / `stopProcess` 通过这层执行底层动作；`shell.exec()` 结果已包含 `durationMs` 与 `sandboxed` 基础 telemetry，并提供 `started` / `output` / `finished` lifecycle telemetry stream；model-facing `bash background=true`、`processOutput`、`stopProcess` 已能在当前 workspace 内启动 / 读取 / 停止 background process，registry 缺失时会从当前 chat session 的 `agent_events` 恢复 process metadata / bounded output；`grep` / `find` / `searchFiles` 会复用 `AgentWorkspace.operations.searchContent` / `findFiles` 的 sandbox spawn 边界；Agent Workbench 已补 background process lifecycle 专用面板。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tool 钩子                     | `beforeToolCall` / `afterToolCall`（`packages/agent/src/types.ts`）                 | [`agent-loop.ts`](../apps/desktop/src/main/agents/agent-loop.ts) + [`agent-extensions.ts`](../apps/desktop/src/main/agents/agent-extensions.ts)；主 runtime 通过 loop `beforeToolCall` / `afterToolCall` 记录 tool lifecycle 与 approval suspend                                                                                                                                                                                                                                                                                                                                                 | **部分**：独立 loop 已支持改参、阻断、patch result、terminate，hook 异常转 error result 且不 abort 同批其他工具；主 `streamAgentChat` 已把 permission approval、真实 tool start / finish / fail 和 model-visible tool error 移到 self-managed loop 边界；extension runner 已通过 `registerToolHooks()` 暴露 profile / selected skill capability filtered tool hooks，并接入主 chat run 与 delegated child run，可在 permission approval 前改写 input / block / suspend，也可在 tool result 写入 event store 与 UI stream 前 patch output / error / terminate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Tool 注册与过滤               | `coding-agent` tools + harness active tools                                         | [`profiles.ts`](../apps/desktop/src/main/agents/profiles.ts) + [`tool-registry.ts`](../apps/desktop/src/main/agents/tool-registry.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **已对齐思路**：profile `toolPolicy` 决定暴露工具；readonly override 会移除写入 / 检查工具；子 agent scope 可去掉 approval / delegation tools；runtime harness 已对真实 provider call 覆盖主 stream 的 `activeToolNames` 与 selected skill supplemental 工具绑定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 权限 / 审批                   | extension、`AgentSession` 层                                                        | [`permission-engine.ts`](../apps/desktop/src/main/agents/permission-engine.ts) + AI SDK `needsApproval`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Etyon **更显式**；普通 chat UI 侧 `approval-requested` + `addToolApprovalResponse()`；Settings 已有只读 pending approval inbox；Workbench 已通过 `agents.respondToRunGraphApproval` 对 run graph pending approval 做 approve / deny 并恢复挂起节点；`approval-execution.test.ts` 已用 runtime harness 覆盖 suspended profile resume、approve 后真实本地工具执行、denied model error，以及 approved `agentCoder` execute handoff；event-store 覆盖 running / suspended pending resume、run-scoped approvalId 与 provider context rebuild；startup recovery 会 fail 遗留 running run、保留未超期 suspended approval，并让超期 approval 以 `approval_timeout` 失败；failed 顶层 run 已通过 recoverable runs RPC 与 chat 错误条提供手动 retry；run graph automatic retry 已进入 Workbench retry event preview，failed tool calls 已在 Workbench run details 中可见；tool-level transient retry 已在 loop / main runtime / graph node 执行路径接入；Workbench 已展示 retry strategy preview。Settings 已提供自动重试开关与次数入口，run graph 级 retry policy 已可按 root run 持久覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 子 agent                      | `coding-agent` extensions（非 agent 包核心测试）                                    | `agentExplore` / `agentPlan` / `agentReview` / `agentCoder` → child Etyon `Agent` run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **agent-as-tool**：独立 `parentRunId`、摘要回父模型、普通 child 禁用 delegation / approval tools；approval-gated `agentCoder` 用父工具审批作为 execute handoff 边界，审批后 child `coder` 恢复完整 coder tool scope；runtime harness 已覆盖父 history 不进入 child messages、child summary 清理内部 transcript 块，以及 approved plan handoff 后 child `coder` 恢复完整工具集合；main RPC 已提供 `agents.listRuns` / `agents.inspectRun` / `agents.readArtifact` 只读 trace 边界，renderer 可从 `subRunId` 懒加载 child trace，且已有 run graph preview nodes / edges、artifact / event / tool display rows 数据投影；child trace 面板和 chat Agent Workbench panel 可展示父子 run graph preview 与 artifact 列表，chat Workbench 已能创建 template graph、启动 stage、执行 running node、推进 graph、重试 / 跳过 failed node、处理 run graph approval、读取 artifact preview、查看 workspace diff preview，并展示 stage / node / dependency graph panel；Workbench UI 决策 helper 已有纯逻辑回归，`AgentWorkbenchPanel` 已有 SSR render 回归。已新增 run graph until idle 自动推进 RPC 与 Workbench 入口，并让 Workbench approval response 默认 continue-until-idle；failed node 的 retry / skip 决策入口与 per-run retry policy 覆盖已接入                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Provider stream 配置          | `packages/agent/test/harness/agent-harness-stream.test.ts`                          | [`agent-turn-state.ts`](../apps/desktop/src/main/agents/agent-turn-state.ts) + [`agent-stream-hooks.ts`](../apps/desktop/src/main/agents/agent-stream-hooks.ts) + [`agent-loop.ts`](../apps/desktop/src/main/agents/agent-loop.ts)                                                                                                                                                                                                                                                                                                                                                               | **部分**：已覆盖 stream options / provider credentials 的 turn snapshot 边界、request headers / metadata patch、provider payload patch、response hook、hook typed error，以及 hook 输入 payload / request options / response 的嵌套对象隔离；主 `streamAgentChat()` provider stream 与 child Etyon `Agent` loop 路径已接入 turn snapshot 和 request / payload / response hook；self-managed loop 已补 provider stream adapter、tool input delta 聚合与 cancellation 回归，且主 chat stream 已通过 `mode: "stream"` adapter 进入 Etyon loop，child run 已通过 `mode: "generate"` adapter 进入同一 Etyon loop；stateful `Agent` 已补 `setSettings()`；chat session lifecycle 已接入 provider request / response save-point、queued follow-up / steering drain、event-derived assistant suffix projection 与 branch repair                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Compaction                    | `packages/agent/src/harness/compaction/`                                            | [`chat-session-memory.ts`](../apps/desktop/src/main/chat-session-memory.ts)、`settings.chat.autoCompact`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **不在 agent 层**；与参考 harness compaction 不同域                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 应用集成层                    | `packages/coding-agent/src/core/agent-session.ts`                                   | [`chat.ts`](../apps/desktop/src/main/server/routes/chat.ts) → [`agent-chat-context.ts`](../apps/desktop/src/main/agents/agent-chat-context.ts) → [`build-chat-stream-response.ts`](../apps/desktop/src/main/server/routes/build-chat-stream-response.ts)                                                                                                                                                                                                                                                                                                                                         | **部分**：route 已把 memory query、session memory、`@` mention context、selected skill system prompt、selected skill capability、extension module loading、prompt templates 和 `UIMessage` → model messages 准备收敛到 agent 层 `prepareAgentChatContext()`；`chat.ts` 现在只负责请求解析、session 校验、model 解析、branch trigger 与 stream response 编排；chat root run 已通过 `AgentKernel.startRun({ source: "chat" })` 写入 lifecycle event；Agents enabled 的 request abort 已与 run abort 解耦，HTTP stream 断开只写入 `agent_stream_disconnected`，显式 stop 仍通过 `agents.stopActiveRun` 取消 active run；active run 的 `agent_ui_stream_snapshot_created` 可在重新读取 session messages 时临时恢复 partial assistant text / tool parts，且不会持久化 running partial；`agents.listUiStreamSnapshots` 已暴露 `afterSequence` cursor，chat renderer 已在 stream error / projected active run 场景按 cursor 轮询并合并新增 snapshot。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| AgentKernel / Run Graph       | 参考 harness 无完全对应；更接近 workflow / supervisor 层                            | [`agent-kernel.ts`](../apps/desktop/src/main/agents/agent-kernel.ts) + [`agent-loop-ai-sdk.ts`](../apps/desktop/src/main/agents/agent-loop-ai-sdk.ts) + [`agent-run-graph-templates.ts`](../apps/desktop/src/main/agents/agent-run-graph-templates.ts) + `agents.previewRunGraphTemplate` / `agents.instantiateRunGraphTemplate` / `agents.startRunGraphNextStage` / `agents.advanceRunGraph` / `agents.executeRunGraphNode` / `agents.runGraphUntilIdle` / `agents.retryRunGraphNode` / `agents.skipRunGraphNode` / `agents.updateRunGraphRetryPolicy` / `agents.respondToRunGraphApproval` RPC | **部分**：已把内建 template 编译成可调度 execution plan，覆盖 dependency stage、parallel sibling、profile active tools 和 read-only / approval-gated tool scope；message-port RPC 已能返回 template list、preview plan，并能创建顶层 orchestrator run，把完整 plan 写入 `agent_run_graph_instantiated` event，供 renderer / workbench 从 event store 恢复；`startRunGraphNextStage` 会 replay root graph events，按依赖启动下一批 ready nodes，创建 parent-linked child runs 并写入 stage / node started events；`advanceRunGraph` 会把 finished child run 的 terminal status 回写到 graph node，再自动推进下一批 ready nodes，并按 `settings.agents.retry` 或 root run retry policy override 对 read-only / safe / idempotent 节点自动 retry 瞬态失败；`executeRunGraphNode()` 已能用 self-managed `agent-loop.ts` 执行 running child run 并把结果写回 graph；`executeRunGraphNodeWithAiSdk()` 会把 AI SDK provider 响应映射成 self-managed loop turn，tool schema 暴露与 tool 执行解耦，并记录 graph child run 的 tool lifecycle；`agents.respondToRunGraphApproval` 已能从 pending approval 恢复挂起 graph node，approve 后执行真实工具，deny 后向模型回传 tool error；tool output artifact 已持久化，随 `agents.inspectRun` 返回，可通过 `agents.readArtifact` 读取 bounded preview，并进入 renderer trace preview / Agent Workbench panel；chat Workbench 已有基础编排、running node 执行、approval、stage / node / dependency graph panel、automatic / manual retry event preview 和 workspace diff preview 操作。已新增 run graph until idle 自动推进 RPC 与 Workbench 入口，并让 Workbench approval response 默认 continue-until-idle；failed node 的 retry / skip 决策入口与 per-run retry policy 覆盖已接入      |
| `AgentLoop` 双层循环          | `packages/agent/src/agent-loop.ts`（内层 tool+steering；外层 follow-up）            | [`agent-loop.ts`](../apps/desktop/src/main/agents/agent-loop.ts)；主 chat 用 AI SDK provider stream adapter + Etyon self-managed loop                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **部分**：独立 loop 已有内层 tool batch、steering inject 点、follow-up、`prepareNextTurn`、tool-level retry policy 与终止判断；主 runtime 已接入持久化 queue 的 resume / next-request / active-run drain、UI stream 投影、event store lifecycle、provider request / response save-point、chat branch lifecycle 和 `settings.agents.retry` risk-aware transient tool retry；Workbench 已展示 retry strategy preview；Settings 已提供自动重试开关与次数入口，run graph 级 retry policy 已可按 root run 持久覆盖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Plan / Execute 工程           | `packages/coding-agent/examples/extensions/plan-mode/`                              | `agentPlan` / `agentCoder` delegation tools + [`agent-plan-progress.ts`](../apps/desktop/src/main/agents/agent-plan-progress.ts) + [`build-chat-stream-response.ts`](../apps/desktop/src/main/server/routes/build-chat-stream-response.ts) + [`prompt-input.ts`](../apps/desktop/src/renderer/lib/chat/prompt-input.ts)                                                                                                                                                                                                                                                                          | **部分**：已落地 `/plan` 命令 runtime、`Ctrl+Alt+P` composer 入口、`[PLAN MODE ACTIVE]` system prompt、`/plan` request-level 只读工具边界、self-managed loop active-tools allowlist、主 `streamAgentChat()` request-level active tool filter、`[DONE:n]` 进度标记解析、去重 summary、真实 provider text part marker strip、结构化 plan JSON 验证、瞬态失败 retry 分类、`failFast` / retry / skip 决策 helper、`plan-mode` session custom entry helper、`plan_step_completed` / `plan_validated` events、`coder` profile 对 `agentPlan` 的计划委派，以及 `plan` profile 对 approval-gated `agentCoder` 的 execute child run handoff；failed 顶层 run 已有手动 retry UI；runtime harness 已覆盖 approved `agentCoder` handoff 会创建 child `coder` run 并恢复完整 coder tool scope；tool-level transient retry 已接入主 runtime 和 graph node 执行路径；已新增 run graph until idle 自动推进 RPC 与 Workbench 入口，并让 Workbench approval response 默认 continue-until-idle；failed node 的 retry / skip 决策入口与 per-run retry policy 覆盖已接入                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Extension 机制                | `packages/coding-agent/src/core/extensions/`（loader → types → runner → wrapper）   | [`agent-extensions.ts`](../apps/desktop/src/main/agents/agent-extensions.ts) + [`tool-registry.ts`](../apps/desktop/src/main/agents/tool-registry.ts) + [`agent-runtime.ts`](../apps/desktop/src/main/agents/agent-runtime.ts)                                                                                                                                                                                                                                                                                                                                                                   | **部分**：已落地 Etyon extension runner、module export loader、`registerTool()`、`registerToolHooks()`、`registerStreamHooks()`、`on(event)` lifecycle handler、profile / selected skill capability filter、AI SDK tool wrapper，以及 runtime stream hook / tool hook 合并；extension tool 已能进入主 `streamAgentChat()` self-managed loop，执行时复用既有 tool lifecycle / event store，并发出 `tool_registered` / `tool_call_started` / `tool_call_finished` / `tool_call_failed` 事件；extension tool hooks 已能按 profile / selected skill capability 进入主 chat run 和 delegated child run 的 `beforeToolCall` / `afterToolCall` 链；extension stream hooks 已能按 profile / selected skill capability 进入主 run 和 delegated child run 的 provider request / payload / response hook 链；selected skill 已可通过 `SKILL.md` frontmatter 的 `extensions` 字段声明相对 module 路径，chat route 会在 Agents 启用时加载这些 module 并传入 runtime；Settings 的 Skills tab 已展示 parsed extension module 计数和每个 skill 声明的 module 路径，便于运行前核对；`SKILL.md` frontmatter 已解析 `command` / `commands` 与 per-command `flags`，并通过 RPC schema、system prompt XML、Settings command count 与 command+flag 明细展示暴露；composer 根 `/` command palette 已提供 `/plan` / `/prompt` / `/skill` 入口，`/skill <skill> <command> [flags] ...` 已能在 provider 前展开为 `<skill_command_invocation>`                                                                                                                                                                                                                                                                                                        |
| 错误处理分层                  | `packages/agent/src/harness/types.ts`（`Result<T,E>`）+ `AgentHarnessError`         | [`execution-env.ts`](../apps/desktop/src/main/agents/execution-env.ts) + [`agent-errors.ts`](../apps/desktop/src/main/agents/agent-errors.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **部分**：`ExecutionEnv` 底层已用 `Result<T,E>`，高层已补共享 `AgentRuntimeError` code / cause 并接入 phase busy guard、provider hook failure、主 provider stream 创建失败、tool lifecycle failed settlement，以及 session tree / event replay 非法 leaf move；tool output `{ error }` 会被提取为稳定错误文本并以 `AgentRuntimeError("tool")` 写入 tool-call row / event；stateful `Agent` 的 `onEvent` hook listener 失败会从 public method reject 为 `AgentRuntimeError("hook")` 并保留 cause，普通 subscriber failure 不打断 turn                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Prompt Template               | `packages/agent/src/harness/prompt-templates.ts`                                    | [`prompt-templates.ts`](../apps/desktop/src/main/agents/prompt-templates.ts) + [`agent.ts`](../apps/desktop/src/main/agents/agent.ts) + [`skills.ts`](../apps/desktop/src/main/skills.ts) + [`prompt-input.tsx`](../apps/desktop/src/renderer/components/chat/prompt-input.tsx)                                                                                                                                                                                                                                                                                                                  | **部分**：已落地 `.md` 非递归加载、可选 frontmatter、`$1` / `$2` 参数替换、`$ARGUMENTS` 全量参数替换、`$$` 转义、shell 风格 args 解析、XML 格式化输出、`Agent.promptFromTemplate()` runtime invocation、`Agent.skill()` direct skill invocation、`formatSkillInvocation()`、可见 skill 目录下 `prompts/*.md` 的加载入口、`skills.listPromptTemplates` RPC、composer 根 `/` command palette、`/prompt` suggestion、suggestion 行内 `$1` / `$2` 参数 hint，以及 server-side `/prompt <template> ...` 展开                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Skills 结构化加载             | `packages/agent/src/harness/skills.ts`                                              | [`skills.ts`](../apps/desktop/src/main/skills.ts) + [`agent-extensions.ts`](../apps/desktop/src/main/agents/agent-extensions.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **部分**：已解析 `name` / `description` / `short-description` / `visible` / `model-visible` / `model-disabled` / `capabilities` / `extensions` / `command` / `commands`，项目与全局 root 已有显式 `source` 元数据，system prompt 已 XML 格式化并跳过 model-invisible skill body，`model-disabled` skill 已通过 `<skill_references>` 暴露可引用元数据；内建 agent tools 已有 capability manifest，permission engine 已按 manifest 分流 `read-fs` / `write-fs` / `shell`，显式选中的 skill capability 已接入 chat route、`streamAgentChat()` 与 `buildAgentTools()`，用于补充本次请求的 capability-gated 内建 supplemental 工具；extension runner 已能让自定义 tool 与 stream hooks 按 selected skill capability 进入 runtime 执行绑定，selected skill 的相对 extension module 路径已能安全解析并在 Agents 启用时自动加载；Settings 已能显示 parsed extension module 数量、skill-level module 路径、command 数量与 command+flag 明细；composer 根 `/` command palette 已接入，`/skill <skill> <command> [flags] ...` 会校验 declared command / flags 并展开为模型可见 invocation XML                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 消息类型扩展                  | `packages/agent/src/harness/messages.ts`（declaration merge `CustomAgentMessages`） | [`agent-messages.ts`](../apps/desktop/src/main/agents/agent-messages.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **部分**：已有 `AgentMessage` / custom message union、`CustomAgentMessages` declaration merge 扩展点、`convertAgentMessagesToLlm()` 排除非 model-visible custom message、debug formatter，并已被 in-memory session tree、resume context rebuild 与 `agent-chat-projection.ts` chat projection 复用；`chat-branch` 已进入 custom entry 与 chat storage repair 边界；branch leaf 移动、regenerate action 与 Workbench 分支 entry 已接到同一生命周期入口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Truncate 工具                 | `packages/agent/src/harness/utils/truncate.ts`                                      | [`truncate.ts`](../apps/desktop/src/main/agents/truncate.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **部分**：已落地 `truncateHead` / `truncateTail` / `truncateLine` / `formatSize` / `summarizeToolResult` / `summarizeToolResultWithProcessor` / `formatToolResultSummaryAnnotation` / `appendToolResultSummaryAnnotation` / `createToolResultSummaryCache`，使用 code point 截断避免切坏 surrogate pair；`ExecutionEnv` 已复用并 re-export，并在命令输出 artifact 写入 stdout / stderr deterministic summary；graph dependency prompt 与 `processOutput` 已输出模型可见截断标注，graph dependency prompt 已接入 AI SDK model summary processor、processor 失败时回退 deterministic summary，并通过 per-root-run summary cache 避免 sibling 节点重复总结同一大型依赖输出，缓存写入会记录 `agent_tool_result_summary_cached` event                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Shell 输出捕获                | `packages/agent/src/harness/utils/shell-output.ts`                                  | [`execution-env.ts`](../apps/desktop/src/main/agents/execution-env.ts) + [`agent-workbench.ts`](../apps/desktop/src/renderer/lib/chat/agent-workbench.ts) + [`agent-workbench-panel.tsx`](../apps/desktop/src/renderer/components/chat/agent-workbench-panel.tsx)                                                                                                                                                                                                                                                                                                                                | **部分**：命令 preview 截断、完整 artifact、二进制输出清理、timeout 前 partial stdout / stderr 保留，以及结构化 `onOutput({ channel, chunk, sequence })` streaming 事件已落地；Agent Workbench 已把 `sandbox_command_output` / `background_process_output` 按 command / process / channel 聚合为 bounded shell output live tail，并随 run trace refetch 展示最新 output；`sandbox_command_started` / `sandbox_command_output` / `sandbox_command_finished` 已归一化为 shell command lifecycle 面板，展示 command、cwd、pid、status、shell status、exit code、duration、sandbox 与 stdout / stderr chars                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Agent 有状态封装              | `packages/agent/src/agent.ts`（`Agent` 类：state、subscribe、mutators、并发 guard） | [`agent.ts`](../apps/desktop/src/main/agents/agent.ts) + [`agent-state.ts`](../apps/desktop/src/main/agents/agent-state.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **部分**：已有正式 Agent 实例、phase state、subscribe、async listener settlement、busy guard、`prompt()` / `continue()`、`skill()`、`promptFromTemplate()`、mutators、原子 `setSettings()`、messages / resources snapshot deep clone、`setResources()`、`abort()`、`steer()` / `followUp()` 内存队列、`nextTurn()` 下一次显式请求注入队列、initial queued messages replay seed、queue drain mode、queued message 写入 callback、`waitForIdle()` 和 next-turn model / resources / system prompt / thinking level / active tools / tools 刷新；queued message 写入 callback 已可通过 `createAgentSessionQueuedMessageWriter()` 持久化到 `agent_events`；真实 chat stream 已创建 runtime state 并跟踪主 provider turn，chat route 已有 queued steering / follow-up composer 入口；主 chat runtime phase snapshot 已持久化为 `agent_runtime_snapshot_created`，可随 chat session run trace 回放 turn / idle 生命周期                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Proxy Stream                  | `packages/agent/src/proxy.ts`（`streamProxy`、HTTP 代理 LLM、partial message 重建） | 无                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **不适用于首版**（Etyon 走 renderer ↔ Hono 本地通信）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

#### 数据流对照（简图）

```text
参考 harness:
  AgentHarness.prompt()
    -> createTurnState()
    -> runAgentLoop (before/afterToolCall, steer queue)
    -> Session append (tree) + ExecutionEnv
    -> stream hooks -> provider

Etyon（当前）:
  POST /api/chat
    -> prepareAgentChatContext()（agent 层 memory / @ / skills / extensions）
    -> streamAgentChat()
         -> createAgentRun + agent_events（旁路）
         -> createAgentTurnState + prepareAgentStreamRequest（主 provider 请求）
         -> Agent facade + runAgentLoop + AI SDK adapter（主 chat / 子 agent）
         -> onFinish -> replaceChatMessages（UI 快照）
```

#### 测试覆盖映射

参考 `packages/agent/test/` 约 16 个专项文件；Etyon `apps/desktop/test/main/agents/` 当前 39 个 `.test.ts` 文件（外加 `regressions/etyon-0001-*` 回归文件）。下表说明参考用例形态与 Etyon 落地状态（截至文档更新时）。

| 参考测试                               | 覆盖意图                                          | Etyon 对应测试                                                                                                                                                                                                                                                                                      | 状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-loop.test.ts`                   | mock 两轮：tool 执行 → result 进下一轮；事件顺序  | `agent-loop.test.ts`、`agent-loop-ai-sdk.test.ts`、`agent-runtime-harness.test.ts`                                                                                                                                                                                                                  | **部分**（独立 loop 已覆盖两轮上下文写回与事件顺序、tool-level retry 和事件顺序；AI SDK stream adapter 已覆盖 provider 只消费 tool schema、不自动执行 tool，并可把 streamed tool input deltas 聚合成 Etyon tool call；主 `streamAgentChat` 已写入 `agent_loop_event` 并由 Etyon loop 执行 tool / approval lifecycle；runtime harness 已覆盖 active run 内 queued follow-up 触发第二轮 provider turn，以及 streamed tool input deltas 触发真实本地 `read` tool 执行；Workbench helper / panel 已覆盖 retry strategy preview；Settings 已提供自动重试开关与次数入口，run graph 级 retry policy 已可按 root run 持久覆盖）                                                                                                                                                                                                                                                                                                                                                                                           |
| `agent-loop.test.ts`                   | parallel 完成顺序 vs tool result 写回顺序         | `agent-loop.test.ts`                                                                                                                                                                                                                                                                                | **已落地**（完成事件按完成顺序，写回模型上下文按 source order）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `agent-loop.test.ts`                   | steering 队列在 tool batch 完成后注入             | `agent-loop.test.ts`、`agent-runtime-harness.test.ts`                                                                                                                                                                                                                                               | **部分**（独立 loop 已覆盖 batch 后注入、final turn follow-up 与 `prepareNextTurn`；主 runtime 已接入持久化 queue drain，并用 faux provider 覆盖 active run 内 queued steering 在 tool batch 后进入下一轮 prompt；chat route / session event / Workbench lifecycle 已接到同一 queue 与 branch 事件模型）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `agent-loop.test.ts`                   | `beforeToolCall` 改参 / `afterToolCall` terminate | `agent-loop.test.ts`、`agent-extensions.test.ts`、`agent-runtime-harness.test.ts`                                                                                                                                                                                                                   | **部分**（独立 loop 已覆盖改参、阻断、patch output、terminate、hook error settlement 与 tool error continuation；主 `streamAgentChat` 已通过 loop `beforeToolCall` / `afterToolCall` 执行 approval、tool lifecycle 和 model-visible tool error；extension `registerToolHooks()` 已覆盖 profile / selected skill capability filter，并用 runtime harness 覆盖真实 provider tool call 的 input rewrite 与 output patch）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `harness/agent-harness.test.ts`        | steer / follow-up / abort 队列、hook settlement   | `agent.test.ts`、`agent-loop.test.ts`、`agent-event-store.test.ts`、`agent-session-events.test.ts`、`agent-runtime.test.ts`、`agent-runtime-harness.test.ts`、`regressions/etyon-0001-queued-follow-up-next-request.test.ts`                                                                        | **部分**（已覆盖 `steer()` / `followUp()` / `nextTurn()` 队列、initial queued messages replay、queue drain mode、queued message callback flush、queued session custom entry 持久化、`Agent.onQueuedMessage` 到 event-store writer 适配、pending queue 计算、chat runtime resume queue replay、下一次请求 drain 最新 completed run queue、active run 内 queued follow-up / steering 自动进入 self-managed loop、chat route queued steering / follow-up UI 状态、`abort()` signal、busy guard、messages / resources snapshot deep clone、resources next-turn refresh、turn snapshot 隔离、subscriber error settlement、stateful `Agent` loop hook failure settlement、session save-point append / latest save-point context rebuild；`ETYON-0001` 已把 completed run queued follow-up 的 next-request replay 固化为编号 regression）                                                                                                                                                                                |
| `agent.test.ts`                        | Agent state / subscribe / busy guard              | `agent.test.ts`、`agent-state.test.ts`、`agent-runtime.test.ts`、`agent-runtime-harness.test.ts`                                                                                                                                                                                                    | **部分**（已覆盖 stateful Agent 构造、`prompt()` / `continue()`、mutators、原子 `setSettings()`、phase guard、subscriber、async listener settlement、abort signal、队列、`waitForIdle()`、对外 snapshot message deep clone 隔离、运行中 system prompt mutator 不污染当前 provider 且可刷新下一 loop turn、主 provider turn phase tracking，以及 chat runtime phase snapshot 进入 `agent_events`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `harness/types.test.ts`                | typed runtime error                               | `agent-errors.test.ts`、`agent.test.ts`、`agent-runtime.test.ts`、`agent-runtime-harness.test.ts`                                                                                                                                                                                                   | **部分**（已覆盖 `AgentRuntimeError` code / cause、hook failure、provider stream 创建失败、tool lifecycle 失败时从结构化 `{ error }` 输出提取稳定文本并写入 `tool_call_failed` code、session tree / event replay 非法 leaf move 的 typed session error，以及 stateful `Agent` `onEvent` listener 失败向 public method typed reject 为 `AgentRuntimeError("hook")`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `harness/agent-harness-stream.test.ts` | stream options 与 provider hook                   | `agent-turn-state.test.ts`、`agent-stream-hooks.test.ts`、`agent-loop.test.ts`、`agent-loop-ai-sdk.test.ts`、`agent-extensions.test.ts`、`agent-runtime-harness.test.ts`                                                                                                                            | **部分**（已覆盖 messages 深层快照隔离、stream options 结构化深快照和递归冻结、system prompt provider 单次解析、provider credentials resolver 请求期重取、request / payload / response hook patch 链、extension stream hook 注册 / profile / skill capability 过滤与合并；主 runtime 和子 agent 路径已接入；self-managed loop 已覆盖 provider stream adapter、tool input delta 聚合与 cancellation，主 chat stream 已接入该 adapter；stateful `Agent` 已补 `setSettings()`、loop hook passthrough 和外部 queue drain；chat 完成持久化已接入 event-derived assistant suffix projection，fork / regenerate 已写入 `chat-branch`，读取修复也会按 retained message IDs 截断旧分支 suffix；branch leaf 移动、regenerate action 与 Workbench 分支 entry 已接到同一生命周期入口）                                                                                                                                                                                                                                        |
| `harness/session.test.ts`              | branch、leaf、compaction 上下文重建               | `agent-session-tree.test.ts`、`agent-session-events.test.ts`、`approval-execution.test.ts`、`agent-event-store.test.ts`、`index.test.ts`、`agent-workbench.test.ts`、`agent-workbench-panel.test.ts`                                                                                                | **部分**（已有 in-memory session tree，覆盖 message / leaf / branch summary / compaction summary / custom message context rebuild 与未知 entry 拒绝；session entry event 可持久化并重建 provider context，approval resume 可重建真实 provider context、replay pending queued steering 并只追加缺失消息；stateful `Agent` 的 session-bound 工厂已覆盖 pending queue replay、turn message 持久化和 queued message 写回；主 chat runtime 已通过 `Agent` facade 驱动 provider loop，并复用 shared binding helper；message-port RPC 已覆盖 session snapshot、leaf move、compaction summary 和跨 session run 拒绝；renderer helper / Agent Workbench panel 已覆盖 session entry preview、leaf display、branch target 选择和 compaction 控件；chat 完成持久化已用 event stream 重建 assistant suffix，fork / regenerate 已写入 `chat-branch`，读取修复也会按 retained message IDs 截断旧分支 suffix；branch leaf 移动、regenerate action 与 Workbench 分支 entry 已接到同一生命周期入口）                                |
| `harness/nodejs-env.test.ts`           | `ExecutionEnv` 边界                               | `execution-env.test.ts`、`workspace-sandbox.test.ts`、`tool-registry.test.ts`、`command-tools.test.ts`                                                                                                                                                                                              | **部分**（cwd、symlink、abort、timeout、输出 artifact、二进制输出清理、Result 风格路径 helper、exists、读写、分行/二进制读取、mkdir、remove、temp / cleanup、`fileInfo` / `listDir`、`shell.exec()` typed error、structured output event、timeout partial output、background process start / list / get / stop / cleanup、model-facing `bash background=true` / `processOutput` / `stopProcess` / `stat` / `mkdir` / `delete`、sandbox fail closed、sandbox disabled 才允许 unsandboxed、sandbox cwd 越界拒绝、network allow / deny 边界、secret env scrub、`findFiles`、`listDirectory`、`fileInfo`）                                                                                                                                                                                                                                                                                                                                                                                                            |
| `harness/truncate.test.ts`             | 输出截断                                          | `truncate.test.ts`                                                                                                                                                                                                                                                                                  | **部分**（已覆盖 tail / head / line 截断、surrogate pair、`formatSize`、deterministic summary、模型可见截断标注、LRU summary cache 和模型 summary processor 失败回退）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `harness/prompt-templates.test.ts`     | prompt 模板加载与格式化                           | `prompt-templates.test.ts`、`agent.test.ts`、`skills.test.ts`、`build-chat-stream-response.test.ts`、`prompt-input.test.ts`、`index.test.ts`                                                                                                                                                        | **部分**（已覆盖 `.md` 加载、frontmatter、非递归、shell args、位置参数与 `$ARGUMENTS` 替换、格式化、`promptFromTemplate()` runtime invocation、skill `prompts/*.md` 加载入口、RPC 暴露、composer suggestion helper、suggestion 参数 hint、composer 根 `/` command palette range / filter，以及 server-side `/prompt` 展开）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `harness/skills.test.ts`               | skill 加载与 system prompt 格式化                 | `skills.test.ts`、`packages/rpc/test/schemas/skills.test.ts`、`tool-manifest.test.ts`、`tool-policy.test.ts`、`tool-registry.test.ts`、`agent-chat-context.test.ts`、`agent-extensions.test.ts`、`agent-runtime.test.ts`、`agent-runtime-harness.test.ts`、`app.test.ts`、`skills-settings.test.ts` | **部分**（已覆盖 SKILL frontmatter / body、项目与全局 root、source 元数据、capabilities / extensions / commands schema 默认值、command block / inline parsing、XML prompt、XML command metadata、model-invisible body 跳过、model-disabled reference 输出、内建 tool capability manifest 完整性、显式 skill capability 到 supplemental 内建工具的 policy 编译、agent chat context 对 selected skill system prompt / capability / extension / prompt template 的统一准备、extension tool / stream hook 注册 / lifecycle / loader、selected skill extension path 安全解析、Settings extension module path 展示 helper、Settings command display helper、composer 根 `/` command palette helper、server-side `/skill` runtime invocation 展开，以及已选 skill capability / extension runner 进入 chat runtime / tool registry 后保留 profile 工具、补充 supplemental 工具并过滤 extension tool / stream hook）                                                                                                       |
| `harness/messages.test.ts`             | custom message → LLM message 转换                 | `agent-messages.test.ts`、`agent-session-tree.test.ts`、`agent-runtime.test.ts`                                                                                                                                                                                                                     | **部分**（已覆盖 model-visible message 转换、自定义 run / tool event message 排除、debug 格式化，以及 session tree 中 custom message 不进入 model context；已用于 runtime resume context rebuild、chat assistant suffix projection 和 `chat-branch` storage repair；branch leaf 移动、regenerate action 与 Workbench 分支 entry 已接到同一生命周期入口）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `harness/compaction.test.ts`           | token 切分、summary                               | —                                                                                                                                                                                                                                                                                                   | **不适用**（走 chat auto-compact）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| HITL `tool-call-step` 形态             | approval suspend → approve/deny                   | `approval-execution.test.ts`、`agent-runtime-harness.test.ts`、`agent-event-store.test.ts`、`index.test.ts`、`agent-recovery.test.ts`                                                                                                                                                               | **部分**（已有真实 provider step 触发 approval request、suspended / approve / deny、running 状态 pending resume、run-scoped approvalId、startup recovery 会保留未超期 suspended approval 并让超期 approval 以 `approval_timeout` 失败、resume provider context rebuild、pending queued steering replay、missing-only session append、assistant / tool response session 投影覆盖；failed 顶层 run 手动 retry 已有 RPC 与 chat route 入口；run graph automatic retry 已进入 Workbench retry event preview，failed tool calls 已在 Workbench run details 中可见；tool-level transient retry 已进入 loop / main runtime / graph node 执行路径；Workbench helper / panel 已覆盖 retry strategy preview；Settings 已提供自动重试开关与次数入口，run graph 级 retry policy 已可按 root run 持久覆盖）                                                                                                                                                                                                                    |
| Sub-agent tool 形态                    | 子 agent 上下文隔离、无 metadata 泄漏             | `agent-runtime-harness.test.ts`、`apps/desktop/test/main/rpc/index.test.ts`、`apps/desktop/test/renderer/lib/chat/agent-run-trace.test.ts`、`apps/desktop/test/renderer/lib/chat/agent-workbench.test.ts`、`apps/desktop/test/renderer/components/chat/agent-workbench-panel.test.ts`               | **部分**（runtime harness 已覆盖真实 child Etyon `Agent` run、child request hooks、child context 隔离、受限 tools、child abort signal、child step budget、结构化 `subRunId`、summary transcript 清理；main RPC 已能按 session 读取 run list，并按 run 读取 events / toolCalls / artifacts，且可读取 bounded artifact content preview；renderer tool trace 已能从 `subRunId` 懒加载 child trace，并能构建 run graph preview nodes / edges 与 artifact / event / tool display rows；chat Agent Workbench panel 已能列出 session run graph、选择 run、展示 timeline / artifacts，并执行基础 create / start / advance / retry / skip / artifact preview 与 stage / node / dependency graph panel；Workbench UI 决策 helper 已覆盖 root run、root trace、按钮状态和 failed node，Workbench panel 已有 SSR render 回归；已新增 run graph until idle 自动推进 RPC 与 Workbench 入口，并让 Workbench approval response 默认 continue-until-idle；failed node 的 retry / skip 决策入口与 per-run retry policy 覆盖已接入） |
| —                                      | profile / 工具策略                                | `profiles.test.ts`、`tool-registry.test.ts`                                                                                                                                                                                                                                                         | **已落地**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| —                                      | allow / ask / deny                                | `permission-engine.test.ts`                                                                                                                                                                                                                                                                         | **已落地**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| —                                      | event store 顺序与 tool_calls                     | `agent-event-store.test.ts`                                                                                                                                                                                                                                                                         | **已落地**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| —                                      | agents 关/开、route 注入 tools                    | `agent-chat-context.test.ts`、`agent-runtime-harness.test.ts`、`app.test.ts`                                                                                                                                                                                                                        | **部分**（runtime harness 已覆盖 agents disabled 时不创建 run / events、无 tools 且 abort signal 透传；agents enabled 时创建 default profile run、写 `agent_run_started` 并把 profile tools 传给 provider；`maxSteps` 预算已用真实 provider step 数覆盖；agent chat context 已覆盖 memory query、selected skill capability、extension loading 和 prompt template 准备；route 测在 `app.test.ts`，非 `chat.test.ts`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**参考 `packages/agent/test/` 完整测试（16 个文件）：**

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
| `harness/resource-formatting.test.ts`  | 2      | skill invocation 与 prompt template invocation 格式化                                                                                |

**参考 `packages/coding-agent/test/suite/` 测试（AgentSession 层 8 个文件 + 17 个回归）：**

| 测试文件                                 | 覆盖域                                                               |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `agent-session-prompt.test.ts`           | prompt → agent loop → event 序列                                     |
| `agent-session-queue.test.ts`            | steer / followUp 队列行为                                            |
| `agent-session-compaction.test.ts`       | auto-compaction 触发与 summary                                       |
| `agent-session-bash-persistence.test.ts` | bash 命令状态持久化                                                  |
| `agent-session-model-extension.test.ts`  | 模型切换与 extension 交互                                            |
| `agent-session-retry-events.test.ts`     | 自动 retry 事件序列                                                  |
| `agent-session-runtime.test.ts`          | runtime cancellable lifecycle、teardown / rebuild                    |
| `regressions/*.test.ts` (17 个)          | event settlement、stale resource、skill collision、tool allowlist 等 |

**Etyon 与参考测试工厂对照：**

| 参考工厂（`test/suite/harness.ts`）              | Etyon 对应                                  | 说明                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createHarness(options?)`                        | `test/main/agents/agent-runtime-harness.ts` | **部分**：已有最小 project / chat session / faux model / stream 入口，并可把 `runtimeState` 透传给真实 `streamAgentChat()` 做 turn phase 覆盖                                                                                                                                                                                            |
| `registerFauxProvider()` → `faux.setResponses()` | `test/main/agents/faux-provider.ts`         | **部分**：已有确定性 stream / generate response 队列、最近 stream tool names inspection，并已接入 runtime harness；测试流已改为本地 `ReadableStream` helper，不再依赖 deprecated `simulateReadableStream`                                                                                                                                |
| `harness.session.subscribe()` → `events[]`       | `test/main/agents/agent-runtime-harness.ts` | **部分**：已有 `session.listRuns()`、`session.listEvents()`、`session.listModelMessages()`、`session.listToolCalls()`、`session.listPendingApprovals()`、`session.subscribe()` 与 `session.suspendForToolApproval()` 覆盖 session-scoped run / event / user-assistant-tool message / tool-call row / pending approval / approval harness |
| `harness.faux.appendResponses()`                 | `test/main/agents/faux-provider.ts`         | **部分**：支持追加多轮 stream / generate response，可通过 runtime harness 复用                                                                                                                                                                                                                                                           |

**建议补测优先级**（吸收参考 harness 收益最高、且不改架构即可做的项）：

1. mock 两轮 `LanguageModel`：已先在 `agent-loop.test.ts` 覆盖独立 loop，并补 `createAgentLoopStreamModel()` provider stream adapter / cancellation；主 `streamAgentChat` 已切到该 loop，并通过 runtime harness 断言真实 `agent_loop_event` 序列。
2. 扩展 tool-level / approval retry 决策交互覆盖；failed 顶层 run 手动 retry 已有 RPC、chat route 和 helper 测试，Workbench 已有 retry strategy preview、自动 / 手动 retry event preview 与基础 helper 测试。
3. 子 agent：继续补完整 workbench 级 run graph、timeline 与组件级状态回归。
4. 继续扩展 `execution-env.ts` 的参考 `nodejs-env.test.ts` 子集（FS Result 接口、错误标准化）。
5. 继续扩展已落地的 runtime harness：剩余手写 `streamText` mock 仅保留 provider creation failure 这类 faux provider 无法同步触发的低层边界。
6. 继续扩展 `agent-loop.test.ts` / `agent-runtime-harness.test.ts`：queued steering / follow-up UI、RPC、active run drain、第二轮 provider turn、session tree snapshot / branch / compaction RPC、active run UI stream snapshot replay、`agents.listUiStreamSnapshots` cursor RPC、renderer 自动重连订阅，以及 Agent Workbench renderer 控件已接线。
7. `stream-options.test.ts` 已补：覆盖 stream options 快照隔离、provider request / payload hook 链，以及最终 headers 进入真实 provider request、metadata 被后续 hook 正确消费。
8. 新增 `session-tree.test.ts`：branch、leaf move、compaction context 重建（P5 阶段）。
9. `regressions/` 已启动：`ETYON-0001` 覆盖 completed top-level run 的 queued follow-up 必须 drain 到下一次 provider request；后续 bug fix 继续按 Etyon 编号追加。

### Workspace 参考

该参考实现的重点是 workspace-backed tool registry、agent-as-tool 和 stream 转换。本节已按本地 workspace 参考仓库最新源码校准。

- Agent 会合并静态 tools、memory tools、toolsets、client-side tools、agent tools、workflow tools、workspace tools、skill tools 等来源。
- tool 名称会被标准化，并检测 provider 限制与名称冲突。
- 参考 code-agent 不再把 filesystem / grep / glob / edit / command 这类能力放在动态工具里临时拼装，而是通过 workspace substrate 统一提供；Etyon 动态 tools 主要补 `requestAccess`、`webSearch` / `webExtract`、MCP、extra tools、hook 包装和 `deny` policy 过滤，其中 `requestAccess` 已落地为 tool registry 级 approval checkpoint。
- Etyon workspace core names 映射为 code-agent 友好的 model-facing alias：`view`、`write_file`、`string_replace_lsp`、`find_files`、`delete_file`、`file_stat`、`mkdir`、`search_content`、`ast_smart_edit`、`execute_command`、`process_output`、`stop_process`、`lsp_inspect`、`lsp_workspace_symbols`、`lsp_symbols`、`web_search`、`web_extract`。
- plan mode 不是复制一套工具，而是在 workspace tools config 中禁用写入 / edit / AST edit；Etyon 的 profile allowlist 和 `includeApprovalTools=false` 应继续向这个方向收敛。
- 子 agent 被包装成普通 tool：父 agent 只看到一个 `agent_<name>` tool。
- 子 agent 有独立 thread / resource / memory，父 agent 上下文可以按策略传入，但不直接污染子 agent 持久化消息。
- 子 agent 输出默认只给父 agent 一个摘要，完整 tool details 保存在 trace / memory 里。
- 委派有 lifecycle hook，可拒绝、修改或记录委派；Etyon 当前通过 extension `on("delegation_started" / "delegation_finished" / "delegation_rejected")` 做观察记录，并通过 `beforeToolCall` / `afterToolCall` 拦截 delegation tool 做拒绝、改参或结果 patch。
- stream 会经过转换层映射到 AI SDK UI stream，而不是把内部事件直接混入 UI message。
- 大型 tool result 可以被 summary processor 压缩和缓存，避免后续上下文被工具输出撑爆；graph dependency prompt 已在截断时优先使用模型 summary processor。

对 Etyon 的启发：tool 实现不能继续向单一外部工具列表漂移；短工具名可以保留为 model-facing alias，但底层应逐步收敛成 Etyon Workspace + ToolRegistry + policy config。multi-agent 首版应采用 agent-as-tool，而不是让多个模型共享同一上下文并自由互调。子 agent 输出应拆成 “父模型可见摘要” 与 “UI / audit 可见完整 trace”。

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

参考 `agentLoop`（`packages/agent/src/agent-loop.ts`）是独立于 harness 的底层循环引擎。Etyon 当前已落地自研 `runAgentLoop()` outer loop；AI SDK 仍负责 provider streaming 与 tool schema 暴露，Etyon loop 负责 tool execute、approval suspend / resume、event settlement、tool-level retry 和 UI projection。

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

Etyon 当前已切到自研 loop；后续剩余差距主要是更完整的 compaction / branch summary / replay phase，而不是 tool loop 控制权本身。

### `AgentRuntime`

每次 chat 生成都创建一个 run：

- 解析 session、settings、model、mentions、skills。
- 构建 turn state。
- 选择 active profile 和 active tools。
- 调用 Etyon `runAgentLoop()`，由 AI SDK stream adapter 负责 provider 交互。
- 通过 loop `beforeToolCall` / `afterToolCall` 处理 approval、tool lifecycle 与 tool error。
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

参考 `AgentHarness` 使用显式 phase 限制并发操作。Etyon 目标吸收以下模型：

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
- stream options 中 `headers` 和 `metadata` 结构化 clone 并递归冻结。
- provider 凭证（API key）在每次 provider request 时重新获取（支持 token 刷新）。

#### Settlement / `waitForIdle`

- `waitForIdle()` 阻塞直到当前结构操作完成、listener 结束、pending session writes flush。
- event hook 失败不回滚已 commit 状态变更，但 public method reject 为 `AgentRuntimeError("hook")`；state subscriber 失败只参与 settlement，不打断 turn。

### `ToolCallEngineering`

参考 tool call 工程化程度显著高于 Etyon 首版。Etyon 目标逐步吸收以下能力。

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
- hook 抛异常时转成 error tool result，不 abort 整个 batch。

#### Parallel vs Sequential

- tool 声明 `executionMode: "parallel" | "sequential"`；混合 batch 中只要有一个 sequential 就退化全部为串行。
- 首版 AI SDK loop 全部由 SDK 调度并行；自研 loop 后需自行实现此语义。

#### Tool Result Budget 与大输出处理

每个 tool 的 `execute` 返回值经过统一截断：

- 文本截断到 `AGENT_TOOL_OUTPUT_MAX_CHARS`（当前 12000）。
- 完整输出写入 temp artifact（event payload ref）。
- 截断时在 model 返回中标注 `[truncated, full output saved to ...]`。
- 参考实现通过 `executeShellWithCapture` + `sanitizeBinaryOutput` 实现大输出落盘 + 二进制清理。

### `SessionTree`

参考 session 是以 append-only 树结构持久化的核心数据模型。Etyon 当前用 `chat_messages`（UIMessage 快照）+ `agent_events`（旁路日志），后续目标吸收以下设计。

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

Etyon 首版已经具备 in-memory session tree，并通过 `agent_events`、main RPC 与 Agent Workbench 提供 snapshot、leaf move 和 compaction summary 写入；event store 已支持从 event log 重建 provider request / response model context、queued steering / follow-up 与 branch lifecycle，用于 replay、approval resume 和 harness-operator 诊断。后续如需要跨版本审计或更长窗口 replay，再评估是否需要 dedicated session log。

### `CompactionEngine`

参考 compaction 是 harness 内建的上下文压缩引擎。Etyon 当前走 `chat-session-memory.ts` + `settings.chat.autoCompact`（chat 层），agent 层目标吸收以下设计。

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

Etyon 错误处理目标分两层：底层 `Result<T, E>` 不抛异常；高层 `AgentRuntimeError` typed throw。

#### 底层：Result 模式

`ExecutionEnv.fileSystem` 已开始落地此边界；后续还需要把更多文件操作和 tool-registry 迁移到同一 Result 层。目标形态为 `ExecutionEnv`、compaction helper、文件操作等底层模块返回 `Result<TValue, TError>`：

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
- `afterToolCall` 抛错 → 转成 error tool result，不 abort 其他工具。
- tool 执行失败 → `isError: true` 的 tool result，loop 继续下一 turn（模型可读错误并调整）。
- provider 请求失败 → `stopReason: "error"`，emit `agent_run_failed`，harness 可通过 retry phase 重试。
- event hook listener 失败 → 不回滚已 commit 状态，public method reject 为 `AgentRuntimeError("hook")`；state subscriber 失败 → settlement 后吞掉。

### `StreamEngineering`

参考 stream 层在 provider request 前后有完整 hook 链。Etyon 首版无此能力，目标吸收以下设计。

#### Stream Options 快照

每轮 turn 的 `createTurnState()` 结构化 clone 当前 stream options（`headers`、`metadata` 等）并递归冻结，provider 请求用快照而非 live config。Turn 进行中修改 stream options 不影响在途请求。

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

参考 `packages/agent/src/harness/skills.ts` 和 `prompt-templates.ts` 提供了结构化的 skill / prompt 模板加载。Etyon 目标吸收以下设计。

#### Skill 加载

- 从 `SKILL.md` 文件加载，支持 frontmatter（name、description、visible 等）。
- 支持 symlink 目录。
- `loadSkills(dirs, env)` 遍历目录，每个子目录的 `SKILL.md` 解析为一个 `Skill`。
- `loadSourcedSkills(skillSources, env)` 支持 `source` 元数据（project / user / git 来源）。
- model-disabled skill 不进 system prompt 但仍可被引用。

#### Prompt Template 加载

- 从 `.md` 文件加载，支持 `$1`、`$2` 位置参数替换，以及 `$ARGUMENTS` 全量参数替换。
- `loadPromptTemplates(dirs, env)` 非递归遍历（只读根目录 `.md`）。
- `listSkillPromptTemplates(projectPaths)` 从可见 skill 目录的 `prompts/*.md` 加载模板，并通过 `skills.listPromptTemplates` RPC 提供给 chat composer `/prompt` suggestion。
- `formatPromptTemplateInvocation(template, args)` 做参数替换和输出格式化。
- `parseCommandArgs(text)` 解析 shell 风格参数（支持引号）。

#### System Prompt 格式化

- `formatSkillsForSystemPrompt(skills)` 生成 XML 格式的 skill 列表，注入 system prompt。
- `formatSkillInvocation(skill, additionalInstructions?)` 生成 direct skill invocation XML，并保留 skill 目录作为 `reference_root`。
- 字段需要 XML 转义。
- model-invisible skill 被跳过。

Etyon 当前 skill 作为 system prompt 文本注入（`context-builder` 步骤 5）。结构化加载可在 P5 阶段引入。

### `ToolRegistry`

集中注册、过滤和格式化 tools：

- 默认 code-agent tools：`read`、`grep`、`find`、`ls`、`stat`、`bash`、`processOutput`、`stopProcess`、`mkdir`、`delete`、`edit`、`smartEdit`、`write`。这些是 model-facing alias，registry / workspace 边界落在 Etyon 的 `view`、`search_content`、`find_files`、`file_stat`、`execute_command`、`process_output`、`stop_process`、`mkdir`、`delete_file`、`string_replace_lsp`、`ast_smart_edit`、`write_file` 分层。
- 内部兼容 / harness tools：`readFile`、`searchFiles`、`findFiles`、`fileInfo`、`listDirectory`、`listProjectTree`、`gitDiff`、`memorySearch`、`rtkCommand`、`runCheck`、`applyPatch`、`editFile`、`writeFile`、`webSearch`、`webExtract`。
- 子 agent tools：`agentExplore`、`agentPlan`、`agentReview`、`agentCoder` 等。
- 后续扩展 tools：project snapshot search、browser、MCP、workflow。

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

Etyon 将 `ExecutionEnv` 拆成 `FileSystem`、`Shell` 和 `BackgroundProcesses` 三个接口，底层操作返回 `Result<T, Error>` 而非抛异常。

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

interface ShellOutputEvent {
  channel: "stdout" | "stderr"
  chunk: string
  sequence: number
}

interface ShellExecOptions {
  abortSignal?: AbortSignal
  cwd?: string
  env?: Record<string, string>
  onOutput?: (event: ShellOutputEvent) => void
  onStderr?: (chunk: string) => void
  onStdout?: (chunk: string) => void
  timeout?: number
}

interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number
}
```

#### BackgroundProcesses 接口

```ts
interface BackgroundProcesses {
  start(
    command: string,
    options?: BackgroundProcessStartOptions
  ): Promise<Result<BackgroundProcessSnapshot, ExecutionError>>
  list(): BackgroundProcessSnapshot[]
  get(processId: string): BackgroundProcessSnapshot | null
  stop(
    processId: string
  ): Promise<Result<BackgroundProcessSnapshot, ExecutionError>>
  cleanup(): Promise<void>
}
```

#### 错误类型

- `FileError`：`{ code: "not_found" | "permission" | "is_directory" | "aborted" | "unknown"; message: string }`
- `ExecutionError`：`{ code: "timeout" | "aborted" | "spawn" | "process-not-found" | "unknown"; message: string; exitCode?: number; stdout?: string; stderr?: string }`

#### 实现要点

- `NodeExecutionEnv` 基于 `node:fs/promises` + `child_process.spawn`（bash/sh）。
- pre-aborted 的 AbortSignal 会直接返回 `aborted` result，不启动实际操作。
- 大输出通过 `executeShellWithCapture` 落盘到 temp file，`sanitizeBinaryOutput` 清理非 UTF-8 字节。
- `ExecutionEnv.fileSystem` 的路径 helper、exists、读写、分行/二进制读取、mkdir、remove、`fileInfo`、`listDir` 已返回 `Result<T, FileError>`。
- `ExecutionEnv.shell.exec()` 已返回 `Result<ShellResult, ExecutionError>`；普通非 0 exit code 保留为成功 ShellResult，pre-aborted、timeout、spawn error 才进入错误分支；错误分支会保留已捕获的 stdout / stderr，避免 timeout 或 abort 丢掉已产生的诊断输出；`onOutput` 会按 decoded chunk 发出 channel + sequence，供后续 UI streaming / event store 消费。
- `ExecutionEnv.backgroundProcesses` 已返回 `Result<BackgroundProcessSnapshot, ExecutionError>`；start 会先经 `WorkspaceSandbox.prepareShellCommand()`，list / get 返回 bounded stdout / stderr preview，stop / cleanup 会终止进程组并执行 sandbox spawn cleanup。`AgentWorkspace.operations` 已承接 `startProcess`、`getProcess`、`recoverProcess`、`stopProcess`，model-facing 层通过 `bash background=true`、`processOutput`、`stopProcess` 暴露当前 workspace 内的 background process 控制，并把 `background_process_started` / `background_process_output` / `background_process_finished` 写入现有 append-only `agent_events`；`AgentWorkspace` 按 `projectPath + chatSessionId` 复用 registry，支持同一 chat 的跨 turn process 访问；registry miss 时会按当前 chat session 恢复 bounded output 和 pid handle。
- `fileInfo` 已按 Etyon 边界不 follow symlink，返回 `isSymlink: true`；`AgentWorkspace.operations` 已承接 `fileStat`、`listDir`、`readTextFile`、`view`、`mkdir`、`deleteFile`、`writeFile`、`searchContent`、`findFiles`、`executeCommand` 等操作，tool-registry 的 `fileInfo`、`listDirectory`、`readFile`、`editFile`、`writeFile`、`stat`、`mkdir`、`delete`、`smartEdit`、`bash`、`grep`、`find`、`searchFiles`、`applyPatch`、`runCheck`、`rtkCommand` 已改为消费 workspace substrate 或 `ExecutionEnv.shell.exec()` typed Result，并拒绝通过目标 symlink 读写真实文件。
- `AgentWorkspace.operations.writeFile` 已支持 optional `expectedMtimeMs` 和 `requireReadSnapshot`；exact replacement `edit` / `editFile` 与 AST `smartEdit` 会把读取时的 mtime 传入写回步骤，model-facing `write` 覆盖已有文件前要求同一 workspace 已读当前快照，文件在读写之间被外部修改时 fail closed 为 `stale-write`。
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
- 如果子 agent 需要高风险操作，必须返回 `needs_parent_approval`；runtime 会把该 marker 提升成 delegation output、`subagent_finished` event 和 extension `delegation_finished` lifecycle event 的结构化 status，父 run 可继续触发 `requestAccess` / approval。
- 子 agent 不共享父 agent 的完整消息历史，只接收必要任务说明、选中文件、摘要和预算。
- 子 agent run 可独立失败；`failed` / `rejected` delegation output 会转成父 agent 可读的 tool error，并保留 `subRunId` / `profileId` / `summary` 等结构化字段，不直接终止父 run，除非 profile 指定 `failFast`。

### `AgentUIAdapter`

Renderer 不应理解底层 harness event 的全部细节。建议加一个 UI adapter：

- AI SDK `UIMessage` 继续驱动 chat bubble。
- tool part 渲染由 `part.type === "tool-<toolName>"` 分发。
- approval part 展示确认 / 拒绝按钮，并调用 `addToolApprovalResponse()`。
- sub-agent trace 通过 `subRunId` 懒加载 `agent_events`，避免把完整 trace 塞进 assistant message。
- 大输出默认展示 preview，提供 “展开” 或 “查看完整输出”。

## Agent 预设

内建预设先满足常见本地开发任务。`general-purpose` 是默认 profile；其他 profile 可以通过 chat toolbar 或 `@` / `$` 后续入口选择。

| Profile            | 用途                | 默认工具                                                                                                                      | 委派 | 写入     | 审批策略                |
| ------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---- | -------- | ----------------------- |
| `general-purpose`  | 默认对话和轻量分析  | `read`、`grep`、`find`、`ls`、`stat`                                                                                          | 否   | 否       | 只读自动执行            |
| `explore`          | 代码库探索和定位    | `read`、`grep`、`find`、`ls`、`stat`                                                                                          | 否   | 否       | 只读自动执行            |
| `plan`             | 方案设计和任务拆解  | `read`、`grep`、`find`、`ls`、`stat`、`agentExplore`、`agentCoder`                                                            | 是   | 通过委派 | `agentCoder` 需要审批   |
| `coder`            | 小范围实现和修复    | `read`、`grep`、`find`、`ls`、`stat`、`bash`、`processOutput`、`stopProcess`、`mkdir`、`delete`、`edit`、`smartEdit`、`write` | 是   | 是       | 写入 / 泛用命令需要审批 |
| `review`           | 代码审查和风险定位  | `read`、`grep`、`find`、`ls`、`stat`                                                                                          | 可选 | 否       | 只读自动执行            |
| `harness-operator` | 调试 agent run 本身 | `agentEventsSearch`、`agentRunInspect`                                                                                        | 否   | 否       | 只读自动执行            |

说明：

- `coder` 可以暴露 `bash` alias（对应 Etyon workspace `execute_command` 形态），但泛用命令必须走 approval；bounded verification 命令仍由 permission engine 判定是否自动允许。
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
- `read` 支持 line range 和最大字符数，内部兼容 `readFile` 复用同一预算。
- `grep` 默认限制 match 数、每条上下文行数和总字符数，内部兼容 `searchFiles` 复用同一预算。
- `find` / `ls` 按路径名 query 查找并支持 cwd / limit；`stat` 返回 path kind、size、mtime、language、symlink 状态；内部兼容 `findFiles` / `fileInfo` / `listDirectory` 复用同一预算，并过滤 secret-like 条目。
- `bash` / 内部 verification tools 会分别截断 stdout、stderr，并记录完整输出引用。
- 对大型结果生成 deterministic summary，并在 graph dependency prompt 中接入模型 summary processor。

父 agent 看到的是 “足够继续推理的摘要”，UI 和 event store 保存 “足够审计的细节”。

## 当前设置结构

`packages/rpc/src/schemas/settings.ts` 已提供 `settings.agents`，旧 settings 会自动补齐默认值：

```ts
const AgentSettingsSchema = z.object({
  allowSubagentDelegation: z.boolean().default(false),
  approvals: z
    .object({
      approvalTtlMs: z.number().int().min(60_000).default(7 * 24 * 60 * 60 * 1000),
      commandAllowlist: z.array(AgentCommandApprovalRuleSchema).default([])
    })
    .default(...),
  defaultProfileId: z.string().default("general-purpose"),
  enabled: z.boolean().default(false),
  lsp: AgentLspSettingsSchema.default(...),
  maxConcurrentSubagents: z.number().int().min(1).max(4).default(2),
  maxSteps: z.number().int().min(1).max(20).default(8),
  profiles: z.array(AgentProfileSchema).default([]),
  retry: AgentRetrySettingsSchema.default(...),
  sandbox: AgentSandboxSettingsSchema.default(...),
  showToolTraces: z.boolean().default(true)
})
```

默认 `enabled = false`，保证现有 chat 行为不变。Settings 已有独立 `Agents` tab；approval TTL 目前先作为 schema / recovery 行为存在，UI 可后续补控制项。

`requireApprovalForWrites` 如果已经进入持久化 schema，只能作为向后兼容字段保留，不应再作为权限来源或 Settings 可关闭项。写文件、改文件、`applyPatch`、网络查询和泛用本地命令必须以 `permission-engine` + AI SDK approval message 为准；直接调用 executor 时也必须携带同一次 tool call 的 approved response。

## 分阶段落地

### P0：文档与 schema 预留

- 新增本设计文档。
- 在 settings schema 中预留 `agents`。
- 定义内建 `AgentProfile` 常量和类型。
- 不改变默认 chat 行为。

### P1：单 agent tool loop

- 在 `/api/chat` 内引入 `tools` 和 `stopWhen: stepCountIs(8)`。
- 首批内建 profile 只启用 Etyon 只读 alias：`read`、`grep`、`find`、`ls`、`stat`；旧 `searchFiles`、`findFiles`、`fileInfo`、`listDirectory`、`readFile`、`listProjectTree`、`gitDiff` 仅保留为内部兼容 / harness surface。
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
- 子 agent 内部禁用 approval tools；需要审批时用 `needs_parent_approval` 向父 run 冒泡。
- 子 agent 失败或委派被拒绝时，父级 delegation tool call 以 `isError=true` 写回模型，同时保留结构化 output 和 child trace。
- 支持最多 `2` 个并发子 agent 和最大深度 `1`。

### P5：高级 Harness Engineering

- 主 chat 已用自研 `AgentLoop`（见架构分层 §AgentLoop）替换 SDK 内部 tool loop，获得 `beforeToolCall` 阻断、`afterToolCall` terminate、steering/follow-up、`prepareNextTurn` 等细粒度控制。
- 后续评估是否进一步用 `createAgentUIStreamResponse()` 减少自定义 UI stream 投影代码。
- 引入 append-only branchable session log（见 §SessionTree），而不是只依赖 `chat_messages` 快照。
- 引入 `AgentRuntime` Phase 状态机（见 §AgentRuntime.Phase）。
- 引入 `ErrorHandling` 分层（见 §ErrorHandling）：底层 `Result<T,E>`、高层 `AgentRuntimeError`。
- 扩展 tool result summary cache（持久化、UI 使用；模型 summary processor 已接入 graph dependency prompt）。
- 增加 compaction summary、branch summary 和 run replay（见 §CompactionEngine）。
- 引入 stream hook 链（见 §StreamEngineering）。
- 引入 prompt template 加载和格式化（见 §SkillAndPromptTemplate）。
- 引入 plan/execute 工程（见 §Plan/Execute 工程详设）。
- 引入 durable approval 恢复流程（见 §Durable Execution）。
- 评估 `DirectChatTransport` 用于测试、CLI 或单进程场景，而不是替换默认 renderer transport。

## 非目标

首版明确不做：

- 不替换当前 Hono `/api/chat` transport。
- 不暴露无需审批的 unrestricted bash。
- 不让 skills 自动变成可执行 tools；skills 仍先作为 instruction / context。
- 不在默认 code-agent profile 启用 web / network tools；selected skill 声明 `network` capability 时可暴露 `webSearch` / `webExtract`，但必须走 approval，且 `includeApprovalTools=false` 的只读 / plan-like scope 不会暴露它们。
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

Agents 能力的风险不在单个函数，而在 “模型流式输出 -> tool call -> 权限 / 审批 -> tool result -> 下一步模型输入 -> UI message / event store” 这条链路。因此测试要借鉴成熟 runtime 的覆盖方式，先做确定性 harness 测试，再补 UI 和集成测试。

### 可借鉴的测试形态

参考 harness 的测试用例值得借鉴这些方向：

- `agent-loop.test.ts`：用 mock assistant stream 驱动两轮模型响应，断言 tool 被执行、tool result 回到下一轮上下文、事件顺序正确。
- `agent-loop.test.ts`：覆盖 parallel tool call 的执行完成顺序与 tool result 回放顺序分离，避免并发工具导致上下文顺序漂移。
- `agent-loop.test.ts`：覆盖 queued steering message 必须等当前 assistant 的全部 tool calls 完成后再注入。
- `harness/agent-harness-stream.test.ts`：覆盖 provider request hook、stream options patch、headers / metadata 合并和删除语义。
- `harness/session.test.ts`：覆盖 append-only session、branch、leaf move、compaction summary 和自定义 message entry 的上下文重建。
- `harness/nodejs-env.test.ts`：覆盖 `ExecutionEnv` 的文件读写、symlink、abort、timeout、stdout / stderr streaming 与错误标准化。
- `coding-agent/test/agent-session-runtime-events.test.ts`：覆盖 session / runtime lifecycle event，确保切换、fork、shutdown、start 这些事件可取消、顺序稳定。

Workspace / HITL 参考测试用例值得借鉴这些方向：

- `tool-call-step.test.ts`：覆盖 approval required 时先 enqueue approval、suspend，不执行工具；approve 后执行；deny 后返回明确 result。
- `tool-builder/builder.test.ts`：覆盖 `requireApproval` 为 boolean 和 function 两种形态，function 要被保留成 `needsApprovalFn`。
- `harness/subagent-tool.test.ts`：覆盖 sub-agent 不把内部 metadata 注入 model-facing content，metadata 只能走结构化 event / output。
- `harness/subagent-tool.test.ts`：覆盖 sub-agent request context 是父 context 的 copy，并清理父 thread / resource id。
- `agent/__tests__/supervisor-integration.test.ts`：覆盖父 agent tool call / tool result 不泄漏到子 agent 模型上下文。
- `client-sdks/react/.../toUIMessage.test.ts`：覆盖 sub-agent `childMessages`、`subAgentThreadId`、nested tool results 在 UI message 转换中不丢失。
- `server/handlers/responses.test.ts`：覆盖 streaming tool call delta、late canonical tool call、zero-argument tool call 和 tool result 对齐。
- `workspace/tools/__tests__/*`：覆盖 read / grep / list / write / execute-command 这类 workspace tools 的路径、权限和输出边界。

### Etyon 首批测试矩阵

「参考形态」列指向本地参考 harness 测试或 workspace / HITL 文档中提到的同类用例。「状态」反映当前仓库是否已有对应测试文件并通过基本覆盖。

| 层级               | 目标                                                                                                                                                                                                     | 建议文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 参考形态                                    | 状态                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| profile / settings | `settings.agents.enabled = false` 默认不改变 chat；profile id、工具策略、预算默认值稳定                                                                                                                  | `packages/rpc/test/schemas/settings.test.ts`、`apps/desktop/test/main/agents/profiles.test.ts`、`apps/desktop/test/main/agents/tool-registry.test.ts`、`apps/desktop/test/main/server/app.test.ts`                                                                                                                                                                                                                                                                                                    | —                                           | **已落地**（settings schema 覆盖 legacy 默认补齐、disabled agents 默认值、sandbox / LSP / retry 默认值和 partial update；profiles 覆盖 built-in id 顺序、settings 默认 profile / maxSteps 绑定、默认 profile 只读工具面、coder / review / explore LSP alias 边界和 readonly override；tool registry 覆盖 agents disabled 时不暴露工具、默认 profile 只读 alias、`inspect` / `symbolSearch` / `symbols` 只在 sandbox + LSP 同时开启时暴露；真实 `/api/chat` route 覆盖 agents disabled 不注入 tools / stopWhen，enabled 时注入 Etyon tools / step budget）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| tool registry      | profile 只暴露允许工具；tool name 标准化；重复名称报错；子 agent tools 只在 delegation 开启时出现                                                                                                        | `apps/desktop/test/main/agents/tool-registry.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                 | workspace tools 边界                        | **已落地**（包含 approval predicate 异常 fail closed）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| permission engine  | `allow` / `ask` / `deny` 优先级；secret 文件、破坏性命令、跨 workspace 路径、网络命令判断                                                                                                                | `apps/desktop/test/main/agents/permission-engine.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                             | —（Etyon 独有层）                           | **已落地**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| execution env      | workspace 路径规范化、symlink 处理、abort、timeout、stdout / stderr 截断、完整输出引用                                                                                                                   | `apps/desktop/test/main/agents/execution-env.test.ts`、`apps/desktop/test/main/agents/workspace-sandbox.test.ts`、`apps/desktop/test/main/agents/command-tools.test.ts`、`apps/desktop/test/main/agents/tool-registry.test.ts`                                                                                                                                                                                                                                                                        | `harness/nodejs-env.test.ts`                | 部分（cwd、symlink、abort、timeout、输出 artifact、binary output 清理、跨 chunk UTF-8 保留、structured shell output event、timeout partial output、Result 风格路径 helper、exists、读写、分行/二进制读取、mkdir、remove、temp / cleanup、`fileInfo` / `listDir`、`shell.exec()` typed error、background process start / list / get / stop / cleanup、model-facing process output / stop / `stat` / `mkdir` / `delete`、sandbox fail closed、sandbox disabled 才允许 unsandboxed、sandbox cwd 越界拒绝、network allow / deny 边界、secret env scrub 已覆盖）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| tool execution     | `readFile` range、`searchFiles` 预算、`findFiles` 路径查询、`fileInfo` 元数据、`listDirectory` 目录列举、`gitDiff` 路径过滤、`memorySearch` scope 过滤、`runCheck` 输出归一化、`applyPatch` 审批前不写入 | `apps/desktop/test/main/agents/tools/*.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                       | workspace tools                             | 部分（合并在 tool-registry；`readFile` range、`searchFiles` 内容搜索与 shell adapter、`grep` / `find` / `searchFiles` 复用 workspace sandbox spawn 边界、`findFiles` cwd 过滤、`fileInfo` 常规文件与 symlink no-follow、`listDirectory` secret 条目过滤、目标 symlink no-follow、`memorySearch` 真实 DB retrieval 与 project scope、`applyPatch` secret target 拒绝与 shell adapter、`runCheck` / `rtkCommand` typed Result adapter、`gitDiff paths`、secret path 过滤与 `writeFile` symlink 父级边界已覆盖）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| agent runtime      | mock model 第一次返回 tool call，第二次返回 final text；断言 tool result 进入下一步输入，事件顺序稳定                                                                                                    | `apps/desktop/test/main/agents/agent-loop.test.ts`、`apps/desktop/test/main/agents/agent-loop-ai-sdk.test.ts`、`apps/desktop/test/main/agents/agent-retry-policy.test.ts`、`apps/desktop/test/main/agents/agent-runtime.test.ts`、`apps/desktop/test/main/agents/agent-runtime-harness.test.ts`                                                                                                                                                                                                       | `agent-loop.test.ts`                        | 部分（独立 `agent-loop.ts` 已覆盖两轮写回、事件顺序、parallel source-order 写回、mixed sequential batch、active tool allowlist、sequential abort settlement、in-flight parallel tool abort settlement、model / tool abort signal、resources deep clone 隔离、steering、follow-up、`prepareNextTurn` 替换 messages / model / resources / thinking level / active tools / tools、`beforeToolCall` / `afterToolCall`、hook settlement、tool error continuation、tool-level retry，以及 provider stream adapter / tool input delta 聚合 / provider-completed tool result passthrough / provider tool error / denied output 转换 / cancellation；`agent-retry-policy.test.ts` 覆盖 automatic retry 只允许 safe / idempotent tool，write / shell 不会因 timeout 自动重试；runtime harness 已用 faux provider 覆盖主 stream 的 agents disabled 无 run / events、agents enabled default profile run / tools、真实 tool call lifecycle row、带 `outputRef` 的 tool output 写入 UI preview / artifact catalog / `tool_call_finished.artifactIds`、streamed tool input delta 执行真实 `read` tool、provider-completed tool result 写入 UI stream / model context / tool lifecycle 且不触发本地执行、invalid provider tool call 写入 UI error / failed tool lifecycle / model-visible tool result、run abort signal、request abort detachment、HTTP stream disconnect event、active run UI snapshot event、重新读取 session 时的 running projection、`agents.listUiStreamSnapshots` cursor RPC、renderer 自动重连订阅 helper、explicit active-run stop、turn phase、step budget、active tool 过滤与 skill capability supplemental 工具绑定、主 `agent_loop_event` 写入、AI SDK provider 只暴露 schema 不自动执行 tool、active run queued follow-up / steering 自动进入 self-managed loop，以及 parent stream tool call 触发 child Etyon `Agent` run 后回到父流的 delegation 闭环；主 `streamAgentChat` 已用 Etyon loop 生成 UI stream / agent events；Workbench helper / panel 已覆盖 retry strategy preview；Settings 已提供自动重试开关与次数入口，run graph 级 retry policy 已可按 root run 持久覆盖）                                                                                                                                                                                                                       |
| agent kernel       | run graph template 可被 kernel 编译为 deterministic schedule；每个 node 有 profile、tool scope、active tools、stage、attempt、上次输出和失败状态                                                         | `apps/desktop/test/main/agents/agent-kernel.test.ts`、`apps/desktop/test/main/agents/agent-loop-ai-sdk.test.ts`、`apps/desktop/test/main/agents/agent-run-graph-templates.test.ts`、`apps/desktop/test/main/rpc/index.test.ts`、`apps/desktop/test/renderer/lib/chat/agent-workbench.test.ts`、`apps/desktop/test/renderer/components/chat/agent-workbench-panel.test.ts`                                                                                                                             | workflow / supervisor 形态                  | 部分（已覆盖内建 template 稳定列表、`plan-execute-review` 的拓扑 stage、parallel explore siblings、read-only / approval-gated active tools、unknown template 拒绝、message-port RPC 的 template list / preview plan，instantiate 会创建顶层 run 并写入 `agent_run_graph_instantiated` event，`startRunGraphNextStage` 会避免重复启动 running stage 并启动下一批 ready child runs，child run 会按 profile `preferredModel` / 用户 model / fallback route 记录 `modelRoute`，AI SDK graph node 的 provider 错误会按 fallback chain 切换模型并写入 `agent_model_fallback_used`；`advanceRunGraph` 会从 child run terminal status 回写 node succeeded / failed、输出和错误并自动推进下一 stage，kernel 会写 `agent_run_graph_checkpoint_created` checkpoint，后续节点 prompt 会带入依赖节点输出，dependency summary cache 会避免 sibling 节点重复总结同一大型依赖输出并写 `agent_tool_result_summary_cached`；`agents.retryRunGraphNode` 可对 failed node 新建 attempt，read-only / safe / idempotent 节点的 provider / timeout 瞬态失败会按 `settings.agents.retry` 自动 retry，写入 / shell / network 节点等待手动 retry；`executeRunGraphNode()` 会用 mock `AgentLoopModel` 执行 running graph node、写 child loop events、更新 child run status 并继续推进 graph；`agent-loop-ai-sdk.test.ts` 覆盖 provider 只消费 tool schema、不自动执行 tool，RPC harness 覆盖 running graph node 经 AI SDK provider 调用真实 `read` tool、写入 tool lifecycle 并推进 graph，也覆盖 approval-gated `write` tool suspend 后 approve resume、真实写入文件并继续启动后续 graph node；`agents.respondToRunGraphApproval` 已有 message-port RPC 回归，覆盖 Workbench 路径 approve 后恢复挂起 graph node 并真实写入文件；持久 artifact catalog、`inspectRun` artifact trace、`readArtifact` bounded content preview、`listRuns` session run graph、renderer Agent Workbench preview、stage / node / dependency graph panel、automatic / manual retry event preview、workspace diff preview、基础 create / start / execute / advance / retry / skip / approval 操作入口、Workbench UI 决策 helper 和 Workbench panel SSR render 已覆盖；已新增 run graph until idle 自动推进 RPC 与 Workbench 入口，并让 Workbench approval response 默认 continue-until-idle；failed node 的 retry / skip 决策入口与 per-run retry policy 覆盖已接入） |
| session tree       | append-only message / leaf / branch summary / compaction summary / custom message entry 可重建 model context，并拒绝非法 branch target                                                                   | `apps/desktop/test/main/agents/agent-session-tree.test.ts`、`apps/desktop/test/main/agents/agent-session-events.test.ts`、`apps/desktop/test/main/agents/approval-execution.test.ts`、`apps/desktop/test/main/agents/agent-runtime-harness.test.ts`、`apps/desktop/test/main/agents/agent-event-store.test.ts`、`apps/desktop/test/main/rpc/index.test.ts`、`apps/desktop/test/renderer/lib/chat/agent-workbench.test.ts`、`apps/desktop/test/renderer/components/chat/agent-workbench-panel.test.ts` | `harness/session.test.ts`                   | 部分（已有 in-memory context rebuild，session entry event 可持久化并重建 provider context，approval resume 可重建真实 provider context、replay pending queued steering 并只追加缺失消息，assistant / tool response messages 已投影；stateful `Agent` session-bound 工厂已覆盖 queued write callback 持久化、pending queue replay 和 turn model messages 写回；主 chat runtime 已通过 `Agent` facade 驱动 provider loop，并复用 shared binding helper；runtime harness 可列出真实 stream 后写入的 user / assistant / tool model messages；message-port RPC 已覆盖 inspect / leaf move / compaction summary 与跨 session run 拒绝；Agent Workbench 已覆盖 session snapshot、leaf move 和 compaction 控件；chat 完成持久化已用 event stream 重建 assistant suffix；fork / regenerate 已写入 `chat-branch`，读取修复也会按 retained message IDs 截断旧分支 suffix；branch leaf 移动、regenerate action 与 Workbench 分支 entry 已接到同一生命周期入口）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| turn state         | 每轮请求创建只读快照；运行中 settings / tools 变更不影响在途请求；system prompt provider 只执行一次；provider credentials 每请求重取                                                                     | `apps/desktop/test/main/agents/agent-turn-state.test.ts`、`apps/desktop/test/main/agents/stream-options.test.ts`、`apps/desktop/test/main/agents/agent-runtime.test.ts`、`apps/desktop/test/main/agents/agent-runtime-harness.test.ts`                                                                                                                                                                                                                                                                | `harness/agent-harness-stream.test.ts`      | 部分（已覆盖 messages 深层快照隔离、tools 顶层快照冻结、stream options 结构化深快照和递归冻结、system prompt provider 单次解析、provider credentials resolver 不进入快照内容；`stream-options.test.ts` 已覆盖 stream options 快照在 provider request / payload hook 链前固定，并验证 hook 后 headers 进入真实 provider request、metadata 被后续 payload hook 消费；runtime harness 已验证主 `streamAgentChat()` provider request 会消费 turn snapshot 后的 hooked system / messages / headers，并把该快照输入交给 self-managed loop；stateful `Agent` 已补原子 `setSettings()` 并覆盖下一 turn 生效与清空 active tools / resources / thinking level；fork / regenerate 已写入 `chat-branch`，读取修复也会按 retained message IDs 截断旧分支 suffix；branch leaf 移动、regenerate action 与 Workbench 分支 entry 已接到同一 UI / RPC 生命周期）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| stream hooks       | provider request / payload / response hook 可顺序 patch，并把 hook failure 包装为 typed runtime error                                                                                                    | `apps/desktop/test/main/agents/stream-options.test.ts`、`apps/desktop/test/main/agents/agent-stream-hooks.test.ts`、`apps/desktop/test/main/agents/agent-extensions.test.ts`、`apps/desktop/test/main/agents/agent-runtime.test.ts`、`apps/desktop/test/main/agents/agent-runtime-harness.test.ts`、`apps/desktop/test/main/agents/agent-loop.test.ts`、`apps/desktop/test/main/agents/agent-loop-ai-sdk.test.ts`                                                                                     | `harness/agent-harness-stream.test.ts`      | 部分（已覆盖 headers / metadata merge-delete、payload patch、response hook、hook 合并、hook 输入 payload / request options / response 嵌套对象隔离与 `AgentRuntimeError("hook")`；`stream-options.test.ts` 已覆盖 provider request hooks 按序读取前一 hook 的 patch 结果、payload hook 消费最终 request options，以及 runtime provider request 接收 patch 后 headers；extension runner 已覆盖 stream hook 注册、profile / selected skill capability 过滤和合并；runtime harness 已用真实 faux provider 覆盖主 provider request / payload / response hook、prepared message 持久化、hook 失败 run settlement、extension stream hook 注入，以及 delegated child provider request / payload / response hook；主 `streamAgentChat()` provider stream 和子 agent Etyon `Agent` loop 路径已接入 request / payload / response hook；self-managed loop 已有 provider stream adapter、tool input delta 聚合与 cancellation，主 chat stream 已接入该 adapter；stateful `Agent` 已补 `setSettings()`、loop hook passthrough 和外部 queue drain；chat 完成持久化已接入 event-derived assistant suffix projection，fork / regenerate 已写入 `chat-branch`，读取修复也会按 retained message IDs 截断旧分支 suffix；branch leaf 移动、regenerate action 与 Workbench 分支 entry 已接到同一生命周期入口）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| error handling     | 底层 Result 不抛异常；高层 runtime 抛 typed error 并保留 cause                                                                                                                                           | `apps/desktop/test/main/agents/agent-errors.test.ts`、`apps/desktop/test/main/agents/agent.test.ts`、`apps/desktop/test/main/agents/execution-env.test.ts`、`apps/desktop/test/main/agents/agent-runtime.test.ts`、`apps/desktop/test/main/agents/agent-runtime-harness.test.ts`                                                                                                                                                                                                                      | `harness/types.ts`                          | 部分（已覆盖共享 `AgentRuntimeError` code / cause、`ExecutionEnv` typed Result、主 provider request hook 失败时的 failed run settlement，以及 provider stream 创建失败的 typed reject；hook 失败 settlement、真实 provider stream 消费期错误 settlement 与 tool lifecycle 失败时 `AgentRuntimeError("tool")` 记录均已由 runtime harness 覆盖 run / event store；session tree / event replay 非法 leaf move 已覆盖 typed `AgentRuntimeError("session")`；stateful `Agent` `onEvent` listener 失败已覆盖 public method typed reject 为 `AgentRuntimeError("hook")` 并保留 cause）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| approval flow      | 需要审批时暂停，不执行工具；approve 后继续；deny 后给模型明确 tool error；approval state 可持久化                                                                                                        | `apps/desktop/test/main/agents/approval-execution.test.ts`、`apps/desktop/test/main/agents/agent-runtime-harness.test.ts`、`apps/desktop/test/main/agents/agent-event-store.test.ts`、`apps/desktop/test/main/agents/agent-chat-projection.test.ts`、`apps/desktop/test/main/rpc/index.test.ts`、`apps/desktop/test/renderer/lib/chat/agent-recovery.test.ts`                                                                                                                                         | HITL `tool-call-step`                       | 部分（runtime 已覆盖真实 provider step 触发 approval request 后 suspended run / pending approval / tool-call row / `agent_approvals` projection 持久化，suspend、resume、跨 session 边界、历史 approval response 过滤、resume profile tool scope、approve 后真实本地工具执行、多 pending approval 等待全响应、running 状态 pending resume、run-scoped approvalId、startup recovery 会保留未超期 suspended approval，并把超过 `approvalTtlMs` 的 run 标记为 `failed(reason="approval_timeout")`、resume provider context rebuild、pending queued steering replay 和 missing-only session append；`approval-execution.test.ts` 已用 runtime harness 覆盖 approve / deny 的真实本地工具执行边界、模型可见 denied tool error，以及 approved `agentCoder` execute handoff；`agent-chat-projection.test.ts` 已覆盖 persisted split approval request 和不带 `toolCallId` 的 denied response 会通过 `approvalId` 恢复为 UI `approval-requested` / `approval-responded`；failed 顶层 run 手动 retry 已有 recoverable runs RPC、chat route 入口与 helper 测试；run graph automatic retry 已进入 Workbench retry event preview，failed tool calls 已在 Workbench run details 中可见；tool-level transient retry 已进入 loop / main runtime / graph node 执行路径；Workbench helper / panel 已覆盖 retry strategy preview；Settings 已提供自动重试开关与次数入口，run graph 级 retry policy 已可按 root run 持久覆盖）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| event store        | `agent_runs`、`agent_events`、`agent_tool_calls`、`agent_approvals` 顺序号、parent run、tool call id、approval 状态、失败状态可重建                                                                      | `apps/desktop/test/main/agents/agent-event-store.test.ts`、`apps/desktop/test/main/rpc/index.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                 | `harness/session.test.ts`（持久化语义不同） | **已落地**（包含并发 event sequence、pending approval 查询、approval request / response projection、running / suspended pending approval 可见性、跨 session resume 边界、run-scoped provider tool call id、run-scoped approvalId、按 chat session / project 约束 run inspect，以及 message-port `agents.inspectRun` 只读 trace RPC）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| chat route         | `/api/chat` 在 agents 关闭时走旧路径；开启时注入 tools / stopWhen；`UIMessage` 持久化包含 tool parts                                                                                                     | `apps/desktop/test/main/server/app.test.ts`、`apps/desktop/test/main/agents/agent-chat-context.test.ts`                                                                                                                                                                                                                                                                                                                                                                                               | —                                           | **已落地**（chat request context helper 统一 memory / mentions / skills / extensions / prompt templates，并会在 provider 前补齐未完成 assistant tool call 的 synthetic `tool-result`；`app.test.ts` 已覆盖 Agents disabled 的真实 `/api/chat` route 仍走旧 provider path 且不注入 tools / stopWhen、普通 follow-up 会把补齐后的 model messages 传给 provider、Agents enabled 的真实 `/api/chat` route 会注入 Etyon read-only tool aliases / step budget，以及 provider stream 发出 `read` tool call 后真实执行工具并把 `tool-read` output-available part 持久化到 `replaceChatMessages()`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| renderer UI        | tool part 的 `input-streaming`、`approval-requested`、`output-available`、`output-error` 状态渲染；审批按钮调用 `addToolApprovalResponse()`                                                              | `apps/desktop/test/renderer/components/chat/message-tool-trace.test.ts`、`apps/desktop/test/renderer/lib/chat/tool-ui.test.ts`                                                                                                                                                                                                                                                                                                                                                                        | `toUIMessage` 转换形态                      | **已落地**（approval 可见性 helper、approval route bridge helper、`MessageToolTrace` SSR 状态渲染、delegation child trace entry、child trace 展开后的 query-cache 数据渲染均已覆盖；`message-tool-trace.test.ts` 已用 per-file `happy-dom` 环境真实 mount `MessageToolTrace` 并点击 Approve / Deny，验证 approval button DOM interaction 会调用 `onApprovalResponse(part, approved)`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| sub-agent          | 子 agent run 独立；父模型只看到 summary；完整 trace 存 event store；父 tool parts 不进入子 agent context                                                                                                 | `apps/desktop/test/main/agents/agent-runtime-harness.test.ts`、`apps/desktop/test/main/rpc/index.test.ts`、`apps/desktop/test/renderer/lib/chat/agent-run-trace.test.ts`、`apps/desktop/test/renderer/lib/chat/agent-workbench.test.ts`                                                                                                                                                                                                                                                               | subagent tool / supervisor 形态             | 部分（runtime harness 已用真实 parent provider tool call + child faux generate 覆盖独立 child run、受限 tools、父 history 隔离、child abort signal、child step budget、结构化 `subRunId` 与 summary transcript 清理，并覆盖 extension lifecycle 可观察 `delegation_started` / `delegation_finished`；main RPC 与 renderer tool trace 已提供 child trace lazy-load 边界，renderer lib 已能构建 run graph preview nodes / edges 与 artifact / event / tool display rows，trace 卡片已接入紧凑父子 run graph preview 与 artifacts；chat Agent Workbench panel 已接入 session run graph / timeline / artifacts / tool calls、stage / node / dependency graph panel 和基础 create / start / execute / advance / retry / skip / artifact preview 操作；Workbench UI 决策 helper 已覆盖 root run、root trace、按钮状态和 failed node；已新增 run graph until idle 自动推进 RPC 与 Workbench 入口，并让 Workbench approval response 默认 continue-until-idle；failed node 的 retry / skip 决策入口与 per-run retry policy 覆盖已接入）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| stream adapter     | sub-agent `subRunId`、child events、tool result summary 转成 UI 可消费结构，不污染 assistant text                                                                                                        | `apps/desktop/test/main/agents/agent-runtime.test.ts`、`apps/desktop/test/main/agents/agent-runtime-harness.test.ts`、`apps/desktop/test/main/rpc/index.test.ts`、`apps/desktop/test/renderer/lib/chat/agent-run-trace.test.ts`、`apps/desktop/test/renderer/components/chat/message-tool-trace.test.ts`                                                                                                                                                                                              | —                                           | 部分（delegation tool result 已带 `subRunId` / `profileId` / `summary` / `truncated`，runtime harness 已覆盖该结构化 output 写入 parent tool call row，main RPC 已能读取 child run trace，renderer trace 卡片会懒加载摘要与原始 trace；run graph preview 数据层与 display helper 已覆盖，trace 卡片已接入紧凑展示；Workbench 已有 stage / node / dependency graph panel，并提供 create / start / advance / retry / skip / until-idle / approval continue-until-idle 操作入口；`MessageToolTrace` 已有 child trace entry SSR 回归，并补 child trace 展开后从 `inspectRun` query cache 渲染 artifacts / tools / events 的数据回归；后续主要是调度体验产品化细节）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### 测试夹具

补充覆盖：`tool-registry.test.ts` 已直接覆盖 code agent 默认短别名里的 `read` 分页读取、approval-gated `write` 写入后 LSP diagnostics，以及 `write` 覆盖已有文件前必须先读取当前快照，避免只靠旧兼容 `readFile` / `writeFile` 工具间接证明默认 tool surface。

已开始沉淀本地 deterministic fixtures，后续新增 agent 回归应优先复用这些 helper：

- `createMockLanguageModel()`：已在 `test/main/agents/faux-provider.ts` 落地，支持 FIFO stream / generate response 队列，并配套 text、tool call、tool input delta、provider-completed tool result、tool error fixture。
- `createAgentRuntimeHarness()`：注入 isolated app home、temp project workspace、settings、event store session 和 faux provider。
- `createTempWorkspace()`：生成文件、git diff、symlink、large output、secret-like 文件。
- `collectUiStream()`：消费 AI SDK UI stream，返回 message parts / stream chunks。
- `expectEventSequence()`：用事件 type 序列断言，不依赖不稳定 timestamp，支持 exact 与 ordered-subsequence 两种模式。

不要把首批测试建立在真实 provider 上。真实 provider 只适合少量 skip-by-default smoke / e2e，默认 `vp test run` 必须离线、可重复。

### 必须覆盖的回归点

- agents 关闭时，现有 chat 文本生成、memory 注入、`@` 文件上下文不变。
- tool call id 在 UI message、event store、tool result、approval response 之间一致；即使不同 run 复用同一个 provider tool call id，也不能互相覆盖。
- parallel tools 可以并发执行，但写回模型上下文的 tool result 顺序稳定。
- approval 函数抛错时默认进入 `ask`，不要误执行高风险工具。
- deny approval 后不能执行工具，且模型收到的是明确、可继续推理的 tool error。
- sub-agent 输出不能把内部 XML / metadata / trace 文本泄漏给父模型。
- 子 agent 不继承父 agent 的 thread id、resource id、approval tools 和完整 tool history。
- agents 关闭的普通 chat route 继续把 request abort signal 传给 model stream；agents 开启时 HTTP stream disconnect 只写入 `agent_stream_disconnected`，active run 继续可见，只有显式 `agents.stopActiveRun` 才把 run abort signal 传给 model stream、tool execution 和子 agent。
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
