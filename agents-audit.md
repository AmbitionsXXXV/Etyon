# Agents 设计审计报告

**日期:** 2026-06-01
**范围:** `doc/agents.md` 设计文档 + 已落地的 `apps/desktop/src/main/agents/` 实现
**方法:** 通读设计文档 + 关键模块源码 + 测试 + 参考仓库 (`/Users/jiantianjianghui/gh_projects/opencode@` `c7e1fc5e4`) 交叉对照
**目的:** 列出设计漂移、架构风险、已确认 bug，给出可执行修复顺序与测试覆盖缺口

> 本文件是**审计 / 修复指引**，不是 `doc/agents.md` 的替代或重写。所有 doc 漂移条目都引用 `doc/agents.md` 行号；所有 bug 定位都引用 `apps/desktop/src/main/...` 路径与行号。

---

## TL;DR

| #   | 严重度 | 标题                                                                              | 位置                                                                                     |
| --- | ------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| F1  | 🔴 P0  | `doc/agents.md` P0–P5 路线图与"当前落地状态"互相矛盾，文档未自洽                  | `doc/agents.md:26–57` vs `:1418–1473`                                                    |
| F2  | 🔴 P0  | 参考 opencode 路径已过时（`packages/agent/` 不存在，实际是 `packages/core/src/`） | `doc/agents.md:196, 486–567, 672–688`                                                    |
| F3  | 🔴 P0  | Coder agent 续接消息未合并：onFinish 写库时未归一化 `originalMessageCount` 边界   | `apps/desktop/src/main/server/routes/build-chat-stream-response.ts:797`                  |
| F4  | 🔴 P0  | Allowlist 整串相等比较 → 同一 `git diff --cached` intent 不同 flag 各自重新审批   | `apps/desktop/src/main/agents/permission-engine.ts:159–190`                              |
| F5  | 🟡 P1  | `isSafeReadonlyGitCommand` 正则不识别 `rtk ` 前缀                                 | `apps/desktop/src/main/agents/permission-engine.ts:43–49` + `tool-registry.ts:2102–2129` |
| F6  | 🟡 P1  | `runCheck` 不应用 `isSafeReadonlyGitCommand`                                      | `apps/desktop/src/main/agents/permission-engine.ts:310–317`                              |
| F7  | 🟡 P1  | `MessageToolTrace` 按 `toolCallId` 渲染 → 同 tool 多 invocation 各自成卡          | `apps/desktop/src/renderer/components/chat/message-tool-trace.tsx:1239–1247`             |
| F8  | 🟡 P1  | 测试文件数错（写 36 实际 38）                                                     | `doc/agents.md:591`                                                                      |
| F9  | 🟡 P1  | "AI SDK 只作为 provider stream adapter" 措辞与实际实现不符                        | `doc/agents.md:42` 及多处                                                                |
| F10 | 🟢 P2  | 跨轮次续接无视觉标记（`continuation` 元数据未生成）                               | `apps/desktop/src/main/agents/agent-chat-projection.ts:791–840`                          |
| F11 | 🟢 P2  | 文档结构问题："当前落地状态"在前，"架构分层"在后                                  | `doc/agents.md:26` vs `:704`                                                             |
| F12 | 🟢 P2  | "激进路线"与"架构分层"模块重复                                                    | `doc/agents.md:59–482` vs `:704–1336`                                                    |

最高杠杆修复路径：**F1（加 P0–P5 状态快照）→ F3（修 onFinish 边界）→ F4–F6（修 allowlist + rtk/runCheck）→ F7（修 trace 折叠）→ F2（重锚 opencode 路径）**。

---

## 1. 设计文档审计 (`doc/agents.md`)

### 1.1 [F1] P0–P5 路线图与"当前落地状态"漂移 🔴

**问题:** 文档前半（"当前落地状态"，`:26–57`）声称大量 P5 项目已落地，文档后半（"分阶段落地"，`:1418–1473`）仍把这些项目列为 P5 未来工作。

**对照表（节选）:**

| P5 列出项 (`:1460–1473`)            | 落地状态声称 (行号)                  | 实际状态                                                                          |
| ----------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| `AgentLoop` 替换 SDK 内部 tool loop | `agent-loop.ts:42` "已覆盖"          | 仅 outer turn + `stepCountIs(1)`，未替换 SDK 内部                                 |
| `Phase` 状态机 (`:1464`)            | `agent-state.ts:50` "已覆盖"         | 只实现了 `idle` / `turn`，`compaction` / `branch_summary` / `retry` 未实现        |
| `ErrorHandling` 分层 (`:1465`)      | `agent-errors.ts:53` "已覆盖"        | 已有 `AgentRuntimeError`，但 `ExecutionEnv` 仍有部分抛异常路径                    |
| stream hook 链 (`:1470`)            | `agent-stream-hooks.ts:54` "已覆盖"  | 实际有，但当前 Etyon loop 不通过 `streamFn` wrapper 注入，只在入口 patch          |
| prompt template 加载 (`:1471`)      | `prompt-templates.ts:44` "已覆盖"    | 已实现                                                                            |
| plan/execute 工程 (`:1472`)         | `agent-plan-progress.ts:55` "已覆盖" | plan mode 入口已实现；execute handoff 仅 P4 `agentCoder`，未到 P5 graph template  |
| durable approval (`:1472`)          | 多处 "已覆盖"                        | 入口与重启恢复已实现，但 **suspended run 没有 TTL / abandonment 策略**（见 §4.4） |
| run replay (`:1468`)                | —                                    | 未实现                                                                            |

**修复建议:**

加一张 P0–P5 状态快照表（放在 `:57` 之后）:

```markdown
| Phase                 | 状态      | 关键交付                                                                                                                                             |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 文档与 schema 预留 | ✅ 已落地 | settings.agents、profile 常量                                                                                                                        |
| P1 单 agent tool loop | ✅ 已落地 | /api/chat + tools + stopWhen                                                                                                                         |
| P2 权限与写入工具     | ✅ 已落地 | permission-engine, applyPatch, runCheck                                                                                                              |
| P3 Harness Runtime    | ✅ 已落地 | agent-runtime, ExecutionEnv, event store                                                                                                             |
| P4 Multi-Agent        | ✅ 已落地 | agentExplore/Plan/Review/Coder, run graph 模板                                                                                                       |
| P5 高级 Harness       | 🟡 部分   | AgentLoop outer / stream hooks / prompt templates / plan mode 已落地；agent-layer compaction / branch summary / run replay / Phase 状态机扩展 未落地 |
```

并在"当前落地状态"段开头加一行 `> 状态对照表见上`避免读者漏掉。

### 1.2 [F2] 参考 opencode 路径已过时 🔴

**问题:** `doc/agents.md` 引用 opencode 仓库时钉在 commit `c7e1fc5e4260fc3e1aea24e26d67ed4074e3575d`（`:196`），但反复引用 `packages/agent/src/...` 和 `packages/coding-agent/src/...` 路径。**该 commit 下这些路径已不存在** — opencode 已重组为 `packages/core/src/{agent, session-event, session-prompt, permission, event, provider, plugin}.ts`、`packages/desktop/`、`packages/sdk/`、`packages/llm/` 等。

**具体过时引用:**

- `:196` `LSPManager` 参考 `opencode ... dev at c7e1fc5e...` — 路径 OK，但对照章节 `AgentHarness` / `AgentSessionRuntime` / `ExecutionEnv` 全表锚到旧路径。
- `:496–528` 参考模块路径：`packages/agent/src/harness/agent-harness.ts`、`packages/agent/src/agent-loop.ts`、`packages/coding-agent/src/core/agent-session.ts`、`packages/coding-agent/src/core/agent-session-runtime.ts` 等 — 全部不存在。
- `:535–567` "Etyon 与参考 Harness 对照" 表整表锚到旧路径。
- `:672–688` "Workspace 参考" 引用 `packages/coding-agent/src/core/extensions/` 与 `examples/extensions/plan-mode/` — 后者整个已不存在。

**修复建议:**

在 `:486` 顶部加一段说明:

```markdown
> ⚠️ 参考仓库自 `c7e1fc5e` 之后已重组为 `packages/core/src/{agent, session-event, session-prompt, permission, event, provider, plugin}.ts` 布局。
> 本节 `packages/agent/` / `packages/coding-agent/` 路径保留作历史对照；评估具体 capability 时
> 应按 `packages/core/src/` 重新对照。
```

并把对照表 (`:535–567`) 的"参考路径"列改为新布局（`packages/core/src/agent.ts`、`packages/core/src/session-prompt.ts` 等）。该项工作量较大，可以分批改；最小可接受版本是只加上面的说明段 + 重新钉到更近的 opencode commit（如果有 `dev` 后续 commit）。

### 1.3 [F8] 测试文件数错误 🟡

**问题:** `doc/agents.md:591` 写 "Etyon `apps/desktop/test/main/agents/` 当前 36 个 test 文件"。**实际 38 个**（外加 `regressions/etyon-0001-queued-follow-up-next-request.test.ts` 一份回归）。

**修复:** `:591` 改为 `38 个 .test.ts 文件（外加 regressions/etyon-0001-*）`。

### 1.4 [F9] "AI SDK 只作为 provider stream adapter" 措辞误导 🟡

**问题:** `:42` 写 "AI SDK 只作为 provider stream adapter 暴露 tool schema，不自动执行 tool"。但 `apps/desktop/src/main/agents/agent-loop-ai-sdk.ts` 仍用 `streamText, generateText, stepCountIs` from `ai`，AI SDK 仍执行 model round-trip 和 tool schema 暴露；Etyon loop 只控制 **outer turn 边界** 与 **tool execute / approval suspend / event settlement**。

**修复:** `:42`（及 `:544, :545, :553, :557, :602, :1542` 等所有重复处）改为：

```text
AI SDK 仍执行 model streaming 与 tool schema 暴露；Etyon loop 通过 `stepCountIs(1)`
限制 inner call 单步，并接管 tool execute / approval suspend / event settlement。
```

### 1.5 [F11, F12] 文档结构问题 🟢

**问题 1:** "当前落地状态"（`:26–57`）在文档最前，"架构分层"（`:704–1336`）在后。读者被迫先读 30 条"已有实现"再看设计。

**问题 2:** "激进架构进步方向"（`:59–482`）与"架构分层"（`:704–1336`）覆盖同一组模块。前者是 target 架构描述，后者是 current 架构描述。

**修复建议:**

1. 把"当前落地状态"整段挪到"验收标准"之后作为附录。
2. 合并"激进路线"与"架构分层"，按模块双列展示 Current vs Target（每模块一节，标 ✅ 已对齐 / 🟡 部分 / ❌ 未实现）。
3. 顶部加 "last reviewed" 日期 + 系统图（今日 vs 目标两张 ASCII）。
4. 重复表合并：测试覆盖映射 (`:589–670`) 与 Etyon 首批测试矩阵 (`:1531–1549`) 是同一张表，保留一份，链接到 test 文件。

---

## 2. Coder Agent 续接消息 Bug 🔴

### 2.1 现象

用户截图（`coder` agent 下执行 `git diff --cached` 系列调用）显示：

- `mergeAgentEventProjectionIntoChatMessages` 设计意图是把 approval-resumed continuation 合并回原始 assistant 气泡（`doc/agents.md:33, :48`）。
- 实际渲染：跨轮次 resume 产生 **两条独立 assistant 消息**。
- 视觉上无"续接"标记。

### 2.2 [F3] 根因 — onFinish `originalMessageCount` 边界未归一化

**主流程:** `apps/desktop/src/main/server/routes/build-chat-stream-response.ts:784–803`

```ts
onFinish: async ({ messages: messagesWithWorkTime }) => {
  const { messages } = transformMessagesWithWorkTime(messagesWithWorkTime);
  ...
  const projectedMessages = mergeAgentEventProjectionIntoChatMessages({
    events,
    messages,                              // 渲染层完整状态
    originalMessageCount: messages.length, // ⚠️ 等价"不裁剪 prefix"
    runId,
  });
  await onFinishPersist(projectedMessages);
}
```

**Merge 实现:** `apps/desktop/src/main/agents/agent-chat-projection.ts:781–840`

```ts
export const trimTrailingAssistantMessages = (messages) => {
  let end = messages.length
  while (end > 0 && messages[end - 1]?.role === "assistant") {
    end -= 1
  }
  return messages.slice(0, end)
}
```

`originalMessageCount` 决定 `prefixMessages` / `suffixStartIndex` 边界。

**Repair 路径（参照对比）:** `apps/desktop/src/main/chat-messages.ts:96–97, 269–371`

```ts
const getLatestUserMessageBoundary = (messages) => ...
// 在边界处做归一化后才调用同一个 merge 函数
```

**问题:**

- onFinish 传 `messages.length` → trim 不会发生 → prefix 末尾的旧 assistant 全部留下 → 与 projection suffix 叠加后产生两条 assistant 消息。
- repair 路径传"截至最后一个 user 消息的边界" → 正常工作。
- **同一 merge 函数，两个 caller 语义不同**。`mergeAgentEventProjectionIntoChatMessages` 的 `originalMessageCount` 参数名误导。

### 2.3 修复步骤

1. **先写失败用例**（必做）
   - `apps/desktop/test/main/agents/regressions/coder-approval-resume-continuation.test.ts`
   - 用 `createAgentRuntimeHarness` 启动 coder agent → 触发 write tool 进入 approval → approve → 让 agent 续写 → 调 `mergeAgentEventProjectionIntoChatMessages`（传 `originalMessageCount: messages.length`，但 `messages` 含上轮 suspended 状态）→ 断言投影后 assistant 数 == 1。

2. **修 caller** — `build-chat-stream-response.ts:797`:

   ```ts
   const originalMessageCount = computeUserBoundaryIndex(messages)
   const projectedMessages = mergeAgentEventProjectionIntoChatMessages({
     events,
     messages,
     originalMessageCount,
     runId
   })
   ```

   把 `computeUserBoundaryIndex` 从 `chat-messages.ts:96–97` 抽到 `agent-chat-projection.ts` 公共导出（统一两个 caller 语义）。

3. **防御性 sanity check** — `mergeAgentEventProjectionIntoChatMessages` 在 `trimTrailingAssistantMessages` 之后断言 `prefixMessages.at(-1)?.role !== "user"`（即 prefix 必须以 user 结尾），违反时 throw + logger。

4. **[F10] 加 `continuation` 元数据** — `agent-chat-projection.ts:834–838` merge 完成后:

   ```ts
   const trimmedSomething = prefixAfterTrim.length < prefixMessages.length
   if (trimmedSomething) {
     for (const m of projectedSuffixMessages) {
       ;(m as { metadata?: Record<string, unknown> }).metadata = {
         ...m.metadata,
         continuation: true
       }
     }
   }
   ```

   判定条件: `trimTrailingAssistantMessages` 真的裁掉了 prefix 末尾的 assistant → 说明本轮 assistant 是跨轮续接。

5. **渲染层** — `AssistantMessageTimeline` 顶部条件渲染小 pill:

   ```tsx
   {
     message.metadata?.continuation && (
       <div className="ml-1 inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[10px] text-muted-foreground">
         ↳ 续接上一条
       </div>
     )
   }
   ```

   选 timeline 顶部而非整条 bubble: 不破坏 `bg-transparent` 整体连续流设计；只在跨轮 resume 出现。

6. **文档** — `doc/agents.md` 补 "跨轮续接视觉约定" 段（位置：`:38` 之后）。

### 2.4 测试缺口

| 缺口                                                                     | 建议文件 / it()                                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 端到端：coder + approval + resume → `chat_messages` 中 assistant 数 == 1 | `regressions/coder-approval-resume-continuation.test.ts`                                            |
| onFinish → replaceChatMessages → repair 链路                             | `build-chat-stream-response.test.ts` 加 `chat_messages_after_finish_has_single_assistant_on_resume` |
| `continuation` 元数据生成                                                | `agent-chat-projection.test.ts` 加 merge 直接测                                                     |
| 渲染层 pill                                                              | `assistant-message-timeline.test.tsx` 新建（若不存在）                                              |

---

## 3. Allowlist 粒度 Bug 🔴

### 3.1 现象

用户截图 (`coder` agent) 显示:

| 命令                                                      | 状态             |
| --------------------------------------------------------- | ---------------- |
| `git diff --cached --stat`                                | ✅ 已完成        |
| `git diff --cached --name-only`                           | ✅ 已完成        |
| `git diff --cached --stat`（第二次）                      | ✅ 已完成        |
| `git diff --cached --name-only`（第二次）                 | ✅ 已完成        |
| `git diff --cached apps/desktop/.../agent-loop-ai-sdk.ts` | ⚠️ 需要 approval |
| `git diff --cached apps/desktop/.../agent-runtime.ts`     | ⚠️ 需要 approval |

逻辑上 `--cached --stat` 与 `--cached apps/...` 是同一**只读 intent**，应当共享一次 allow。

### 3.2 [F4] 根因 1 — allowlist 整串相等比较

**`apps/desktop/src/main/agents/permission-engine.ts:159–190`:**

```ts
return allowlist.some((rule) => {
  const ruleWorkspaceRoot = path.resolve(rule.projectPath)
  return (
    rule.command.trim() === normalizedCommand && // ⚠️ 整串相等
    rule.toolName === name &&
    ruleWorkspaceRoot === normalizedWorkspaceRoot &&
    resolveCommandCwd(rule.cwd, ruleWorkspaceRoot) === normalizedCwd
  )
})
```

`rule.command.trim() === normalizedCommand` 不允许任何 argv 变化。已批准的 `git diff --cached --stat` 不会覆盖后续的 `git diff --cached apps/...`。

**同样的"dedupe"在 RPC 入口也有问题**（`apps/desktop/src/main/rpc/router.ts:506` 的 `isSameAgentCommandApprovalRule`）— 用户点 "Approve and remember" 时去重失败，会留重复条目。

### 3.3 [F5] 根因 2 — `isSafeReadonlyGitCommand` 不识别 `rtk ` 前缀

**`apps/desktop/src/main/agents/permission-engine.ts:43–49`:**

```ts
const SAFE_READONLY_GIT_COMMAND_PATTERN =
  /^git\s+(?:diff|log|show|status)(?:\s+[A-Za-z0-9_@%/:#.,=+\-~^*[\]{}]+)*$/u
```

**`apps/desktop/src/main/agents/tool-registry.ts:2102–2129` 的 `executeRtkCommand`:**

```ts
const command = normalizeRtkCommand(parsedInput.command);
// normalizeRtkCommand 在 command.trim() 不以 "rtk " 开头时加 "rtk " 前缀
return await executeCommandTool({ ..., command, ... });
```

`rtkCommand` 路径下 `git diff --cached` 实际执行的是 `rtk git diff --cached` — `^git` 锚定开头，正则不匹配 → 即使 `name === "rtkCommand"` 也进 `ask`。

### 3.4 [F6] 根因 3 — `runCheck` 不应用 `isSafeReadonlyGitCommand`

**`apps/desktop/src/main/agents/permission-engine.ts:310–329`:**

```ts
if (name === "runCheck") {
  if (isSafeCheckCommand(command)) {                    // vp check / vp test run / vp run
    return buildDecision({ action: "allow", ..., ruleId: "safe-check-command" });
  }
  return buildDecision({ action: "ask", ... });
}
if ((name === "bash" || name === "rtkCommand") && isSafeReadonlyGitCommand(command)) {
  return buildDecision({ action: "allow", ..., ruleId: "safe-readonly-git-command" });
}
```

`runCheck` 路径只查 `isSafeCheckCommand`，没考虑 `git diff|log|show|status`。如果模型走 `runCheck { command: "git diff --cached ..." }`，100% 进 `ask`。

### 3.5 [F7] 根因 4 — UI trace 不折叠

**`apps/desktop/src/renderer/components/chat/message-tool-trace.tsx:1239–1247`:**

```tsx
{parts.map((part) => (
  <StructuredToolTraceCard
    key={part.toolCallId}    // ⚠️ 每个 invocation 一张卡
    ...
  />
))}
```

**对比:** 旧文本流路径 `apps/desktop/src/renderer/lib/chat/tool-ui.ts:422–471` 的 `compactAssistantTextSegments` 对 `executed-command` segment 按 `cwd + shell + command + exitCode` 折叠 `repeatCount`，但**只覆盖从 text 流里解析的 `Executed in ...` block，对现代 `ToolUIPart` / `DynamicToolUIPart` 不生效**。

用户截图里 4 次 `git diff --cached --stat` 渲染成 4 张卡，而不是 1 张 + `×4` 计数。

### 3.6 修复方向

**核心思路:** 把"intent predicate"作为 allow 决策来源，而不是字符串全等。这正是 `runCheck` 已有的 `SAFE_CHECK_COMMAND_PATTERNS` 模式（`vp check` / `vp test run` / `vp run <pkg>` + 任意 trailing token）。

**最小修复（D1）:** `permission-engine.ts:159–190` 抽 `isCommandCoveredByRule` helper:

```ts
const isCommandCoveredByRule = ({
  currentCommand,
  ruleCommand,
  toolName
}: {
  currentCommand: string
  ruleCommand: string
  toolName: string
}): boolean => {
  if (currentCommand === ruleCommand) return true
  if (
    (toolName === "bash" ||
      toolName === "rtkCommand" ||
      toolName === "runCheck") &&
    isSafeReadonlyGitCommand(currentCommand) &&
    isSafeReadonlyGitCommand(ruleCommand)
  )
    return true
  if (
    (toolName === "bash" ||
      toolName === "rtkCommand" ||
      toolName === "runCheck") &&
    isSafeCheckCommand(currentCommand) &&
    isSafeCheckCommand(ruleCommand)
  )
    return true
  return false
}
```

接入 `commandMatchesApprovalAllowlist` 和 `router.ts:506` 的 `isSameAgentCommandApprovalRule`（去重要同步走同一规则）。

**`SAFE_READONLY_GIT_COMMAND_PATTERN` 加 `rtk ` 前缀（D2 一半）:**

```ts
// permission-engine.ts
const SAFE_READONLY_GIT_COMMAND_PATTERN =
  /^(?:rtk\s+)?git\s+(?:diff|log|show|status)(?:\s+[A-Za-z0-9_@%/:#.,=+\-~^*[\]{}]+)*$/u
```

或抽 `stripWrapperPrefix`:

```ts
const stripWrapperPrefix = (command: string): string =>
  command.replace(/^\s*(?:rtk\s+)/u, "").trim()
```

把 `isSafeReadonlyGitCommand` 应用到 `runCheck` 分支（与 `isSafeCheckCommand` 并列）。

**通用修复（D2 完整）:** 引入 `BOUNDED_INTENT_MATCHERS` registry:

```ts
type BoundedIntentMatcher = {
  matches: (command: string) => boolean
  toolNames: readonly AgentToolName[]
}

const BOUNDED_INTENT_MATCHERS: readonly BoundedIntentMatcher[] = [
  {
    matches: isSafeReadonlyGitCommand,
    toolNames: ["bash", "rtkCommand", "runCheck"]
  },
  { matches: isSafeCheckCommand, toolNames: ["bash", "rtkCommand", "runCheck"] }
  // 后续 git show <ref>、git status --porcelain、cargo check、tsc --noEmit 等加这里
] as const
```

`isCommandCoveredByRule` 改为查 registry。

**UI 折叠（D3）:** `message-tool-trace.tsx:1239–1247` 之前折叠相邻 + 同 `toolName` + 同 canonical `input` + 终态 (`output-available` / `output-error` / `output-denied`) 的 part，加 `×N` 计数。**审批 / streaming 不折叠**（用户必须看到 approval 按钮）。

### 3.7 测试缺口

| 缺口                                        | 建议 it()                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 同 intent 不同 argv 覆盖                    | `permission-engine.test.ts`: "allows a remembered git diff --stat invocation to cover git diff --cached paths" |
| 反向：bad rule 不覆盖                       | "does not let a remembered rm -rf invocation cover git diff"                                                   |
| git log/show/status 共享 rule               | "covers git log / git show / git status with one remember rule"                                                |
| rtkCommand 走 `rtk git diff`                | "covers rtkCommand rtk git diff via the same allowlist intent"                                                 |
| 防御：destructive 不被 allowlist 覆盖       | "does not let rtk prefix bypass side-effect flag detection"                                                    |
| safe-readonly-git 应用到 rtkCommand         | "auto-allows rtk git diff for rtkCommand"                                                                      |
| safe-readonly-git 应用到 runCheck           | "auto-allows git diff for runCheck as a read-only inspection"                                                  |
| 多 flag / 路径组合 / `-U<n>` / `--no-color` | `tool-registry.test.ts`                                                                                        |
| `git diff` 端到端                           | `command-tools.test.ts`（当前完全无 git diff 覆盖）                                                            |
| UI 折叠                                     | `message-tool-trace.test.ts`: "collapses repeated identical git diff invocations into one card with count"     |
| 审批不折叠                                  | "does not collapse approval-requested or input-streaming parts"                                                |
| `ToolUIPart` 等价折叠 helper                | `tool-ui.test.ts`: "exposes a ToolUIPart-aware compaction helper"                                              |

---

## 4. 架构风险与未声明假设

### 4.1 [F1, F11, F12] 设计漂移（已在 §1 详述）

### 4.2 缺失 schema migration 策略

`agent_events` 是事实源，30+ 事件类型已存在（`agent-event-store.ts`），Drizzle 迁移管 _表_ 不管 _payload 形状_。新增事件类型（如 `agent_skill_invocation_started`）后旧行的 `payload_json` 缺少新字段，reader 必须 tolerate missing field — 当前没有 `event_version` 字段。

**建议:** doc 加 "event payload 是软 schema；union 类型 + 可选字段；无 version 字段" 段；`agent_event_store.ts` 加 `assertEventShape<T>(event, type)` helper。

### 4.3 `chat_messages` ↔ `agent_events` 对账依赖 repair

`chatSessions.listMessages` (`chat-messages.ts:269–371`) 的 repair 路径做四件事：读 latest completed root run → 读 latest `agent_ui_stream_snapshot_created` for active runs → `trimTrailingAssistantMessages` 剥离 prefix → repair 旧空 projection assistant message。

但 **`chat_messages` 早于 `agent_events` 的历史数据**、**跨设备同步仅有 `chat_messages` 副本**的场景未覆盖。

**建议:** `chat_messages` 加 `agent_projection_run_id` 列；下次 schema migration 升级为 on-read projection；doc 补 "chat_messages vs agent_events 对账" 段。

### 4.4 [F2, F8 相关] Durable approval on suspended run 无 abandonment 策略

`doc/agents.md:40` 写 "app startup 会把重启前遗留的 running run 标记为 failed，同时保留 suspended approval run 的 pending 状态"；`:298–306` 文档化 durable approval state machine。

**未覆盖场景:**

- (a) 用户关闭 app 后不再返回 → `suspended` run 永远留 DB。
- (b) 用户三周后回来 → approval id / profile / workspace / provider model 可能已变 → approval 是否仍有效？
- (c) Provider key 已失效 → 恢复后 runnable state 不清晰。

**建议:** doc 加 "stale-approval policy (v1 占位)" 段：

```markdown
### suspended run 老化策略（v1 占位）

- 当前：app 重启后保留所有 suspended approval run，pending / resume query 都能看到。
- 待补：`settings.agents.approvalTtl` 默认 7 天；超期 suspended run 标记为
  `failed(reason="approval_timeout")` 并通过 `agents.listRecoverableRuns` 暴露。
- 何时引入：P5 durable execution 收尾时。
```

### 4.5 Run graph auto-retry 分类未定义

`doc/agents.md:56` 写 `advanceRunGraph` 对 `provider / network / timeout` 瞬态失败自动 retry 默认一次。

**风险:**

- `read-fs` 工具 "transient" 几乎不可能（文件不存在 retry 仍不存在）。
- `write-fs` / `shell` 自动 retry 有 **double-write** 风险。
- 单一 `settings.agents.retry.maxAutomaticRetries=1` 开关不区分工具类别。

**建议:** doc 加 "transient classification" 段：

```markdown
> 注：`advanceRunGraph` 的 `settings.agents.retry` 仅对 `provider / network / timeout` 分类为 transient。
> 写入类工具（`write-fs` / `shell`）的失败不会自动 retry，避免 double-write / 幂等性问题。
> 后续应要求 retryable tool 显式声明 `idempotencyKey` 才能进入 retry 范围。
```

实现侧：permission-engine 拒绝 retry `manifest.riskLevel !== "safe"` 的工具（除非显式声明 `idempotent: true`）。

### 4.6 Tool output summary cache 失效语义未定义

`truncate.ts` 的 `createToolResultSummaryCache` 配合 run graph dependency prompt：sibling 节点引用同一大型依赖输出时只触发一次 model summary。

**未覆盖:** cache key 组成（content hash? mtime? query?）。`grep` / `find` 结果缓存若只用 content hash，文件被改后 cache 仍返回旧 summary。

**风险低**（模型可 `read` 刷新），但 unstated。doc 补一段即可。

### 4.7 `chat-branch` 与运行中 child run / 审批 pending 的边界模糊

`doc/agents.md:48` 描述 `chat-branch` 是 session tree 的 custom entry，`retainedMessageIds` 机制已实现。

**未覆盖:**

- (a) 用户在 tool 仍在执行中 fork → 新 run 是否继承未完成的 tool call row？
- (b) 用户 regenerate 后，background child run 仍归属原 `parentRunId`？
- (c) 多个 `chat-branch` 事件在同一 leaf 路径上顺序叠加规则？
- (d) 用户 regenerate + pending approval 同时存在？

**建议:** doc 加 "chat-branch 不变量" 段。

### 4.8 缺参考能力对比

未提及的 opencode 能力（pinned `c7e1fc5e`）:

- `packages/core/src/session-message-updater.ts` — message-level transformation（id remapping, split, merge）。Etyon `agent-chat-projection.ts` 做类似工作但粒度粗（per-message 而非 per-message-kind）。
- `packages/core/src/effect/` (`runtime.ts`, `service-use.ts`, `memo-map.ts`) — DI / memoization runtime。Etyon 无对应。
- `packages/core/src/flag/` — typed feature flag 系统。Etyon settings 有但无 first-class flag 系统。
- `packages/core/src/permission.ts` — `always-allow` / `always-ask` / `always-deny` 规则。Etyon `permission-engine.ts` 缺规则格式对比。

**建议:** doc "外部调研结论" 末尾加 "未采纳参考能力" 段，列出以上 + 拒绝理由。

---

## 5. 修复优先级总表

按 ROI 排序（先做高杠杆、低风险、依赖少的项）:

| #   | 优先级 | 标题                                                                                                       | 依赖 | 估时 | 状态             |
| --- | ------ | ---------------------------------------------------------------------------------------------------------- | ---- | ---- | ---------------- |
| 1   | 🔴 P0  | F3 修 onFinish `originalMessageCount` 边界（`build-chat-stream-response.ts:797`）                          | —    | 1h   | 需先写失败用例   |
| 2   | 🔴 P0  | F4 抽 `isCommandCoveredByRule` 并接入 `commandMatchesApprovalAllowlist` + `isSameAgentCommandApprovalRule` | —    | 1.5h | 同上             |
| 3   | 🟡 P1  | F5 `SAFE_READONLY_GIT_COMMAND_PATTERN` 加 `rtk ` 前缀                                                      | #2   | 0.5h | —                |
| 4   | 🟡 P1  | F6 `isSafeReadonlyGitCommand` 应用到 `runCheck` 分支                                                       | #2   | 0.5h | —                |
| 5   | 🟡 P1  | F1 doc 加 P0–P5 状态快照表                                                                                 | —    | 0.5h | doc 改动         |
| 6   | 🟡 P1  | F8 修测试文件数（36 → 38）                                                                                 | —    | 0.1h | doc 改动         |
| 7   | 🟡 P1  | F7 `MessageToolTrace` 折叠同 `(toolName, canonicalInput, terminalState)` 终态 part                         | —    | 1.5h | —                |
| 8   | 🟡 P1  | F9 "AI SDK 只作为 provider stream adapter" 措辞修订                                                        | —    | 0.2h | doc 改动         |
| 9   | 🟢 P2  | F10 `continuation` 元数据 + 渲染层 pill                                                                    | #1   | 1h   | 视觉增强         |
| 10  | 🟢 P2  | F2 doc 参考 opencode 路径加过时说明 + 重新钉 commit                                                        | —    | 0.5h | doc 改动         |
| 11  | 🟢 P2  | F11, F12 doc 结构: "当前落地状态" 挪到附录 + 合并"激进路线"与"架构分层"                                    | —    | 2h   | doc 改动         |
| 12  | 🟢 P2  | §4.4 doc 加 stale-approval policy 段                                                                       | —    | 0.3h | doc 改动         |
| 13  | 🟢 P2  | §4.5 doc 加 transient classification 段 + 实现侧 idempotent 校验                                           | —    | 1h   | doc + code       |
| 14  | 🟢 P2  | §4.7 doc 加 chat-branch 不变量段                                                                           | —    | 0.3h | doc 改动         |
| 15  | 🟢 P2  | §4.8 doc 加未采纳参考能力段                                                                                | —    | 0.5h | doc 改动         |
| 16  | 🟢 P2  | §4.2 doc 加 event payload 软 schema 段                                                                     | —    | 0.3h | doc 改动         |
| 17  | 🟢 P2  | §4.3 `chat_messages` 加 `agent_projection_run_id` 列 + on-read projection migration                        | —    | 3h   | code + migration |

**总估时:** ~15h（不含大表结构调整）。其中 code 改动约 9h，doc 改动约 5h，测试约 1h（分散在每个修复中）。

---

## 6. 测试覆盖缺口汇总

按文件列出当前缺口，按建议 it() 见 §2.4 / §3.7 / §4:

| 文件                                                                                   | 缺口                                              | 优先级 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- | ------ |
| `apps/desktop/test/main/agents/permission-engine.test.ts`                              | F4, F5, F6 相关 intent 覆盖 + rtk/runCheck + 防御 | 🔴     |
| `apps/desktop/test/main/agents/tool-registry.test.ts`                                  | F4, F5, F6 集成覆盖                               | 🟡     |
| `apps/desktop/test/main/agents/command-tools.test.ts`                                  | 完全无 git diff 端到端                            | 🟡     |
| `apps/desktop/test/main/agents/agent-chat-projection.test.ts`                          | F3, F10 merge continuation 测                     | 🔴     |
| `apps/desktop/test/main/agents/build-chat-stream-response.test.ts`                     | F3 onFinish → repair 链路测                       | 🔴     |
| `apps/desktop/test/main/agents/regressions/coder-approval-resume-continuation.test.ts` | F3 端到端                                         | 🔴     |
| `apps/desktop/test/main/agents/agent-event-store.test.ts`                              | §4.2 event payload 软 schema 测                   | 🟢     |
| `apps/desktop/test/main/agents/agent-session-tree.test.ts`                             | §4.7 chat-branch 不变量测                         | 🟢     |
| `apps/desktop/test/renderer/components/chat/message-tool-trace.test.ts`                | F7 trace 折叠测                                   | 🟡     |
| `apps/desktop/test/renderer/components/chat/assistant-message-timeline.test.tsx`       | F10 continuation pill 测                          | 🟢     |
| `apps/desktop/test/renderer/lib/chat/tool-ui.test.ts`                                  | F7 `ToolUIPart` 等价折叠 helper 测                | 🟢     |

---

## 7. 文档修订项汇总（按位置）

| 位置          | 修订                                               | 来源     |
| ------------- | -------------------------------------------------- | -------- |
| `:26` 段首    | 加"状态对照表见上"指针                             | F1       |
| `:57` 之后    | 新增 P0–P5 状态快照表                              | F1       |
| `:42` 及多处  | "AI SDK 只作为 provider stream adapter" → 准确措辞 | F9       |
| `:196`        | 重新钉到更新的 opencode commit（如 `dev` 后续）    | F2       |
| `:486` 段首   | 加过时路径说明段                                   | F2       |
| `:535–567`    | 重锚对照表到 `packages/core/src/`                  | F2       |
| `:591`        | 测试文件数 36 → 38                                 | F8       |
| `:660–670`    | 清理与已落地重叠的"建议补测优先级"项               | 文档清理 |
| 新增 § 4.4 段 | stale-approval policy                              | §4.4     |
| 新增 § 4.5 段 | transient classification                           | §4.5     |
| 新增 § 4.7 段 | chat-branch 不变量                                 | §4.7     |
| 新增 § 4.8 段 | 未采纳参考能力                                     | §4.8     |
| 新增 § 4.2 段 | event payload 软 schema                            | §4.2     |
| 新增 § 4.3 段 | chat_messages vs agent_events 对账                 | §4.3     |
| 档案化        | "当前落地状态" 整段挪到"验收标准"后                | F11      |
| 合并          | "激进路线" 与 "架构分层" 合并为 Current vs Target  | F12      |

---

## 8. 验证手段

- **每次 code 改动必须先写失败用例**（按 `AGENTS.md` "Think Before Coding" + "Goal-Driven Execution"）。具体入口见 §2.3 step 1 / §3.6 D1 测试。
- **修复后跑 `vp test run`** 全套，确认无回归。
- **doc 改动**运行 `vp check` 确认 markdown 格式合规。
- **手动验证**: dev 模式开 chat 用 coder agent → 触发 write tool approval → approve → 验证 chat 只有 1 条 assistant message 且顶部有 `↳ 续接上一条` pill。
- **手动验证 2**: dev 模式开 chat 用 coder agent → 跑 4 次 `git diff --cached --stat` → 验证只有 1 次审批 + 1 张 trace 卡（带 `×4`）。

---

## 9. 范围说明

本审计**未覆盖**以下内容（按 `AGENTS.md` "Simplicity First" 原则 — 避免范围漂移）:

- `doc/code-agent-tools.md` 的具体 tool surface 审计（除非 §3 涉及）。
- `/api/chat` 之外的 HTTP route（`/api/auth`、`/api/settings` 等）。
- Renderer 组件完整 UI 审计（仅涉及 `message-tool-trace.tsx` / `assistant-message-timeline.tsx`）。
- 数据库 schema 完整性审计（仅涉及 F3 的 `agent_projection_run_id` 列建议）。
- 性能 / 渲染性能 / 内存占用。

如需扩展审计范围，请另起一份。

---

## 附录 A: 关键文件路径速查

### 主进程

- `apps/desktop/src/main/server/routes/chat.ts` — chat route 入口
- `apps/desktop/src/main/server/routes/build-chat-stream-response.ts` — onFinish 持久化（含 F3 bug 位置 `:797`）
- `apps/desktop/src/main/chat-messages.ts` — repair 路径（含 `getLatestUserMessageBoundary` `:96–97`、listMessages `:269–371`）
- `apps/desktop/src/main/agents/agent-chat-projection.ts` — merge 函数实现（`trimTrailingAssistantMessages` `:781–789`、`mergeAgentEventProjectionIntoChatMessages` `:791–840`）
- `apps/desktop/src/main/agents/agent-runtime.ts` — runtime facade + `createAgentUiLiveSink` (`:1100–1530`)
- `apps/desktop/src/main/agents/agent-loop.ts` — self-managed loop
- `apps/desktop/src/main/agents/agent-loop-ai-sdk.ts` — AI SDK adapter
- `apps/desktop/src/main/agents/agent-state.ts` — phase / busy guard
- `apps/desktop/src/main/agents/agent-errors.ts` — `AgentRuntimeError`
- `apps/desktop/src/main/agents/agent-stream-hooks.ts` — hook 链
- `apps/desktop/src/main/agents/agent-kernel.ts` — run graph kernel
- `apps/desktop/src/main/agents/agent-session-tree.ts` — session tree
- `apps/desktop/src/main/agents/agent-event-store.ts` — append-only event store
- `apps/desktop/src/main/agents/agent-turn-state.ts` — turn snapshot
- `apps/desktop/src/main/agents/agent-extensions.ts` — extension runner
- `apps/desktop/src/main/agents/agent-plan-progress.ts` — plan/execute
- `apps/desktop/src/main/agents/permission-engine.ts` — **F4, F5, F6 bug 位置 (`:159–190, :310–329`)**
- `apps/desktop/src/main/agents/tool-registry.ts` — tool 注册 + `executeRtkCommand` (`:2102–2129`)
- `apps/desktop/src/main/agents/tool-manifest.ts` — `gitDiff` manifest (`:225–231`)
- `apps/desktop/src/main/agents/tool-policy.ts` — policy compiler
- `apps/desktop/src/main/agents/profiles.ts` — built-in profiles
- `apps/desktop/src/main/agents/execution-env.ts` — `Result<T,E>` boundary
- `apps/desktop/src/main/agents/agent-workspace.ts` — workspace substrate
- `apps/desktop/src/main/rpc/router.ts` — `isSameAgentCommandApprovalRule` (`:506`)
- `apps/desktop/src/main/git-project-status.ts` — `getGitProjectDiff` (`:559–631`)

### 渲染层

- `apps/desktop/src/renderer/routes/chat.$sessionId.tsx` — chat route UI
- `apps/desktop/src/renderer/components/chat/message-tool-trace.tsx` — **F7 bug 位置 (`:1239–1247`)** + approval UI
- `apps/desktop/src/renderer/components/chat/assistant-message-timeline.tsx` — **F10 pill 位置 (`:336–374`)**
- `apps/desktop/src/renderer/lib/chat/tool-ui.ts` — `compactAssistantTextSegments` (`:422–471`)

### 测试

- `apps/desktop/test/main/agents/regressions/etyon-0001-queued-follow-up-next-request.test.ts` — 已有的 regression 模板
- `apps/desktop/test/main/agents/agent-runtime-harness.test.ts` — runtime harness 入口
- `apps/desktop/test/main/agents/faux-provider.ts` — deterministic provider fixture
- `apps/desktop/test/main/agents/agent-chat-projection.test.ts` — merge 函数测

### 文档

- `doc/agents.md` — 主要审计对象
- `doc/code-agent-tools.md` — tool surface 定义
- `AGENTS.md` — 工程规范

---

**最后审查日期:** 2026-06-01
**下次审查触发条件:** P5 剩余项（agent-layer compaction / branch summary / run replay）落地后，或 §4 中任一架构风险被实测触发后。
