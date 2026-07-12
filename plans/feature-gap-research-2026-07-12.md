# 主流 AI Coding Agent 功能差距调研:Alma / Cursor / Claude Code vs Etyon

> 委托日期 2026-07-12,数据快照 **2026-07-13**。Cursor 约每 1–2 周发版、Alma 几乎每日发版,本矩阵会快速过时,引用时注意时效。
>
> **方法**:deep-research workflow(5 路搜索角度、22 个来源、110 条候选 claim、25 条进入 3 票对抗验证、24 条 3-0 通过、1 条否决后经一手原文翻案)+ 3 个定向核查 agent(Claude Code CHANGELOG.md 逐字核对 + npm tarball 二分、Cursor changelog 原文提取、Alma 官网/docs/785 个 GitHub release 扫描)+ 本机取证(Alma.app 元数据、`.alma-snapshots/` 结构)。Etyon 侧现状来自同日的 repo Explore 审计(branch `feat/agent-event-sourcing`),未在本轮重复验证。 **置信度标注**:无标注 = 一手来源逐字核对;〔待查〕= 未能从一手来源确认;日期口径:Claude Code 用 npm 发布时间戳(其 CHANGELOG 不带日期),Cursor/Alma 用官方页面标注。

---

## 0. TL;DR

1. **三家标配、Etyon 全无的"地板级"功能**:MCP 客户端、hooks、checkpoints/rewind、web search/fetch 工具、todo list、vision 图片输入。这六项在 2025 年内就已成为行业地板。
2. **用户点名的两个缺口坐实**:交互式 terminal(Etyon 仅只读 ANSI 输出;Alma 早在 v0.0.144/2025-12-25 就有分 tab 交互终端)、文件预览体验(Etyon 有 Files tab 只读 viewer,缺从聊天流点击直达与 diff 定位;值得注意 **Alma 的文件管理器也是只读的**,Etyon 不必因此上完整编辑器)。
3. **Alma 是 Etyon 的直接同构竞品**(见 §1):同为 Electron 桌面 agent、local-first + memory-first、BYOK、SQLite 会话库、本地 embedding、Telegram 桥、Claude 规范 skills、artifacts。它 7.5 个月发了 785 个版本,功能面几乎全覆盖——差距清单里 Alma 列是最有参照价值的。
4. **agent 架构趋势**(§3):agent-centric UI、hooks 成为标准扩展点、plan 从模式演化为一等文件对象、worktree 隔离并行、后台/定时/移动入口、MCP→插件打包分发、ACP 跨 agent 互操作。Etyon 的事件溯源 + delegation/workflow 底座与趋势同向,缺的是外围能力件。
5. **一个反直觉信号**:Cursor Memories(1.0 beta→1.2 GA)到 2026-07 已从 docs sitemap 消失(/docs/context/memories 现在指向 Rules,无官方弃用声明)——主流在收缩"自动记忆"入口的同时,Alma 和 Claude Code(auto-memory,v2.1.59)仍在加码。Etyon 的 memory-first 路线有分歧风险,但与 Alma 同阵营。

---

## 1. 产品身份与形态

|  | Cursor | Claude Code | Alma | Etyon |
| --- | --- | --- | --- | --- |
| 形态 | VS Code 系 IDE→agent 平台 | CLI + IDE 扩展 + Desktop + Web | **Electron 桌面 agent app**(+TUI/CLI) | Electron 桌面 agent app |
| 厂商 | Anysphere | Anthropic | yetone(个人,avante.nvim 作者) | 自研 |
| 模型 | 自持 Composer + 前沿模型 | Claude 系 | BYOK 多 provider + 订阅桥接 + ACP | BYOK 多 provider |
| 起点 | 2023(2.0 转型 2025-10-29) | 2025-02-24 research preview | 2025-12-03(v0.0.1) | — |

**Alma 身份(本机 + 网络双重确认)**:`/Applications/Alma.app` bundle id `com.yetone.alma`,本机装的是 v0.0.799;官网 [alma.now](https://alma.now/)("Elegant AI Provider Orchestration";docs 自述 "Local-First, Memory-First AI Agent app"),releases 在 [github.com/yetone/alma-releases](https://github.com/yetone/alma-releases/releases)(闭源,仅发布仓)。到 2026-07-12 已发 **785 个版本**(v0.0.871)。app 内捆绑 `Alma Computer Use.app` 助手;`~/Library/Application Support/alma` 有 `chat_threads.db`(SQLite,含向量记忆)、`embedding-models`、`plugin-storage`、`artifacts`——与 Etyon 技术选型高度同构。工作区里的 `.alma-snapshots/`(parent 链式快照,"auto refresh for chat context")是它**唯一零公开文档**的机制:docs 的 checkpoints 页 404,release 仅一条侧写(v0.0.660 "Reduced UI stalls during first-message snapshots");是否有恢复 UI〔待查〕。

---

## 2. Agent 架构特性迭代时间线(重点)

### 2.1 Cursor(来源:[cursor.com/changelog](https://cursor.com/changelog) 各版本 permalink + [blog](https://cursor.com/blog/2-0))

- **1.0(2025-06-04)**:[Bugbot PR 自动 review](https://cursor.com/changelog/1-0)("Fix in Cursor" 预填 prompt 闭环);Background Agent 全量开放(0.50/2025-05-15 起早期预览);**一键安装 MCP servers + OAuth**;**Memories beta**("remember facts from conversations…stored per project",Settings→Rules 开启)。
- **1.2(2025-07-03)**:[Memories GA](https://cursor.com/changelog/1-2)(补了后台生成记忆的用户审批)。
- **1.3(2025-07-29)**:[Agent 共享原生终端](https://cursor.com/changelog/1-3)——"A new terminal will be created when needed…Click Focus to bring it up front where you can see Agent commands and also **take over**"。
- **1.5.x(2025-08 至 09 初)**:docs 出现 **AGENTS.md** 支持(Wayback 夹逼:2025-08-09 无 → 2025-09-05 有;changelog 全程未提)。
- **1.6(2025-09-12)**:[自定义 slash commands](https://cursor.com/changelog/1-6)(`.cursor/commands/*.md`,`/` 呼出)。
- **1.7(2025-09-29)**:[三件套](https://cursor.com/changelog/1-7)——**Plan Mode**("write detailed plans before starting complex tasks…run for significantly longer");**Hooks beta**(自定义脚本 observe/control/extend agent loop:审计、拦截命令、脱敏);**Sandboxed Terminals beta**(非 allowlist 命令自动进"工作区读写 + 无网络"沙箱);Browser Controls beta;Team Rules;agent 可读工作区图片文件(粘贴图 vision 更早已是基线)。
- **2.0(2025-10-29)**:[分水岭](https://cursor.com/blog/2-0)——界面重构为 **agent-centric**(agents/plans 侧边栏,可切回 classic IDE);首个自研 agentic 模型 **Composer**(宣称同智能带 4x 速度/30s 回合,系内部 Cursor Bench 口径;Composer 2 后被证实基于 Kimi K2.5 后训练);**单 prompt 最多 8 个并行 agents,git worktrees/远程机隔离**;多模型 best-of-N(**此时为人工并排挑选**);Browser GA(内嵌编辑器、选元素回传 DOM);**Sandboxed Terminals GA**(macOS 默认沙箱执行——注:本轮对抗验证曾误杀此条,后经 changelog 原文翻案坐实);**Voice Mode**(内置语音转文字 + 自定义提交词);Team Commands;多文件 review 改进。
- **2.1(2025-11-21)**:plan 生成前反问澄清;[AI code review 进编辑器](https://cursor.com/changelog/2-1)(sidepanel 找 bug);`~/.cursor/rules` 全局规则。
- **2.2(2025-12-10)**:[plan 落盘为一等文件](https://cursor.com/changelog/2-2)("Agent plans are now files that can be edited with normal tools",内嵌 Mermaid、选中 to-do 派发新 agent);**Multi-agent judging**——并行 agents 跑完后自动评审并给推荐("The selected agent will have a comment explaining why it was picked")。
- **2.5(2026-02-17)**:[Plugins](https://cursor.com/changelog/2-5)(把 skills/subagents/MCP/hooks/rules 打包为单一安装单元,[marketplace](https://cursor.com/marketplace) + `/add-plugin`);**异步 subagents**(父不阻塞,子可再生子成树,孙代封顶;停父级联停子);沙箱三档域名级网络管控(`sandbox.json`)。
- **3.0(2026-04-02)**:内置 [`/worktree` 与 `/best-of-n`](https://cursor.com/changelog/3-0) 命令(best-of-n:多模型各自 worktree 并行同任务后对比);plans 进入共享聊天。
- **3.8(2026-06-18)**:[Automations](https://cursor.com/changelog/06-18-26)(cron/事件触发云 agent,`/automate` 自然语言创建、5 类 GitHub 触发器、Slack emoji 触发);computer use 默认启用于云端 automation。
- **3.9(2026-06-22/29)**:统一 [Customize 面板](https://cursor.com/changelog/customize)(user/team/workspace 三级集中管理 plugins/skills/MCP/subagents/rules/commands/hooks 七类原语);[iOS app](https://cursor.com/changelog/ios-mobile-app)(移动端 cloud agents、语音、Remote Control 指挥本机、锁屏 Live Activities)。
- **3.11(2026-07-10)**:cloud agents 对话级 hooks(beforeSubmitPrompt/afterAgentResponse/afterAgentThought/stop/subagentStart);`/side` `/btw` 侧聊。
- 现状注:**Memories 页已从 docs sitemap 消失**(/docs/context/memories 现指向 Rules;无官方弃用声明,状态〔待查〕)。

### 2.2 Claude Code(来源:[CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) 逐字 + npm 时间戳;launch 期功能经 npm tarball 字符串验证)

- **v0.2.9 = 2025-02-24 发布日即有**:**CLAUDE.md**、**MCP**(`mcpServers`/`.mcprc`,tarball 验证;当日博文未宣传)。
- **0.2.x(2025-03 至 05)**:0.2.47(03-18)**auto-compact**("infinite conversation length");0.2.53(03-21)**WebFetch**;0.2.54(03-25)`#` 快捷记忆 + MCP SSE;0.2.50(03-19)MCP project scope(`.mcp.json` 可提交进 repo);0.2.75(约 04-18/21)**queued messages**;0.2.93(04-30)**Todo list 工具**;0.2.105(05-08)**WebSearch**;0.2.107(05-09)CLAUDE.md `@import`;0.2.108(05-13)**mid-run steering**("send messages to Claude while it works to steer in real-time")。
- **1.0.x(2025-05 至 09)**:**1.0.7(05-30)plan mode 静默首发**(changelog 只写 "Bugfixes";tarball 二分定位:1.0.6 无、1.0.7 有 `exit_plan_mode` 与 Shift+Tab 模式循环;1.0.33/06-23 首次见诸 changelog);**1.0.38(06-30)hooks**(源于社区 issue #712);1.0.41 拆 Stop/SubagentStop;1.0.27(06-17)Streamable HTTP MCP + 远程 OAuth + MCP 资源 @-mention;**1.0.60(07-24)自定义 subagents**(`/agents`);**1.0.71(08-07)Ctrl-B 后台 bash**;1.0.77(08-12)Opus Plan Mode(plan 用 Opus、执行用 Sonnet);1.0.86(08-20)`/context`;1.0.94(08-27)`/memory`、`/todos`。
- **2.0.0(2025-09-29)**:**/rewind checkpoints**(官方称"最多人要的功能",随 [Sonnet 4.5 发布](https://www.anthropic.com/news/claude-sonnet-4-5));原生 VS Code 扩展;`/usage`;SDK 更名 **Claude Agent SDK**。
- **2.0.x(2025-10 至 12)**:2.0.19(10-15)长命令自动转后台;**2.0.20(10-17)Skills**;2.0.24(10-21)**BashTool OS 级 sandbox**(Linux/Mac);2.0.28(10-27)Plan subagent;Web 版(claude.ai/code,research preview [2025-10-20](https://claude.com/blog/claude-code-on-the-web));2.0.45(11-18)`&` 前缀把后台任务发到 Web 版;**2.0.51(11-24)Desktop app**;2.0.60(12-05)background agents;2.0.64(12-10)`.claude/rules/` + auto-compact 瞬时化;2.0.74(12-19)**LSP 工具**(go-to-def/references/hover)。
- **2.1.x(2026)**:2.1.0(01-07)`/plan`、统一 Ctrl-B、MCP `list_changed`;**2.1.7(01-13)MCP tool search 默认开启**(MCP 工具描述超 context 10% 自动延迟加载,经 MCPSearch 按需发现——大规模 MCP 的解法);2.1.9 `plansDirectory`;**2.1.32(02-05)Agent teams research preview**(多 agent 协作,token 密集,需 env 开关);2.1.33 TeammateIdle/TaskCompleted hook 事件;**2.1.59(02-25)auto-memory**("automatically saves useful context…manage with /memory");2.1.83(03-24)rewind 键盘选择器、MEMORY.md 索引截断;2.1.108(04-14)`/undo` 别名;2.1.118(04-22)`/cost`+`/stats` 并入 `/usage`;2.1.141(05-13)rewind 菜单 "Summarize up to here"(保留近段、压缩早段);2.1.149(05-22)`/usage` 按 skills/subagents/plugins/每 MCP server 分类;2.1.191(06-24)`/rewind` 可穿越 `/clear`。〔待查:microcompact 引入版本——当前二进制有该字符串但 changelog 从未提及;/memory 命令确切首发版〕

### 2.3 Alma(来源:[alma.now/docs](https://alma.now/docs/guide/) + [releases](https://github.com/yetone/alma-releases/releases);docs 严重滞后于 app,release notes 为权威记录)

- **2025-12(v0.0.1–0.0.15x,发布当月)**:12-03 v0.0.1 + **v0.0.3 语义记忆**(day-one 旗舰:自动抽取→向量嵌入→自动检索,ChatGPT 式内置记忆是发布动机);12-05 Playwright 抓取;12-11 v0.0.67 **审批系统**(Accept/Accept All/Reject);12-12 v0.0.76 **workspaces**(聊天线程绑定项目目录,yetone 演示用它给 kimi-cli 提 PR);12-13 v0.0.84 **MCP 远程 HTTP**(后续 OAuth + marketplace);12-18 v0.0.107 **Claude 规范 Skills**(读 `~/.claude/skills/`、`~/.config/alma/skills/`、workspace `.alma/skills/`);12-19 v0.0.109 **ACP providers**(把 **Claude Code、Codex 直接当引擎接入**);12-20 v0.0.118 Edit/Write 工具 **git diff 视图**;12-21 v0.0.119 **auto-compaction + 实时用量指示器**;12-25 v0.0.144 **交互式分 tab 终端**(状态保留;后 v0.0.763 终端会话绑定会话线程);12-28 v0.0.152 TodoWrite。
- **2026-01 至 03**:01-20 v0.0.225 **Auto Worktree Creation**;02-06 v0.0.257 **file-based hooks**;02-09 v0.0.264 **Telegram channel**(群/贴纸/语音;后续 Discord、微信 v0.0.749/04-03、飞书 v0.0.818/06-10);02-10 `.alma/todos.md` 按线程落盘;02-17 v0.0.540 浏览器 skill 交互式上网;02-20 v0.0.590 coder subagent(集成 Claude Code CLI);03-05 v0.0.660 快照性能(`.alma-snapshots` 唯一 release 痕迹);03-19 v0.0.708 **agent crew 编排**;03-23 v0.0.725 TUI。
- **2026-06 至 07(近期密集)**:06-03 v0.0.811 Claude 订阅 OAuth(走官方 CLI);06-13 v0.0.824 **独立视觉模型**(主模型不支持图像时自动换);06-13/14 v0.0.825–826 **后台线程 + AI 总结通知**;06-20 v0.0.832 **harness/mission 系统**(Agent Crew 浮动面板、中断任务恢复)+ **应用内 AI 可控浏览器**(Codex 式);06-22 v0.0.834 图上标注→agent 改标注区域;06-23 v0.0.838 治"compaction 失忆"(全文+主模型+结构化摘要,compaction 模型可选);07-03 v0.0.848 ACP subagent 嵌套 + 真实缓存命中率面板;07-04 v0.0.851 **per-conversation worktree + 徽章**;07-06/07 Design Mode 元素选取(Figma layers 式);07-08 v0.0.858 commit UI "Select All";07-10 v0.0.863–864 Max/Ultra reasoning + **per-model effort** + 子 agent 重启自动恢复;07-11 v0.0.869 Tools+Skills 合并为 Capabilities、v0.0.870 Remote Access 页〔功能待查〕。
- 特色差异:**无 AGENTS.md 支持**(785 个 release 无一提及;用 SOUL.md 人格注入 + USER.md 身份注入替代);文件管理器只读(第三方评测);第三方口碑"数不清的 bug 和视觉小缺陷"(shellraining.xyz)——**快跑换来的质量债**,Etyon 不必照抄节奏。

---

## 3. 跨产品架构趋势(对 Etyon 的定位含义)

1. **Agent-centric UI 成为共识**:Cursor 2.0 整个 IDE 向 agent 重排;Etyon 天生就是这个形态,产品方向无需修正,差距全在能力件。
2. **Hooks 是标准扩展点**:三家全有(CC 1.0.38 → Cursor 1.7 → Alma v0.0.257),且都在多轮迭代(CC 拆事件/加 agent-teams 事件;Cursor 推到 cloud 对话级)。Etyon 的 SQLite 事件总线是天然挂载点。
3. **Plan 从"模式"演化为"一等文件对象"**:CC plan 静默上线→`/plan`→`plansDirectory`;Cursor plan mode→侧边栏对象→落盘可编辑文件→选中 to-do 派发 agent。Etyon 已有 plan mode,缺 plan 落盘与 todo 派发。
4. **并行的两条路线**:Cursor/Alma 选 **git worktree 文件系统隔离**(Cursor 2.0 8 路、/best-of-n;Alma auto→per-conversation worktree),Etyon 选**同工作区 write-claims 声明协调**。两者不互斥:worktree 适合"整任务并行/多方案竞争",write-claims 适合"单任务内并发子查询"。
5. **Checkpoints 是信任基建**:CC 官方称"最多人要的功能";Alma 用 `.alma-snapshots` 静默实现;Cursor 每条消息挂 Restore Checkpoint。行业共识:**敢让 agent 自动跑的前提是能一键回滚**。
6. **后台化 + 入口多元化**:CC Ctrl-B/背景 agent/Web `&`/Desktop;Cursor Automations(cron+事件)+ iOS;Alma 后台线程 + 通知 + 多 IM channel。Etyon 的 Telegram 桥已占住"远程入口"生态位。
7. **扩展体系走向打包与集中管理**:MCP(一键安装/OAuth/tool-search 应对上下文膨胀)→ Cursor Plugins 单元(skills+subagents+MCP+hooks+rules)+ Customize 三级面板;Alma 走 marketplace + Capabilities 合并。
8. **ACP 互操作是新变量**:Alma 把 Claude Code/Codex 当 provider 接入(含 subagent 嵌套)。对 Etyon:与其重造所有工具,可评估"接入外部 agent 作为执行引擎"的选项。

---

## 4. 功能差距矩阵

图例:✅ 有(注首发版/日期);◐ 部分;❌ 无;〔待查〕未能核实。Etyon 列来自 2026-07-12 repo 审计。

| 功能 | Cursor | Claude Code | Alma | **Etyon** |
| --- | --- | --- | --- | --- |
| 交互式终端 | ✅ 1.3 共享原生终端(2025-07-29) | ◐ CLI 本身即终端;Ctrl-B 后台 | ✅ v0.0.144 分 tab(2025-12-25) | **❌ 只读 ANSI 输出** |
| 沙箱执行 | ✅ 1.7 beta→2.0 GA macOS 默认→2.5 网络管控 | ✅ 2.0.24 BashTool sandbox(2025-10-21) | ❌/〔待查〕 | ◐ 路径围栏+危险命令分类器,无 OS 级沙箱 |
| 文件预览/编辑器 | ✅ 完整 IDE | —(CLI;IDE 扩展 diff) | ◐ 只读文件管理器 + artifacts 面板 | ◐ Files tab 只读 Shiki viewer,无聊天流直达 |
| Diff review UI | ✅ 2.0 多文件 review→2.3 split/unified | ◐ IDE 扩展内 diff | ✅ v0.0.118 工具级 diff(2025-12-20) | ✅ Changes 面板(git diff + agent scope) |
| Checkpoints/rewind | ✅ 消息级 Restore Checkpoint | ✅ 2.0.0 /rewind(2025-09-29)→摘要/穿越 clear | ✅ `.alma-snapshots`(恢复 UI〔待查〕) | **❌** |
| MCP 客户端 | ✅ ~0.45 起,1.0 一键+OAuth | ✅ 发布日即有;2.1.7 tool-search | ✅ v0.0.84(2025-12-13)+marketplace | **❌** |
| Hooks | ✅ 1.7(2025-09-29)→3.11 cloud | ✅ 1.0.38(2025-06-30) | ✅ v0.0.257(2026-02-06) | **❌** |
| Rules/AGENTS.md | ✅ .cursor/rules;AGENTS.md ~1.5.x | ✅ CLAUDE.md 发布日;.claude/rules 2.0.64 | ❌ AGENTS.md(用 SOUL.md/USER.md) | **❌ 自动加载缺失** |
| Skills | ✅ 2.5 起入 Plugins 体系 | ✅ 2.0.20(2025-10-17) | ✅ v0.0.107,Claude 规范 | ✅(Claude/Codex 规范目录) |
| 自定义 slash commands | ✅ 1.6(2025-09-12) | ✅(custom commands,更早) | ✅ Prompt Apps + 斜杠菜单 | ◐ /prompt 模板、/plan(不可自定义目录) |
| Plan mode | ✅ 1.7→2.2 plan 即文件 | ✅ 1.0.7 静默首发(2025-05-30) | ✅ EnterPlanMode 工具〔日期待查〕 | ✅ |
| Todo list | ✅ 1.7.14 interactive todos | ✅ 0.2.93(2025-04-30) | ✅ v0.0.152 + `.alma/todos.md` | **❌** |
| Subagents/并行 | ✅ 2.0 8 路→2.5 异步递归树 | ✅ 1.0.60 自定义;2.1.32 agent teams | ✅ crew/mission + ACP 嵌套 | ✅ delegate+workflow(live streaming/审批冒泡) |
| Worktree 隔离 | ✅ 2.0;/worktree、/best-of-n(3.0) | ❌(社区实践 git worktree) | ✅ v0.0.225→v0.0.851 per-conversation | ❌(write-claims 路线) |
| Best-of-N 多模型 | ✅ 2.0 手动→2.2 自动评审推荐 | ❌ | ❌/〔待查〕 | ❌(workflow 引擎可承载) |
| 后台任务/agent(本机) | ✅ | ✅ 1.0.71 Ctrl-B;2.0.60 bg agents | ✅ v0.0.825+ 通知/自动恢复 | **❌** |
| 云端/定时/移动 | ✅ Background Agent 1.0;Automations;iOS 3.9 | ✅ Web(&)、Desktop | ❌ 云;◐ Remote Access〔待查〕 | ❌(Telegram 桥为远程入口) |
| Memory 跨会话 | ⚠️ 1.0 beta→1.2 GA→docs 已消失 | ✅ auto-memory 2.1.59(2026-02-25) | ✅ day-one 旗舰(v0.0.3) | ✅ embeddings+hybrid retrieval |
| Auto-compact | ✅(上下文管理内置) | ✅ 0.2.47(2025-03-18)→瞬时化 | ✅ v0.0.119→v0.0.838 治失忆 | ✅ |
| Context 可视化 | ✅ | ✅ /context 1.0.86;/usage 2.0.0→分类账单 | ✅ 实时指示器 + 缓存命中率 | ✅ 指示器(无分类账单) |
| Web search/fetch 工具 | ✅(@web 等) | ✅ WebFetch 0.2.53;WebSearch 0.2.105 | ✅ Playwright + Web 工具 | **❌** |
| 浏览器自动化 | ✅ 1.7 beta→2.0 GA 内嵌 | ◐ Claude in Chrome(扩展) | ✅ Browser\* 工具 + 应用内 AI 浏览器 + Design Mode | **❌** |
| Vision 图片输入 | ✅ 粘贴基线;1.7 读工作区图 | ✅ 粘贴/读图 | ✅ 附件 + 独立视觉模型 + 图上标注 | **❌(仅图像生成)** |
| 图像生成 | ❌ | ❌ | ✅ 多模型直出 | ✅ imagen + composer 直出 |
| Voice | ✅ 2.0 Voice Mode(2025-10-29) | ❌(桌面〔待查〕) | ✅ Whisper STT + 本地 TTS | ❌ |
| Git commit/PR | ✅ diffs 面板 commit/PR 管理 | ✅ agent 驱动 commit/PR | ✅ commit UI + worktree 徽章(PR UI〔待查〕) | **◐ Commit 按钮是禁用 stub** |
| 权限/审批 | ✅ 3.6 起 Auto-review/Allowlist/Run-everything | ✅ default/acceptEdits/plan/bypass | ✅ v0.0.67 Accept/Accept All/Reject | ✅ 3 档 + 危险命令分类器 + 记忆 allowlist |
| IM channels | ◐ Slack(触发) | ◐ Slack(Claude Tag) | ✅ TG/Discord/微信/飞书 | ✅ Telegram |
| 插件/打包分发 | ✅ 2.5 Plugins + marketplace + Customize | ✅ plugins(marketplace) | ✅ marketplace + Capabilities | ◐ 内置插件注册表 |
| Review bot | ✅ Bugbot(1.0)+ /agent-review | ✅ /security-review、GH Action | ❌ | ❌ |
| Mid-run steering | ✅ | ✅ 0.2.108(2025-05-13) | 〔待查〕 | ◐ queued messages(轮次间投递) |

---

## 5. Etyon 缺失功能清单(P0–P3,按单人本地桌面工具校准)

> 排序原则:P0 = 用户点名或"三家标配 + 直接决定日常体验";P1 = 生态入口与"agent 感知能力";P2 = 架构升级与后台形态;P3 = 降权(团队向/锦上添花)。每项附实现切入点,供派发实现时参考。

### P0

1. **交互式 Terminal Panel**(用户点名)。参照:Alma v0.0.144 分 tab + 会话线程绑定(v0.0.763);Cursor 1.3 "agent 用你的原生终端,Click Focus 可接管" + 1.7/2.0 沙箱化。切入点:`node-pty` + `xterm.js` 面板;bash 工具与终端共享 pty 会话,复用现有进程组管理/超时/截断逻辑;agent 输出流与用户手敲同屏,approve 后命令在同一 pty 可见。
2. **Checkpoints / Rewind**。参照:Claude Code 2.0.0 `/rewind`([官方称"最多人要的功能"](https://www.anthropic.com/news/claude-sonnet-4-5))及其演进(键盘选择器 2.1.83、`/undo` 2.1.108、"Summarize up to here" 2.1.141);Cursor 消息级 Restore Checkpoint;Alma `.alma-snapshots` parent 链。切入点:事件溯源已记录全部 tool_calls——在 write/edit/bash 前对受影响文件做 content-addressed 快照(参考 `.alma-snapshots` 的链式结构),恢复 UI 挂在消息时间线(WorkSection 已有锚点);先做"文件回滚",对话回滚可后置。
3. **文件预览体验升级**(用户点名)。差距不在"有无"而在"直达":从聊天流的 tool row / diff 行点击 → 打开 viewer 并定位到行;Changes 面板文件名点击 → 聚焦该文件 diff(Cursor 2.3 同款交互)。注意 Alma 文件管理器也是只读——**不必上 Monaco 编辑器**,先做 click-through + 行号锚点 + diff/viewer 互跳。

### P1

4. **MCP 客户端**。三家全有:CC 发布日即有(2.1.7 的 tool-search 解决"工具描述吃掉上下文");Cursor 1.0 一键 + OAuth;Alma v0.0.84 + marketplace。切入点:AI SDK 自带 MCP client(`experimental_createMCPClient`,stdio + Streamable HTTP),工具直接进现有 `needsApproval` 管道;设置页加 servers 管理 tab;上下文膨胀问题按 CC 的延迟加载思路预留。
5. **AGENTS.md / rules 自动加载**。Cursor ~1.5.x 采纳 AGENTS.md(现支持根目录 + 子目录嵌套);CC CLAUDE.md 发布日即有 + `.claude/rules/`(2.0.64);**Alma 至今没有——这是 Etyon 可反超的点**(Etyon 仓库自己就躺着 30KB 的 AGENTS.md)。切入点:workspace 根 + 子目录 AGENTS.md 注入 system prompt,已有 skills 加载器可复用发现逻辑;成本一天级。
6. **Vision 图片输入**。Alma:附件 + 独立视觉模型兜底(v0.0.824)+ 图上标注改 UI(v0.0.834);Cursor 1.7 读工作区图片。Etyon 有图像生成却"看不见"——做 UI 调试类任务时是硬伤。切入点:composer 附件 → AI SDK image part;read 工具识别 image mime 直通;模型不支持视觉时按 Alma 思路换视觉模型或降级提示。
7. **Web search / fetch 工具**。CC WebFetch 0.2.53(2025-03-21)、WebSearch 0.2.105(2025-05-08);Alma Playwright 抓取 v0.0.15。切入点:fetch 工具(readability 抽取 + 长度截断)先行,search 接 Brave/Exa 等 BYOK API;走 `needsApproval` 的域名 allowlist。
8. **Todo list 工具**。CC 0.2.93(2025-04-30,"stay on track");Alma v0.0.152 + `.alma/todos.md`;Cursor plan 内 interactive todos。切入点:TodoWrite 工具 + WorkSection 内 checklist 渲染(F1 组件体系可直接放);与 plan mode 衔接——plan 产出直接落 todo。
9. **启用 git commit**(现为禁用 stub)。Alma v0.0.858 commit UI;Cursor agents-window "review and commit changes, and manage PRs"。切入点:Changes 面板已有 diff + message composer,补 `git.commit` RPC(走既有 write-lock),分支/PR 后置。

### P2

10. **Hooks 系统**。CC 1.0.38(PreToolUse/PostToolUse/Stop/SubagentStop/PreCompact…)、Cursor 1.7(审计/拦截/脱敏)、Alma v0.0.257(file-based)。切入点:在事件溯源总线上挂 PreToolUse/PostToolUse/Stop 三个事件的 file-based hooks(`.etyon/hooks.json`),同步阻塞式、退出码语义对齐 CC;RTK 重写其实就是第一个内置 hook,可借此泛化。
11. **Worktree 隔离并行**。Cursor 2.0(8 路)→3.0 `/worktree`;Alma v0.0.225→v0.0.851。与现有 write-claims 不冲突:delegate/workflow 加 `isolation: 'worktree'` 选项,用于"整任务并行/多方案竞争";落地含 merge-back UI(diff 对比 + 采纳)。
12. **后台/定时 agents(本机轻量版)**。Cursor Automations(cron + GitHub/Slack 触发);CC Ctrl-B + background agents + Web `&`;Alma 后台线程 + AI 总结通知 + 重启自动恢复(v0.0.863)。切入点:run 队列 + node-cron 定时器 + 完成后 Telegram 桥推送通知;复用 `superseded`/resume 与事件溯源,天然支持"重启恢复"。
13. **浏览器自动化**。Cursor 1.7 beta→2.0 GA(内嵌、选元素回传 DOM、自测迭代);Alma Browser\* 工具 + 应用内 AI 可控浏览器 + Design Mode 选取。Electron 切入点:内嵌 `webview`/`WebContentsView` + CDP 驱动(screenshot/click/eval 工具组),与 artifact 面板同屏;这是 Etyon 做 Web 项目自验闭环的关键件。
14. **Best-of-N 多模型并行**。Cursor 2.0(手动挑)→2.2(自动评审 + 推荐理由)→3.0 `/best-of-n`(各自 worktree)。切入点:workflow 引擎已能多模型 fan-out,补"并排 diff + 评审 agent 推荐 + 一键采纳"的 UI;依赖 #11 worktree。
15. **Mid-run steering(真·打断注入)**。CC 0.2.108 起"边跑边发消息实时转向"。Etyon 的 queued messages 是轮次间投递;loop 是自持 while,可在 step 边界消费 steering 队列注入 user 消息。低成本高感知。

### P3(降权/记录)

16. **Voice 输入**(Cursor 2.0 Voice Mode;Alma Whisper+TTS):单人桌面可后置;若做,whisper.cpp 本地化符合 Etyon 的 local-first。
17. **Agent teams / crew**(CC 2.1.32 research preview,token 密集;Alma mission/crew):Etyon 的 delegate+workflow 已覆盖大半价值,观望。
18. **插件打包/marketplace**(Cursor 2.5 Plugins、Customize 三级面板):单人场景收益低;把 skills/hooks/MCP 配置做成可导出的单文件"包"即可。
19. **Review bot**(Bugbot、/agent-review):团队向;但"发现 → 一键回 chat 修复"的闭环值得搬进 Changes 面板(预填 prompt 跳转 composer)。
20. **移动/远程入口增强**(Cursor iOS Remote Control):Telegram 桥已占位;可加"后台任务完成推送"(并入 #12)。
21. **ACP 引擎接入**(Alma v0.0.109:Claude Code/Codex 当 provider,v0.0.848 subagent 嵌套):趋势记录;Etyon 已有 Cursor OAuth provider 先例,ACP 是同方向的更标准形态。
22. **LSP 工具**(CC 2.0.74 go-to-def/references/hover):对 agent 改代码质量有实益,依赖 per-language server 管理,成本高;记录待议(注:仓库曾有 lsp-manager,pivot 时删除)。

### 已否决/需谨慎引用的说法

- ~~"Cursor 2.0 起沙箱终端 GA、macOS 默认"被否决~~ → **翻案坐实**:changelog/2-0 原文 "sandboxed terminals are now GA for macOS. We now run agent commands in the secure sandbox by default on macOS with 2.0."(本轮对抗验证 1-2 误杀,直接抓原文裁决)。
- Composer "4x 快"系 Cursor 内部基准(Cursor Bench 同智能带),非第三方;Composer 2 被证实基于 Kimi K2.5 后训练,Composer 1 底模未披露。
- Cursor 2.0 的 best-of-N **发布时是人工挑选**,自动评审是 2.2 才加的——二手来源普遍混淆。

### 开放问题

- Alma `.alma-snapshots` 是否有恢复 UI(docs 404、release 无痕);其 Remote Access 页(v0.0.870)功能不明。
- CC microcompact 引入版本(二进制有、changelog 无);`/memory` 命令确切首发版。
- Cursor Memories 的真实状态(docs 消失但无弃用声明)。
- Cursor plan mode 1.7 首发时的确切形态(changelog 仅一句,可编辑 plan 文件等能力的到位时间不明)。

---

## 6. 专节:两个已确认缺口的主流实现形态

### 6.1 交互式 Terminal Panel

- **Cursor 的形态**(渐进三步,可直接抄作业):① 1.3 "共享原生终端"——agent 需要时自动开终端、后台运行、用户点 Focus 可**接管**同一会话([changelog/1-3](https://cursor.com/changelog/1-3));② 1.5 终端左置 + 阻塞时边框动画提示、拒绝后自动聚焦输入框;③ 1.7→2.0 沙箱化:非 allowlist 命令自动进"工作区读写 + 无网"沙箱,失败可一键提权重跑;3.6 起权限模式简化为 Auto-review/Allowlist/Run Everything([docs/agent/tools/terminal](https://cursor.com/docs/agent/tools/terminal),含 inline terminal output)。
- **Alma 的形态**:独立分 tab 终端(v0.0.144),状态跨切换保留,v0.0.763 起**终端会话绑定到每个会话线程**——这对 Etyon 的 per-session 架构是最贴切的参照。
- **技术底座**(通识,非本轮验证结论):`xterm.js`(VS Code 同款渲染层,GPU 加速、ANSI 全支持)+ `node-pty`(主进程 pty fork,IPC 转发数据流)。Etyon 具体建议:bash 工具与终端面板**共享 pty 会话池**——approve 后的命令在可见终端里执行,用户可随时接管输入;只读 `terminal-output.tsx` 保留作历史回放,live 会话走 xterm;沙箱可先复用现有危险命令分类器,OS 级(sandbox-exec/Seatbelt)后置。
- **Warp 的启示**([block model](https://www.warp.dev/blog/block-model-behind-warps-agentic-development-environment)):把终端输出结构化为"块"(命令+输出+状态一体),agent 与人共用同一块流——与 Etyon 的 StructuredToolTraceCard 理念同源,live pty 块化后两套 UI 可统一。

### 6.2 文件预览 / 编辑器集成

- **Cursor**:完整 IDE,预览即编辑器;对 Etyon 有参照意义的是 review 动线——diff 流式渲染("The diff view shows changes as they happen")、change summary 点文件名聚焦该文件(2.3)、消息级 Restore Checkpoint 兜底、agents-window 的"diffs view: review and commit changes"一体化([docs/agent/agents-window](https://cursor.com/docs/agent/agents-window))。
- **Alma**:**文件管理器只读**(第三方评测),重预览而非编辑;可编辑面收敛到 artifacts(HTML/React/Mermaid/SVG + Bun/Vite dev server,v0.0.868 可拖拽/全屏面板)+ "Annotate to Edit"(图上圈注→agent 改对应区域)。
- **对 Etyon 的结论**:主流桌面 agent 产品(Alma)也没有做完整编辑器——**编辑权在 agent、review 权在人**是共识分工。优先级应是:聊天流 tool row/diff → viewer 行级定位的 click-through(P0 #3);viewer 与 Changes diff 互跳;编辑能力(Monaco/CodeMirror)仅在确有手改需求时再议(P3)。

---

## 7. 来源(主要)

- Cursor:[changelog](https://cursor.com/changelog)(1-0/1-2/1-3/1-6/1-7/2-0/2-1/2-2/2-5/3-0/06-18-26/customize/ios-mobile-app/side-chat)、[blog/2-0](https://cursor.com/blog/2-0)、[blog/composer](https://cursor.com/blog/composer)、[docs](https://cursor.com/docs)(rules/plan-mode/subagents/worktrees/hooks/sandbox/terminal/agent-review/agents-window)、[help/ai-features](https://cursor.com/help/ai-features/agent)
- Claude Code:[CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)(raw,0.2.21→2.1.207)、npm registry time map(`@anthropic-ai/claude-code`,launch 2025-02-24)、npm tarball 字符串验证(0.2.9/1.0.6/1.0.7 等)、[docs](https://code.claude.com/docs/en/)(hooks/checkpointing/memory/mcp/permission-modes)、[Sonnet 4.5 发布文](https://www.anthropic.com/news/claude-sonnet-4-5)、[Claude Code on the Web](https://claude.com/blog/claude-code-on-the-web)
- Alma:[alma.now](https://alma.now/) + [docs](https://alma.now/docs/guide/)(workspaces/tools/memory/mcp/skills/artifacts/providers/settings/reasoning/prompt-apps)、[yetone/alma-releases](https://github.com/yetone/alma-releases/releases)(785 releases,GitHub API)、本机取证(`com.yetone.alma` v0.0.799、`.alma-snapshots/`、Application Support)、yetone 推文(launch/workspace/自操作)、第三方评测 [shellraining.xyz](https://shellraining.xyz/docs/dev-tools/alma.html)、[80aj.com](https://www.80aj.com/2026/01/05/yetone-alma-ai-client/)
- 其他:[xterm.js](https://github.com/xtermjs/xterm.js/)、[Warp block model](https://www.warp.dev/blog/block-model-behind-warps-agentic-development-environment)、[InfoQ Cursor hooks](https://www.infoq.com/news/2025/10/cursor-hooks/)
