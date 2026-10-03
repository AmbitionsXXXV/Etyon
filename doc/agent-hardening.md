# Agent 审批、读取隔离与上下文压缩加固

## 范围与状态

本次在 `codex/on-demand-preset-tools` 的本地工作树上修复三个可独立验证的问题。原有 Tasks / Skills 路径保留：Tasks 是会话内持久协调状态，Skills 是按需加载的说明；二者均不授予执行权限。任务 owner 仍是协调元数据，不能代替文件版本保护或审批。没有增加框架，也没有改变用户的实际审批记录、密钥或安全设置。

## 已实现

### 命令记忆审批

- `command-allowlist.ts`：带前导环境赋值、首参数为 flag、解释器或包装器的命令只支持精确记忆；不再生成可覆盖任意参数的 binary 规则。旧的 binary 规则也不能匹配这些带参数的新调用。普通 CLI 的子命令记忆，例如 `git commit`，保持兼容。
- `shell-command.ts` 提供共享的 literal 参数 lexer，正确去除单／双引号和转义；`permission-mode.ts` 基于参数分类，覆盖 `git reset '--hard'` 等写法，避免把 `echo` 的文本参数当命令。无法解析的动态命令替换与不完整引号保守要求审批。危险 Git 操作识别覆盖 `-C`、`-c`、`--git-dir`、`--work-tree` 等全局选项及可执行文件路径。识别出的危险命令在非 bypass 模式下仍要求审批，即使已记忆。
- 分类器仍是有限的签名识别，不是完整 shell 解析器或操作系统 sandbox。精确记忆命令也不等于其外部环境、脚本和文件内容不可变。

### Actor 读取隔离与文本版本保护

- `workspace-core.ts`：每个 core 的 read snapshot 保存内容 SHA-256 和 mtime；受保护的写入在现有共享写锁内重新读取内容并核对两者。mtime 恢复到旧值不能掩盖文本变化。`edit` 将实际读取内容的 hash 作为显式 CAS 条件。
- `agent-toolset.ts`：父 agent 按 project + chat session 缓存读取视图，跨审批续跑保持版本；无 session 的调用使用独立 core。
- `delegation.ts`：每次子 agent invocation 使用新的 core。子 agent 读取新版文件不会刷新父 agent 的旧版本；只读子 agent 同样隔离。
- 写锁和 read snapshot 的键使用真实目标路径，包括现有目录 symlink／project root 别名；不存在的目标使用真实现有祖先路径加未创建的相对后缀。读后目标被删除时返回 `stale-write`，不会由旧写入重建；显式重读确认不存在后，可有意重建；若期间已有其他 actor 重建，仍需读取新版。没有旧快照的新文件创建仍允许。
- `/api/chat` 在持久化输入与启动模型之前取得 session 执行租约；同 session 重叠请求返回 `409 chat_session_busy`。租约覆盖响应流结算，客户端取消后继续丢弃下游输出并等待上游持久化结束，构造错误和上游错误释放。不同 session 可并行；审批暂停的流结束后可继续下一轮。若上游永不结束，租约不会自动超时放行，这是进程内互斥，尚非持久化 session lease。
- 现有 write claim 和共享写队列继续生效。这些保护只覆盖受管理的文本工具；read snapshot 在进程内，未持久化。任意 shell 或外部进程不受写队列控制，因此不是跨进程文件事务。硬链接和写入期间被外部进程重定向的 symlink 仍不在该路径锁的事务保证内。

### 工具结果计数与压缩

- `context-usage.ts`：上下文字符估计加入 reasoning、工具名、input、output 和错误信息。Tasks 返回值中的 UI `todos` 快照继续省略，与当前模型消息投影保持一致；标题和普通记忆文本提取保持原语义。
- 工具投影保留 `state` 和 approval 的 `approved`／`reason`，被拒绝的调用不能只剩下看似已执行的命令。
- `chat-auto-compact.ts`：摘要包含工具事实；为新内容和旧摘要分别保留空间，避免旧摘要挤掉本轮结果。模型摘要接收独立、较大的源材料，而不只接收小型 fallback。等待输入或审批的工具调用及其后续消息保留。
- `message-persistence.ts`：agent / chat / plan 成功结束都同步主进程持久化的规范消息，避免 UI 继续展示压缩前的历史。
- 回合结束的压缩保留为规范消息维护；本轮另在父 / 子每次模型调用前加入上下文预算，计入 system、schemas、UTF-8 文本与图片估计，并记录 provider 实际 input / output / cached tokens。当前轮大工具结果存为可分页引用，不盲目丢正文，见 [长结果存储](./tool-results.md)。估计与实际用量分开，不能把估计当精确 tokenizer。

## 验证

验证在临时副本中运行，包含 checkout 的当前 source / test 改动。真实工作树的 manifest 与 lock 已有版本差异，不能 frozen install；仅在临时副本中将 turbo、motion 和 @turbo/gen manifest 版本对齐现有 lock，再使用 frozen lock 安装并跳过 lifecycle scripts。没有改动真实 manifest / lock，没有初始化 HeroUI Pro 登录或修改任何凭据。

- 第一轮三个重点的回归及 Tasks、Skills、delegate、审批、bash 相关 13 个测试文件、135 项测试通过。独立复核的四个缺口均先由回归测试重现，再修复。新增 session overlap 集成测试确认拒绝发生在输入落库和模型调用之前，流结算后允许下一轮；取消和错误路径使用纯内存 stream 验证。
- 修正现有 Skills prompt 测试中的 `loadOnDemand: false` 参数断言后，第二轮整体运行执行的 1,220 项测试通过；5 个 UI 套件因跳过 lifecycle scripts 后 `@heroui-pro/react` 及 `chat-tool` 产物未初始化而无法加载。
- 2026-10-02 补充验证：按 HeroUI Pro 官方安装流程恢复认证组件产物后，在真实工作区重跑上述 5 个 UI 套件，48 项测试全部通过；全量 155 个文件、1,268 项测试、全项目 typecheck 和 `vp check` 均通过。安装原因和恢复命令见 [HeroUI 升级记录](./heroui-upgrade.md)。
- 改动范围 TypeScript 检查通过，使用原项目配置和真实 ambient declarations；全项目 typecheck 受同一 HeroUI Pro 依赖及连带类型错误阻挡。
- 改动范围格式、lint 检查通过。未运行真实模型调用、Electron UI E2E、打包或真实用户操作的崩溃恢复测试。

关键测试覆盖旧 binary 规则、wrapper 精确记忆、危险 Git 全局 flag 和带引号／转义的参数；同一真实文件经目录 symlink 和 project root 别名并发写只允许一个成功；已读文件被删除不能由旧写重建；拒绝状态和原因进入 fallback 与模型摘要输入；A 读旧版 / B 读新版后 A 写入被拒绝；内容变更但 mtime 复原；大型工具结果触发压缩；旧摘要不挤掉新决定；pending approval 保留；摘要模型接收到 fallback 中未包含的中间事实；所有模式在成功结束后同步。

## Invocation 持久账本

agent_invocations 在真正工具执行前保存 executing barrier；审批请求 / 用户决定仍由原有 agent_tool_calls / approval 表保存。父工具在 SDK call-site approval 后执行；子 write / edit / bash 的账本和 Hooks 放在原有 inline approval gate 之后。

账本状态为 executing、succeeded、failed、unknown。结果上限 512 KiB 并脱敏；已成功的相同 invocation 返回持久结果而不重复执行。进程中断或开始执行后无法证明结果的错误进入 unknown，启动也将遗留 executing 转为 unknown。聊天提供人工“已核对完成 / 未完成”入口；不自动重放，人工确认完成但缺少原结果也不能重跑原 invocation。

键由 session + effectScope + toolCallId 构成；原 workspace 路径稳定跨审批续跑，候选 worktree 则有自己的 namespace，避免不同模型相同 call ID 互相吞结果。新 call ID 也不能直接重试同作用域下输入相同的 unresolved 操作。它是防重复执行与未知结果核对的屏障，不是任意 shell / 外部系统的 exactly-once 保证；改变输入不构成已核对的证据。

故障注入使用临时 SQLite 和受控 counter：数据库读取失败时副作用为 0，完成后结果落库失败时仅执行一次，重启 / 新 ID 不盲跑，隔离作用域独立，UI 核对不自动执行操作。

## Workflow 执行隔离

编排脚本运行在专用 worker_threads entry，而不是 Electron 主线程 VM。父进程拥有取消与期限（默认 180 秒），worker 受 96 MiB / stack 4 MiB 限制；消息 512 KiB、整体输出有界，超限 / callback 错误结算并终止 worker。真实 read-only agent RPC 仍在主进程的权限 / DB / 审批路径执行。

VM 使用自己的 intrinsics；跨域数据走 JSON，关闭 string / WASM code generation，只暴露固定只读 orchestration API。同步死循环、await 后死循环、未结算 Promise 与输出洪泛测试均在可终止 worker 中执行，主线程 heartbeat 保持响应。独立 worker 与 VM 并不等于 OS sandbox；没有开放任意文件、进程、网络或 MCP 权限。

Forge 单独构建 workflow-worker.js，和 main / preload 同目录。打包验收必须确认 worker 可从实际产物解析，不以源码单测代替。

## 每次模型调用前的预算

Agent 设置保存最大输入预算与输出预留。已配置模型 contextWindow 优先约束，未声明时使用输入上限；输出预留过大先明确报错。每次父 / 子请求都包括系统说明、工具 schemas、文本、图片估计，保护当前 user、未结算 calls、denial 与图片。先收缩早先完成轮次，再将当前轮的大 text / JSON 工具结果完整保存为有界、24 小时私有引用；模型用 read_tool_result 分页，保存失败或仍超预算则显式失败。

真实 provider usage / cacheRead 由 model step 记录；预算估计不冒充真实 tokens。Best-of-N reviewer 同样读取候选完整 evidence refs，超 512 KiB 时明确标注有限 sample 与需人工检查，不自动采纳。

## 本轮门禁与验收

2026-10-02 的 155 文件 / 1,268 测试、typecheck / vp check 是功能补齐前的基线。补齐后的整体验证、受控 Electron UI、打包与仍需外部身份 / 系统权限的边界统一记入本轮 feature 验收文档；原始临时副本与 HeroUI 恢复过程属于历史证据，不代表当前产物状态。

参考文章是设计假设，需以上述代码和故障注入验证：[Tony Lee 的 Tasks / Skills 讨论](https://tonylee.im/en/blog/why-claude-code-dropped-todos-slash-commands/)、[Cursor 云 agent 经验](https://cursor.com/blog/cloud-agent-lessons)、[Cognition 的多 agent 协作](https://cognition.com/blog/multi-agents-working)、[LangChain 上下文组织](https://www.langchain.com/blog/organizing-context-in-a-multi-agent-harness)、[Deep Agents v0.7](https://www.langchain.com/blog/deep-agents-v0-7)、[Claude Code prompt caching](https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/)、[Anthropic Managed Agents](https://www.anthropic.com/engineering/managed-agents)、[自动化 eval 设计](https://claude.dev/blog/automating-eval-design-and-hillclimbing/)、[Cursor token efficiency](https://cursor.com/blog/improved-token-efficiency)。Claude Code 的 skill context fork 不继承聊天历史，不能直接类比某些 LangChain fork；本次没有改变已有的子 agent 上下文传递协议。
