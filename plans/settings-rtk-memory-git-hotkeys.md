# 规划:settings 图标 / rtk 强化 / memory 管理 / per-session git / 权限热键

状态:已经 grilling 定稿(2026-07-12)。分两阶段实施,fable 设计与验收。本文件是各实现 agent 的共同契约;实现时若发现与代码实况冲突,以代码为准并在交付说明中报告偏差,不要自行扩大范围。

## 全局约束(所有任务)

- 遵守根目录 `AGENTS.md`:箭头函数 `const Foo = () =>`、对象 key 按字母排序(oxlint `sort-keys`)、文件名 kebab-case、`no-use-before-define`、桌面端 import 用 `@/main/...` / `@/renderer/...` 别名、React 19(ref as prop)、zod v4 嵌套 default 需完整值(`as const` 常量)。
- 包管理只用 `vp`(禁 pnpm/npm/bun 直调);新依赖:`cd apps/desktop && vp add <pkg>`。
- i18n:新文案在 `packages/i18n/src/locales/{en-US,zh-CN,ja-JP}/translation.json` 三份同步补齐,嵌套 key。多 agent 并行时各自只在指定的 key 区域内新增,不动其他区域。
- 测试放 `apps/desktop/test/<layer>/<镜像路径>.test.ts`;验证:`vp check` + `vp test run`(可用 vitest 过滤参数只跑相关文件)。
- 不 commit、不 push;改动留工作区。不要启动 dev app。
- 修改保持外科手术式:每行改动都能追溯到本规划的某一条。

## Phase 1(并行,互不重叠)

### ① settings sidebar 图标去重(执行:fable 本人)

- 现状:`apps/desktop/src/renderer/lib/settings-page/nav-config.ts:44-96`,`BrainIcon` 被 Agents+Memory 共用、`ChatBotIcon` 被 Chat+Channels 共用、Providers 用 `NoteEditIcon` 语义不贴。
- 方案:用 hugeicons 免费库重新分配,方向:Agents=机器人/AI、Memory 保留大脑或换数据库、Chat=对话气泡、Channels=纸飞机/广播(Telegram 语义)、Providers=云/芯片。
- 加单测:`apps/desktop/test/renderer/settings-nav-config.test.ts`(或就近既有目录惯例),断言 `SETTINGS_NAV_ENTRIES` 图标两两不同。

### ② rtk 自动改写 + rg 系统优先捆绑兜底(执行:codex gpt-5.6-terra xhigh)

决策:系统 rg 优先(spawn env 带 Homebrew PATH 修复)→ `@vscode/ripgrep` 兜底;rtk 在 bash spawn 一刻自动改写,白名单 + 简单命令/`&&` 链;审批/危险判定/allowlist 匹配全部基于原始命令;UI 与事件保留原始命令 + rtk 标记;Token Savings tab 加控制卡;开关默认开。

1. **共享 spawn env**:把 `apps/desktop/src/main/agents/minimal/bash-tool.ts:102-114` 的 `getShellSpawnEnv`(Homebrew PATH 前置补丁)抽到新文件 `apps/desktop/src/main/agents/minimal/spawn-env.ts`,bash-tool 改为导入;`workspace-core.ts` 的 `runRipgrep`(324-370)spawn 时传该 env。
2. **rg 解析** 新建 `apps/desktop/src/main/agents/minimal/ripgrep-binary.ts`:
   - `resolveRipgrep()`:模块级缓存;先 `execFile("rg", ["--version"], { env: getShellSpawnEnv() })` 成功 → `{ command: "rg", source: "system" }`;失败 → 尝试 `@vscode/ripgrep` 的 `rgPath`(fs 校验存在)→ `{ command: rgPath, source: "bundled" }`;都不行 → `{ command: null, source: "missing" }`。
   - `runRipgrep` 用解析结果;missing 时错误信息说明系统与捆绑均不可用。
   - 依赖:`vp add @vscode/ripgrep`(apps/desktop);vite 主进程构建如需把它设为 `external`(参照 `vite.main.config.ts` 中 `font-list` 先例);`forge.config.ts` 参照 `@libsql/darwin-arm64` / `electron-liquid-glass` 先例,把 `@vscode/ripgrep` 的 `bin/` 排除出 asar 或加入 unpack,保证打包后可执行。
3. **rtk 改写** 新建 `apps/desktop/src/main/agents/minimal/rtk-rewrite.ts`(纯函数,可单测):
   - 白名单(首 token):`cargo, curl, docker, gh, git, go, jest, kubectl, next, npm, npx, playwright, pnpm, prettier, prisma, pytest, rake, rspec, tsc, vitest, wget`。
   - `rewriteCommandForRtk(command)`:含 `|` `>` `<` `;` `$(` 反引号、单独 `&`(非 `&&`)、换行 → 原样返回;`&&` 与引号同时出现 → 原样返回(避免误拆引号内 `&&`);否则按 `&&` 分段,每段首 token 为 `rtk` 则不动、命中白名单则前缀 `rtk `、否则不动。返回 `{ executedCommand, rtkApplied }`。
   - `isRtkAvailable()`:`execFile("rtk", ["--version"], { env, timeout: 3000 })`,结果缓存(TTL ~60s)。
4. **bash 工具接线** `bash-tool.ts`:
   - `needsApproval`(291-307)、`isDangerousShellCommand`、allowlist 匹配**保持作用于原始命令,一行不改语义**。
   - `execute`(283-289):设置开且 rtk 可用时改写,spawn 用 `executedCommand`;工具结果 `details` 增加 `executedCommand` 与 `rtkApplied`(原始 `command` 字段保持现状),事件流因此自然携带。
   - 设置读取:沿 `buildBashTool` 的现有参数注入路径(从 `agent-toolset.ts` 构建处传入),不要在工具内部直接读 electron-store。
5. **设置 schema** `packages/rpc/src/schemas/settings.ts`:`AgentSettingsSchema` 增加 `rtk` 子对象 `{ autoRewrite: boolean }`,默认 `{ autoRewrite: true }`,遵守 zod v4 完整默认值惯例(参照现有 `sandbox`/`lsp` 子对象写法)。
6. **Token Savings 运行时状态**:`packages/rpc/src/schemas/token-savings.ts` 输出增加 `runtime: { rtkAvailable: boolean; rtkVersion?: string; ripgrepSource: "bundled" | "missing" | "system" }`;`rtk-token-savings.ts` / router 组装(rtk 版本可从 `rtk --version` stdout 解析)。
7. **Token Savings tab 控制卡** `token-savings-tab.tsx`:顶部新增一张卡:Switch「rtk 自动改写」即时生效(直接 `rpcClient.settings.update`,参照 plugins-tab 的 enable 开关模式,不进 draft/save 流);状态行展示 rtk 版本或未安装、rg 引擎来源(system/bundled/missing)。i18n key 收在 `settings.tokenSavings.*` 区域。
8. **UI 标记**:chat 时间线 bash 工具行,当结果 `details.rtkApplied` 为 true 时展示一个极小的「rtk」chip(沿用现有 compact tool 行样式惯例,原始命令展示不变)。
9. **测试**:新增 `test/main/agents/rtk-rewrite.test.ts`(白名单命中/未命中/已带前缀/`&&` 混合链/管道/重定向/子 shell/引号+`&&` 跳过/单独 `&` 跳过);`test/main/agents/bash-tool.test.ts` 增补:mock rtk 可用 + 开关开,断言 spawn 收到改写命令而 details 保留原始;`ripgrep-binary` 解析顺序单测(mock execFile)。

### ⑤ Shift+Tab 权限循环 / Mod+Shift+Tab 模式循环(执行:opus-4.8)

决策:`Shift+Tab` 从 agent mode 循环改绑 permission mode 循环(default→acceptEdits→bypass,用现成 `getNextPermissionMode`);agent mode 循环改 `Mod+Shift+Tab`;chat 模式下(permission 控件隐藏)Shift+Tab 禁用;徽章 pulse 反馈 + tooltip Kbd 标注。

1. `apps/desktop/src/renderer/routes/chat.$sessionId.tsx`:
   - 现 `useHotkey("Shift+Tab", handleAgentModeToggle, ...)`(约 1602 行)改为绑 `handlePermissionModeCycle`(新回调:`setPermissionMode(getNextPermissionMode(permissionMode))`,函数从 `@/shared/agents/permission-mode` 导入),`enabled` 条件对齐 `PromptInputPermissionModeControl` 的可交互条件(agentMode !== "chat";与该控件一致的 pending/disabled 逻辑),`ignoreInputs: false` 保持。
   - 新增 `useHotkey("Mod+Shift+Tab", handleAgentModeToggle, { enabled: !isAgentModeToggleDisabled, ignoreInputs: false })`。
2. `apps/desktop/src/renderer/components/chat/prompt-input.tsx` `PromptInputPermissionModeControl`(644-696):
   - permission mode 变化时徽章轻微 pulse(项目已有 motion;`motion` 元素 `key={permissionMode}` 初始 scale/opacity 微动画即可,幅度克制)。
   - tooltip 增加 Kbd 快捷键标注(Shift+Tab);agent mode pill 若有 tooltip 同步标注 Mod+Shift+Tab。注意 tooltip 包裹的 React Aria 交互元素需要 `tabIndex={0}`(AGENTS.md 已记)。
3. 全仓搜索现有「Shift+Tab」相关提示文案(i18n 三语言 + 代码内字面量),把指向 agent mode 的改为 Mod+Shift+Tab 语义,不要留下过时提示。
4. 验证:`vp check`;行为验证留给 fable 的 CDP 冒烟。

## Phase 2(Phase 1 验收后并行)

### ③ memory tab 样式对齐 + 记忆管理(执行:opus-4.8)

决策:硬删除 + 确认弹窗(弹窗含内容预览、destructive 按钮);卡片 5 升级 + Modal 管理器(搜索/分页/预览/删除)。

1. **后端** `apps/desktop/src/main/memory.ts`:
   - `listMemoryEntries` 扩展:`{ limit, offset, query? }`(query 对 content 做 LIKE 过滤,大小写不敏感),返回加 `total`(同条件 count),仍过滤 `archived_at IS NULL`。
   - 新增 `deleteMemoryEntry(id)`:硬删 `memory_entries` 行;通过 `runExclusiveDbWrite` 串行;显式先删 `memory_embeddings` 对应行再删主行(不赌 FK cascade 的 pragma 状态),事务内完成;返回是否删除。
   - 测试:`test/main/memory.test.ts` 增补(分页/搜索/删除含 embeddings 清理)。
2. **RPC** `packages/rpc/src/schemas/memory.ts` + `apps/desktop/src/main/rpc/router.ts`(memory 区域):`memory.list` 输入加 `offset`/`query`、输出加 `total`;新增 `memory.delete`(输入 `{ id }`)。
3. **管理 UI**:新组件 `apps/desktop/src/renderer/components/settings/memory-manager-modal.tsx`:
   - 入口:memory-tab 卡片 5 升级(总数来自 stats + 最近条目保留)加「Manage」按钮。
   - Modal(参照同文件 `EmbeddingModelPicker` 的 Modal 模式,宽度可 ~720px):搜索 Input(用 `@tanstack/react-pacer` 防抖)+ 分页列表;条目可展开/选中查看完整内容与 kind/scope/source/时间;每条删除按钮 → HeroUI `AlertDialog`(destructive)确认,弹窗内展示该条内容预览;确认后 `rpcClient.memory.delete` + 失效 list/stats 查询。
4. **样式对齐** `memory-tab.tsx`(侦察定位的六个根因,系统性统一):
   - `MemoryToolModelSelect` 去掉 `mx-0.5 max-w-xl`,与开关行同宽(必要时包进同款药丸盒行)。
   - 两个 Slider 各包进与 `MemorySwitchRow` 同款的盒(`rounded-lg border border-border bg-background/60 px-3 py-3`)。
   - 卡片内垂直节奏统一(`space-y-4`/`space-y-5` 二选一全局统一);行内边距统一 `px-3 py-3`(状态卡小瓦片可保留 `py-2`,但同卡内保持一致)。
   - `queryRewriting` 的 `ml-8` 语义缩进保留,右边缘与兄弟行对齐。
5. i18n:`settings.memory.*` 区域三语言;确认弹窗文案要把「不可恢复」讲清楚。

### ④ sidebar git 对比限定 agent 编辑(执行:codex gpt-5.6-terra xhigh)

决策:sidebar 徽章只统计当前 session agent 编辑过的文件(空则隐藏);Changes 面板默认 agent 范围 + 「全部改动」切换;文件级粒度、bash 改动盲区已接受。**不改 `router.ts`**(避免与 ③ 冲突):diff 端复用 `git.diff` 现有 `paths` 参数,status 端在 `chat-sessions.ts` 内完成。

1. **推导模块** 新建 `apps/desktop/src/main/agents/agent-edited-paths.ts`:
   - `listAgentEditedPathsBySession(sessionIds)`:一条 SQL(drizzle)join `agent_tool_calls` × `agent_runs`,条件 `chat_session_id IN (...) AND tool_name IN ('edit','write') AND state = 'finished'`,解析 `input_json.path`(缺失时回退 `output_json` 中回显的 path),按 session 去重聚合。子 agent 的 edit/write 同表,自然覆盖。
   - 路径基准:`input_json.path` 相对 `chat_sessions.project_path`。与 git 侧对齐时注意:`git status --porcelain` 输出相对 repo root,而 projectPath 可能在 repo root 之下——统一转绝对路径再比较(status 侧可用一次 `git rev-parse --show-toplevel` 拿 repo root;结果按 projectPath 缓存)。rename(`R old -> new`)按新路径匹配。
2. **status 侧** `apps/desktop/src/main/chat-sessions.ts`(129-136 附近):`listChatSessions` 拿到整树 gitStatus 后,批量查 agent 编辑集合,把每个 session 的 `gitStatus.files` 与其集合求交,生成新字段 `agentGitStatus`(结构复用 `GitProjectStatusSchema`,schema 加字段于 `packages/rpc/src/schemas/chat-sessions.ts`;原 `gitStatus` 保留不动)。
3. **sidebar** `app-sidebar.tsx` `SidebarGitStatusSummary`(251-290):改为消费 `agentGitStatus`,计数为零则隐藏(现有隐藏逻辑语义不变)。
4. **Changes 面板** `project-context-panel.tsx` + `chat.$sessionId.tsx`:
   - 面板加范围切换(默认「Agent 改动」,可切「全部改动」);agent 范围时 `gitDiffQuery` 传 `paths`(agent 编辑集合,基准与 `getGitProjectDiff` 的 pathspec 预期一致——相对 projectPath,注意与第 1 点的 repo-root 差异做一次换算);全量时不传 paths(现状)。
   - agent 范围且集合为空:显示空态提示(说明「本会话 agent 尚无落盘编辑」)+ 可切全部。
5. **测试**:新 `test/main/agents/agent-edited-paths.test.ts`(事件写入→推导,含 rename/重复/跨 run);`test/main/chat-sessions.test.ts` 增补 `agentGitStatus` 交集逻辑(含 projectPath 位于 repo 子目录的用例)。
6. i18n:面板切换与空态文案三语言,key 收在 chat/project-panel 相应区域。

## 验收(fable)

每阶段:逐 diff review → `vp check` → `vp test run` → 阶段二后 CDP 冒烟(先备份 `~/.config/etyon`;dev 启动走 forge 二进制注入 CDP flag,unset Surge 代理 env)→ 更新 `doc/`(settings.md、code-agent-tools.md、database.md/memory 相关、token savings 说明)→ 汇报,commit 由用户决定。
