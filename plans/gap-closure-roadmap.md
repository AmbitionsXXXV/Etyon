# 差距收敛路线图(Gap-Closure Roadmap)

> 依据:`plans/feature-gap-research-2026-07-12.md`(2026-07-13 快照)。本文件是**项目自身路线图**(区别于 `advisor-plans/` 的 /improve 交接件)。分工惯例:fable 出设计/安全核心/验收,opus 或 codex(gpt-5.6-terra @ xhigh)做清晰规格的实现批量;真实 app 验证走 forge 二进制 + CDP(见 `project_etyon-dev-driving` 约定:unset Surge 代理 env、先备份 settings)。通用门禁:`vp run typecheck`、vitest 全绿、oxlint clean、真实 app 冒烟;涉及 DB 写的路径一律过 `runExclusiveDbWrite`(只在调用点包,不嵌套)。

## 执行波次总览

| Wave | 内容 | 预估 |
| --- | --- | --- |
| **W1(本周)** | #1 终端面板 v1 · #3 文件预览直达 · #5 AGENTS.md 注入 · #9 启用 commit | ~1 周 |
| **W2** | #2 Checkpoints/rewind · #8 Todo 工具 · #6 Vision 输入 | ~1 周 |
| **W3** | #4 MCP 客户端 · #7 web fetch/search · #15 mid-run steering | ~1 周 |
| **W4(架构)** | #10 Hooks · #11 Worktree 隔离 · #14 Best-of-N | ~1.5 周 |
| **W5** | #12 后台/定时 agents · #13 浏览器自动化 | ~1.5 周 |
| 观望 | P3:voice / agent teams / 插件打包 / review-bot 交互 / ACP / LSP | — |

波内可并行(main 进程 vs renderer 两条工作流的老办法);跨波依赖:#14→#11,#13→#6,#12 复用 Telegram 桥。

---

## #1 交互式 Terminal Panel(P0,用户点名)

**目标**:每个聊天会话有一个可输入的真终端(Alma v0.0.763 的"终端会话绑定会话线程"形态);agent 的 bash 执行先维持 headless 不变,v2 再做共享 pty。

**验收**:

- Files/Changes/Commit 旁新增 Terminal tab(第 4 tab),打开即有 shell 提示符,cwd=项目根,可跑交互式命令(vim、top、`rtk gain`)并正确渲染
- 切走 tab/切会话再回来,终端进程与屏幕内容仍在(会话级持有,非组件级)
- 窗口/面板 resize 后 cols/rows 正确(无折行错乱);app 退出全部 pty 收尸,无孤儿进程
- 快捷键 toggle(建议 Mod+J,与 permission-pill 的 Shift+Tab 体系不冲突)

**设计**:

- **依赖**:renderer `@xterm/xterm` + `@xterm/addon-fit`(+`addon-serialize` 备用);main 用 **`@lydell/node-pty`**(预编译多平台,规避 electron-rebuild;`forge.config.ts` 现为 `rebuildConfig: {}`,若换原版 node-pty 需验证 forge package 全流程)。
- **main**:`src/main/terminal/pty-manager.ts` — pty 池按 `sessionId` 键控:`ensure({sessionId, cwd, cols, rows})` / `write` / `resize` / `dispose`;shell 取 `process.env.SHELL ?? /bin/bash`,`-l` 登录态,env 复用 `getShellSpawnEnv()`(bash-tool.ts:161 同源,保证 PATH/rtk 一致);内存 ring buffer(~200KB)供重挂载回放;app quit 时 kill 全部(bash-tool.ts:173 的进程组 SIGKILL 模式照搬)。
- **IPC 分面**:控制面(ensure/resize/dispose/list)走现有 oRPC router(`main/rpc/router.ts`);**数据面不走 oRPC**——pty 输出高频小包,用专用通道 `webContents.send("terminal:data:<sessionId>")` + preload 白名单暴露,输入走 `ipcRenderer.send("terminal:input:<sessionId>")`。理由:绕开 MessagePort RPC 序列化开销,且崩溃隔离简单。
- **renderer**:`components/chat/terminal-panel.tsx` — xterm 挂载 + FitAddon + ResizeObserver;主题对齐现有 `terminal-output.tsx` 的 zinc-950 视觉;`lib/chat/terminal-store.ts`(module Map + useSyncExternalStore,同 workflow-progress-store 模式;**getSnapshot 需同时作 server snapshot**,否则测试 renderer 抛 Missing getServerSnapshot——已知坑)。
- **现有只读组件不动**:`terminal-output.tsx` 继续服务 bash 工具的 trace 回放;两者视觉统一即可。

**实现步骤**:① deps + pty-manager + 单测(spawn/resize/dispose/双会话隔离/quit 收尸)→ ② preload 通道 + oRPC 控制面 → ③ terminal-panel.tsx + store + tab 接线(`PROJECT_CONTEXT_TERMINAL_TAB_ID`,project-context-panel.tsx:1027 起的 Tabs 结构)→ ④ i18n ×3 + 快捷键 → ⑤ 真实 app 冒烟(交互命令、resize、双会话、退出无孤儿)。

**v2(单列后续项,不入本波)**:agent/user 共享 pty——bash 工具加 `runInTerminal` 模式,用 shell integration 序列(OSC 133/633,VS Code 方案)括住命令输出、取 exit code,喂回模型时仍走 9k/3k tail 预算;审批链路不变(needsShellApproval 原样)。

**风险**:node-pty 原生模块 × electron-forge 打包(用 @lydell 预编译规避,package 冒烟必须跑);ConPTY/Windows 差异(macOS 优先,Win 标注 best-effort)。 **规模**:2–3 天;fable 设计+pty-manager 核心+验收,opus 做 renderer/接线。

---

## #2 Checkpoints / Rewind(P0)

**目标**:agent 每次改动前留底,消息时间线上可一键回滚文件状态(Cursor Restore Checkpoint / CC `/rewind` 的文件维度;对话回滚不做)。

**验收**:write/edit 前自动留 checkpoint;WorkSection 工具行与消息级均有"恢复到此前"入口;恢复有确认弹窗(列出将被还原的文件与方向);恢复本身可再恢复(恢复动作也留 checkpoint);跨会话重启后历史 checkpoint 仍可用;`.alma-snapshots` 式 parent 链在 inspector 可见。

**设计**:

- `src/main/agents/checkpoints.ts` — 内容寻址 blob store:`~/.config/etyon/checkpoints/<projectHash>/objects/<sha256>`(gzip),manifest 行落 SQLite 新表 `agent_checkpoints {id, parent_id, run_id, message_id, tool_call_id, created_at, files_json:[{path, preSha|null(新文件), mode}]}`——挂在事件溯源主干旁,不复用 agent_events(查询形态不同)。
- **捕获点**:write/edit 工具 execute 内、实际落盘前抓 pre-image(单文件,便宜,精确);**bash 的变更捕获**:repo 存在时命令前后各做一次 `git status --porcelain` 差集 + 对 dirty 集合抓 pre-image(命令前抓);非 git 项目 bash 变更标注"未捕获"(诚实降级,UI 注明)。
- **恢复**:按 manifest 逆写 pre-image(经 workspace-core 的路径围栏 + mtime guard;冲突→列出让用户选 force/skip);新文件恢复=删除;恢复完成记 `checkpoint.restored` 事件,關聯 run 标 `superseded` 语义复用。
- **GC**:按 settings(`agents.checkpoints.maxAgeDays/maxTotalMb`)LRU 清理;secret-path guard 文件不入库(与 workspace-core 现有 guard 同名单)。

**步骤**:① schema + 迁移(注意 drizzle 快照基线:0011 之后正常 generate)→ ② checkpoints.ts 核心 + 单测(链式 parent/新文件/恢复冲突/GC)→ ③ 工具接线(write/edit/bash)→ ④ oRPC `agents.listCheckpoints/restoreCheckpoint` → ⑤ UI(tool 行 hover 入口 + 确认弹窗 + inspector 链视图)→ ⑥ 真实 app:改→恢复→再恢复往返。 **风险**:大文件(cap 单文件 5MB,超限记 hash 不存 blob 并 UI 提示);bash 差集竞态(命令间用户手改——mtime guard 兜底)。 **规模**:3–4 天;fable 做核心与恢复语义,opus 做 UI/RPC。依赖:无(worktree #11 的 merge-back 会想复用它)。

---

## #3 文件预览直达(P0,用户点名)

**目标**:从聊天流点一下就到文件——不做编辑器(Alma 的文件管理器也是只读,共识是"编辑权在 agent、review 权在人")。

**验收**:read/edit/write/grep 的 tool 行、Changes diff 的文件名、@-mention chip,点击都能打开右侧面板并定位(viewer 滚到行 + 高亮;Changes 聚焦对应文件 diff);Shiki viewer 支持行号锚点;diff↔viewer 可互跳。

**设计**:renderer `lib/chat/project-panel-navigation.ts` — 模块级导航 store(`requestReveal({path, line?, view: "file"|"diff"})` + useSyncExternalStore);project-context-panel 订阅并切 tab/选中文件;`project-file-code-viewer.tsx` 加 `highlightLine` prop(Shiki 行 transformer + scrollIntoView);tool trace 组件(`message-tool-trace.tsx` / StructuredToolTraceCard)给文件路径加可点样式(现有 path 展示已结构化)。 **步骤**:store → viewer 行锚 → 三处入口接线 → i18n(tooltip)→ 冒烟。 **风险**:低。**规模**:1 天;可全交 opus,fable 验收交互手感。

---

## #4 MCP 客户端(P1)

**目标**:接入 MCP 生态(stdio + Streamable HTTP),工具进现有审批管道。

**验收**:settings 新 MCP tab 可增删/启停 server(command/args/env 或 url/headers);连接状态与工具清单可见;agent 能调 MCP 工具,default 模式下每次审批、bypass 直跑;工具报错不炸 loop(结构化错误回模型);run inspector 正常显示 MCP 调用。

**设计**:

- `src/main/agents/mcp/client-manager.ts` — 基于 AI SDK `experimental_createMCPClient`(stdio/StreamableHTTP transport),按 settings 生命周期管理(懒连接 + 失败退避 + dispose);`tool-bridge.ts` 把 MCP tools 映射为 ai `tool()`(名称前缀 `mcp__<server>__`),统一 `needsApproval`:default→true,acceptEdits→true(MCP 无读写语义可判,保守),bypass→false。
- settings schema(`packages/rpc/src/schemas/settings.ts`)加 `mcp.servers[]`(zod,secrets 走现有加密存储路径);上下文膨胀防线 v1:工具描述总量 > 8KB 时 UI 警示 + 可按 server 停用(CC 2.1.7 的延迟加载留 v2)。
- OAuth 远程 server v2(先支持 headers 里带 token 的 HTTP)。

**步骤**:schema → client-manager+bridge(单测:mock transport 的连接/调用/审批/错误)→ toolset 接线(buildAgentToolset 合并,遵守 write-claims 不适用注记)→ settings tab UI → 冒烟(接一个真实 stdio server,如 filesystem/fetch)。 **风险**:Electron 主进程 spawn stdio server 的 PATH 问题(复用 getShellSpawnEnv);工具名冲突(前缀解决)。 **规模**:2–3 天;fable 设计+审批语义,opus 实现,codex 可做 settings tab 批量。

---

## #5 AGENTS.md / rules 自动加载(P1,速赢)

**目标**:agent 自动读 workspace 规则(Etyon 仓库自己就有 30KB 的 AGENTS.md 却没被自家 agent 读)。Alma 至今没做,这里可反超。

**验收**:项目根 `AGENTS.md`(fallback `CLAUDE.md`)自动注入 system prompt(独立段落,标注来源路径);超 24KB 截断 + UI/日志提示;settings 开关(默认开);无文件时零开销;修改后下一轮生效(不缓存跨轮)。 **设计**:`workspace-core.ts` 加 `readWorkspaceRules()`(路径围栏内、secret-guard 照走);`agent-chat-context`/instructions 组装处插段;子目录嵌套 AGENTS.md v2(按 touched files 就近取)。 **规模**:0.5–1 天;直接 codex 实现 + fable 验收。风险:极低,注意与 `/skill` 注入的顺序与 token 预算。

---

## #6 Vision 图片输入(P1)

**目标**:agent 能"看图"——composer 附图/粘贴 → 模型 image part(Etyon 现在能生成图却看不见图,UI 调试是硬伤)。

**验收**:composer 支持粘贴与文件选择(png/jpg/webp/gif),缩略图 chip 可删;发送后消息渲染图片(lightbox 复用 imagen 的 portal 方案);模型收到 image part 并能描述图片;不支持视觉的模型:发送前禁用附件并提示(provider catalog 的 `capabilities.imageInput` 启发式,参照 image-output.ts 的做法)。 **设计**:UIMessage file part(AI SDK 原生)贯通:composer(prompt-input.tsx 加附件区)→ chat route(已是 UIMessage 流,转换 ModelMessage 时 image part 直通)→ 持久化沿用 chat_messages(base64 或落 `~/.config/etyon` 文件 + 引用,选后者,防 DB 膨胀);read 工具读图(mime 检测 → tool result content part)与 Alma 式"独立视觉模型兜底"(v0.0.824)留 v2。 **规模**:1–2 天;fable 定 part 流转设计,opus 做 composer/渲染。风险:各 provider 对 image part 的兼容差异(amux 聚合器实测为准)。

---

## #7 Web fetch / search 工具(P1)

**目标**:agent 能查网(CC 是 0.2.53/0.2.105 就有的地板能力)。

**验收**:`webfetch(url)` 返回可读 markdown(标题/正文抽取,50KB 截断标注);`websearch(query)` 返回 title/url/snippet 列表;default 模式下 fetch 按**域名**审批(同域记忆复用 commandAllowlist 机制的 TTL 思路),bypass 直跑;SSRF 防护(拒 127.0.0.1/RFC1918/link-local,拒非 http(s));search 无 key 时工具不注册(模型看不见,避免空转)。 **设计**:`src/main/agents/minimal/web-tools.ts`;fetch 用 undici + linkedom 抽正文→turndown;search 接 BYOK provider(Brave/Exa/Tavily,settings 选一);审批走 needsApproval(payload 展示域名)。 **规模**:1–2 天;codex 实现,fable 写 SSRF 守卫与审批语义。

---

## #8 Todo list 工具(P1)

**目标**:长任务的进度骨架(CC 0.2.93"stay on track";与 plan mode 衔接)。

**验收**:`todo_write` 工具(items: {content, status: pending|in_progress|completed, activeForm}),全量替换语义;WorkSection 内渲染 checklist(进行中项打点动画,F1 组件体系内新 entry 类型);运行中实时更新(transient data part `data-todo`,id 固定复用 workflow-progress 模式);落 run 事件供 inspector 回放;plan mode 退出时引导模型把 plan 落成 todos(instructions 补一段)。 **规模**:1 天;opus 实现,fable 验收 fold 内视觉。风险:低;别加"取消/删除单项"等 CC 也没有的花活。

---

## #9 启用 Git Commit(P1,修禁用 stub)

**目标**:Changes 面板的 Commit 按钮从 `isDisabled` stub(project-context-panel.tsx ~926 ProjectCommitPanel)变成能用。

**验收**:勾选文件(默认 Agent scope 的改动集)+ message → commit 成功,面板刷新、git badge 更新;preflight:user.name/email 未配、merge/rebase 中、空选集,均给明确错误;commit 失败原样透出 stderr;不做 push/branch/PR(后续)。 **设计**:oRPC `git.commit {projectPath, paths[], message}` — main 侧 spawn git(add 指定 paths + commit),复用 git-project-status.ts 的执行环境;并发防护:与 agent bash 可能同时动 index——commit 期间持 workspace write-lock;可选 v1.5:「生成 message」按钮走当前模型(diff 摘要 prompt)。 **规模**:1 天;opus 实现。

---

## #10 Hooks 系统(P2)

**目标**:PreToolUse / PostToolUse / Stop 三事件的 file-based hooks(CC 1.0.38 / Cursor 1.7 / Alma v0.0.257 的标配层)。RTK 重写本质是内置 PreToolUse——借此泛化。

**验收**:`<project>/.etyon/hooks.json`(+ 全局 `~/.config/etyon/hooks.json`)声明 `{event, matcher(工具名 regex), command, timeoutMs}`;PreToolUse:stdin 收 JSON(tool/input/sessionId/runId),exit 0 放行、exit 2 阻断且 stderr 作为工具错误回模型、超时=放行+警告;PostToolUse:收 result,可注入附加上下文(stdout 附到 result);Stop:run 收尾通知;所有 hook 执行落事件溯源(audit);settings 总开关;**hooks 不能绕过审批**(在 needsApproval 之后、execute 之前挂)。 **设计**:`src/main/agents/hooks/{config,runner}.ts`;在 buildAgentToolset 外面包一层 tool wrapper(所有工具统一);spawn 复用 runShellCommand 的收尸/超时模式;安全注记:hooks.json 本身是用户手写文件,不做审批(等价于用户本机脚本),但 agent 写 `.etyon/hooks.json` 应触发 write 审批(现有 write 工具天然覆盖,补 secret-path 类似的敏感路径清单提示)。 **规模**:2–3 天;fable 写 runner 语义与安全边界,opus 接线。

---

## #11 Worktree 隔离并行(P2)

**目标**:delegate/workflow 支持 `isolation: "worktree"`(Cursor 2.0 / Alma v0.0.225 路线),与现有 write-claims 互补:worktree 用于"整任务并行/多方案竞争",write-claims 继续管同工作区并发。

**验收**:带该选项的子 agent 在 `~/.config/etyon/worktrees/<runId>/`(基于当前 HEAD 的 git worktree)内工作,写不需 claim;结束后未变更→自动 prune;有变更→Changes 式 diff 预览 + "应用到主工作区"(git diff → apply,冲突则列出中止);孤儿 worktree 启动回收(对应 startup recovery 模式)。 **设计**:`src/main/agents/worktrees.ts`(create/list/prune/applyDiff,spawn git 复用现有模式);delegation.ts/workflow engine 的 child workspace-core 指到 worktree 根(路径围栏随之);**非 git 项目直接拒绝该选项**(结构化错误);事件溯源记 worktree 生命周期。教训预埋:/improve 执行器曾踩"worktree 基于 main 而非 feature-HEAD"——这里明确基于**当前 HEAD**。 **规模**:3–4 天;fable 设计 merge-back 语义(危险面),opus 实现。依赖:无硬依赖;#2 落地后 applyDiff 前自动留 checkpoint。

---

## #12 后台 / 定时 agents(本机轻量版,P2)

**目标**:Cursor Automations / CC background agents 的单机版:后台跑 run + cron 触发 + Telegram 通知,不做云。

**验收**:会话可"后台运行"(窗口最小化/切会话不断流——现架构 run 在 main 进程,本就不依赖 renderer 存活,补的是 UI 语义与通知);定时任务:settings/DB 存 `{cron, sessionId|profileId, prompt, permissionMode(禁 bypass)}`,croner 触发 headless run;完成/失败/需审批 → Telegram 桥推送 + 应用内通知;需审批时 run 走既有 suspend/resume,从 app 或 Telegram 恢复;重启恢复沿用 startup recovery。 **设计**:`src/main/agents/scheduler.ts`(croner + 任务表)+ headless 入口抽取(把 /api/chat 的 agent-loop 组装复用为 `runHeadlessAgentTurn`,不经 SSE);sidebar 会话行加后台态徽章(复用"只有新消息才重排"的约束);Telegram 桥加通知型消息(现桥是对话型,补单向 notify)。 **规模**:3–5 天;fable 定 headless 抽取缝(风险点:与 F1 折叠/事件戳的耦合),opus 批量。

---

## #13 浏览器自动化(P2)

**目标**:agent 能开页面、截图、点击、读 DOM——Web 项目自验闭环(Cursor 2.0 GA / Alma Browser\* 工具组的对应物)。**依赖 #6 vision**(截图要能被看见)。

**验收**:工具组 `browser_open/screenshot/click/type/read_dom/eval`;内嵌浏览面板(artifact 面板同区,WebContentsView);导航按域名审批(复用 #7 语义),`eval` 永远单独审批;截图直接作为 image part 回模型;dev server 场景打通:agent 起服务(bash)→ 开页 → 截图 → 改代码 → 刷新复验。 **设计**:`src/main/browser/{browser-manager,browser-tools}.ts` — WebContentsView + `webContents.debugger`(CDP:Page.captureScreenshot/Input.dispatch\*/Runtime.evaluate/DOM snapshot 精简为 a11y-tree 文本);会话级单实例 v1;备选便宜路线(不建 UI):直接 CDP 驱本机 Chrome(etyon-dev-driving 已有 forge+CDP 经验),作为 fallback 记录。 **规模**:4–6 天;fable 设计工具面与审批边界,opus 实现;真实 app 验收必须过"改 UI→截图复验"闭环。

---

## #14 Best-of-N 多模型并行(P2)

**目标**:同一任务 N 模型各自 worktree 并行,评审 agent 给推荐,用户一键采纳(Cursor 2.0→2.2→3.0 的收敛形态)。**依赖 #11。**

**验收**:composer 入口(如 `/best-of-n` prompt 模板或模式开关)选 N 个模型;N 个隔离 run 并行(workflow 引擎 fan-out,each worktree);完成后并排卡片:diff 统计 + 摘要 + 评审 agent 推荐理由(2.2 的"selected agent has a comment explaining why");采纳=#11 的 applyDiff,其余 prune。 **设计**:workflow 内置预设脚本 + 专用 UI 卡(WorkSection 新 entry);评审用当前会话模型对 N 份 diff 打分。 **规模**:2–3 天(在 #11 之上);fable 设计评审 prompt 与 UI,opus 接线。

---

## #15 Mid-run Steering(P2)

**目标**:边跑边转向(CC 0.2.108),而不是排队等本轮结束。

**验收**:agent 运行中发送的消息标记为 steering(composer 已有 queue,加"立即转向"路径);loop 在**下一个 step 边界**把 steering 消息注入为 user message(自持 while-loop 的天然缝,agent-loop.ts 每轮 streamText 之间);注入后 UI 在 WorkSection 内联显示该条转向;与审批 suspend 不冲突(suspended 时 steering 落回普通队列)。 **设计**:main 侧 active-run registry 挂 `pendingSteering[]`(oRPC `agents.steerRun`);agent-loop 每 step 后消费;事件溯源记 `run.steered`。注意与既有 queuedMessages 语义分流:默认仍是排队,长按/次级按钮才是 steer(避免误触改变正在跑的任务)。 **规模**:1–2 天;fable 定注入语义(exitReason/metadata 戳不被打乱),opus 做 UI。

---

## P3 观望项(记录,不排期)

- **Voice**(Cursor 2.0 / Alma Whisper+TTS):若做,whisper.cpp 本地推理契合 local-first;等 #6 之后。
- **Agent teams / crew**(CC 2.1.32 research preview,token 密集):delegate+workflow 已覆盖大半;等上游形态稳定。
- **插件打包/marketplace**(Cursor 2.5):单人场景收益低;先做"skills+hooks+MCP 配置导出为单文件包"。
- **Review bot**:只搬交互——Changes 面板"发现问题→预填 prompt 回 composer"闭环,挂在 #3 之后做半天量级。
- **ACP 引擎接入**(Alma v0.0.109):把 Claude Code/Codex 当 provider;观察 ACP 标准化进度,已有 Cursor OAuth provider 先例。
- **LSP 工具**(CC 2.0.74):收益实但 per-language server 运维重;曾有 lsp-manager 被 pivot 删除,重做需独立立项。

---

## 里程碑对照(做完 W1–W3 后 Etyon 的矩阵位置)

三家标配的六项地板(MCP/hooks/checkpoints/web 工具/todo/vision)将只剩 hooks 在 W4;用户点名两项 W1 内清零;与 Alma 的差距收敛到:浏览器自动化、语音、后台定时(W5 覆盖前两者之一)。届时值得重跑一轮 `/improve` 级审计对齐质量债,避免走 Alma"785 版本换一身 bug"的路。
