# Plan: Browser Tab — 内置浏览器（右侧面板第五个 tab + agent 可控）

> Source: 2026-07-26 会话；codebase mapping 由 7 个并行 reader 完成（panel/artifact/main/rpc/terminal/agent-tools/docs），设计经 opus + codex(gpt-5.6) 对抗性 review 修订。Scope 决策（用户确认）：一步到位 agent 可控（导航、截图、读取页面）；登录态用持久化独立分区；面板内单页面视图（地址栏 + 前进/后退，无浏览器内多标签）。

## 1. 目标与范围

**In scope**

- 右侧 project-context 面板新增第五个 tab「Browser」，与 Files/Changes/Commit/Terminal 并列。
- 单页面浏览视图：地址栏、后退/前进/刷新/停止、在系统浏览器打开、加载指示。
- 登录态跨重启保留（`persist:browser` 分区），与 app renderer 完全隔离。
- Agent 工具 `browser`：navigate / read（读取页面文本）/ screenshot，走既有审批流；agent 驱动的是**用户面板里同一个页面视图**，导航实时可见。
- 每个 chat session 一个独立页面实例（main 进程持有，keyed by sessionId）。**状态保持承诺（诚实版）**：同一 session 内 tab 切换/面板折叠不丢任何状态；跨 session 最多保持 3 个活实例，更早的实例被回收后仅恢复 URL 与导航历史（SPA 内存态/表单/滚动位置不保证）。

**Out of scope（见 §8 延伸）**

- 浏览器内多标签、书签、下载管理、find-in-page、缩放控制。
- Agent 点击/输入等交互式操作（click/type/scroll）。
- 多窗口支持（沿用 terminal 的单主窗口假设）。

## 2. 现状与证据（evidence）

面板架构：

- 右侧面板是 HeroUI Resizable Panel（`id="project-context"`），由 `ChatProjectContextLayout` 渲染（apps/desktop/src/renderer/routes/chat.$sessionId.tsx:691-896）；内容要么是整面板替换的 `ArtifactPanel`（`selectedView === "artifact"`），要么是四 tab 的 `ProjectContextPanel`。
- Tab id 常量与 `ProjectContextPanelView` union 在 renderer/lib/chat/project-context-panel.ts:14-24，type guard `isProjectContextPanelView` 在 :33-39；`ChatSidePanelView = ProjectContextPanelView | "artifact"` 在 renderer/lib/chat/artifact-panel.ts:24-26。
- 展开态 tab 条：HeroUI `<Tabs>`，每个 tab 一个 `Tabs.Panel`，className `"mt-0 flex min-h-0 flex-1 overflow-hidden p-0 data-[inert=true]:hidden"`（components/chat/project-context-panel.tsx:1616-1724）；TerminalPanel 以 `key={selectedSession.id}` 挂载（:1720-1723）。
- **挂载语义（已验证）**：HeroUI `Tabs.Panel` 直接包装 react-aria-components `TabPanel` 且未设 `shouldForceMount`（node_modules/@heroui/react/dist/components/tabs/tabs.js 零命中）→ 非活动 tab panel **卸载**；但**面板折叠**只是给 Resizable Panel 加 `hidden` class，组件保持挂载于 0×0 容器（chat.$sessionId.tsx:851-853；terminal-panel.tsx:98-121 注释同证）。两种路径必须分别处理。
- 折叠态浮动工具条 `PROJECT_CONTEXT_TOOLBAR_ITEMS`（chat.$sessionId.tsx:332-353）+ `ProjectContextCollapsedToolbar`（:646-689）。
- 面板 open/view/artifact 状态均为路由组件 `useState`，不持久化（chat.$sessionId.tsx:2827-2835）。
- Tab 标签 i18n key 在 `chat.projectPanel.*`，三个 locale（en-US/zh-CN/ja-JP）都要加；`TranslationKey` 从 en-US 派生。

安全三堵墙（决定了实现路径）：

- renderer CSP `frame-src 'self'`，且 `onHeadersReceived` 把严格 CSP 盖到 **default session 所有 mainFrame/subFrame 文档**上（src/main/content-security-policy.ts:33-45, 87-99）→ iframe 方案不可行，且浏览页面必须用独立 session。
- `HARDENED_WEB_PREFERENCES` 是钉死的安全不变量（src/main/window.ts:15-28，XSS 加固 P0），`webviewTag` 未开启 → 不能用 `<webview>`，不能改主窗口 webPreferences。
- `setWindowOpenHandler` 全局 deny、`will-frame-navigate` 只放行 about:blank/srcdoc（window.ts:50-77）→ 这些针对 app 窗口的策略保持不动；浏览器的 WebContents 用自己的独立策略。

loopback 服务暴露面（review 补充验证）：

- 本机 Hono 服务的 `/rpc/*` 与 `/api/*` 均要求 bearer token（src/main/server/app.ts:42, 71），token 随机生成、0600 存储（src/main/server/local-connection.ts:13, 30）——**这是浏览页面打不进 app 的主防线**；分区隔离不是网络隔离，恶意页面完全可以对 127.0.0.1 发请求。

生命周期先例（terminal）：

- main 侧 `Map<sessionId, PtySession>` + 懒 `ensure` + snapshot 回放（src/main/terminal/pty-manager.ts:25, 82-126）。
- 可测量容器门槛 ≥100x48px + debounced ResizeObserver + 500ms 定时器兜底（Electron 遮挡节流下 ResizeObserver 停摆，lib/chat/terminal-panel.ts:27-44）。
- 高频推送走 raw ipc 通道 `terminal:data` + preload 类型校验 + unsubscribe 闭包（preload/index.ts:39-52）；请求/响应走 oRPC（schemas 在 packages/rpc/src/schemas/，router 在 src/main/rpc/router.ts:578-594）。
- pty 无 session 关闭清理（`terminal.dispose` 是死代码），只在 shell 退出或 before-quit `disposeAllPtys`（main/index.ts:143）。

Agent 运行时：

- 自有 AI SDK v7 loop 在 main 进程（src/main/agents/minimal/agent-loop.ts），工具在 `buildAgentToolset` 注册（agent-toolset.ts:176-244），审批策略在 `buildAgentToolApproval`（:265-270，approval 函数可拿到 tool input，按 action 细分审批可行），permission-mode 纯谓词在 shared/agents/permission-mode.ts（renderer 也 import，必须无 electron/window 依赖）。现有语义：`acceptEdits` 只自动放行项目内文件编辑，bash 仍需审批（permission-mode.ts:9）。
- 工具输出直接进模型历史；bash 的截断先例是**双流各自 tail**（STDOUT 9000 / STDERR 3000，bash-tool.ts:25-26）。
- **仓库内没有把图像喂回模型的先例**：imagen 工具落盘到项目 `generated-images/`（经 workspace.writeBinaryFile，非 attachments 目录），返回纯元数据，无 `toModelOutput`；`etyon-attachment://` 协议只在 default session 上服务视觉输入图（attachments.ts:329）。`toModelOutput` 在 ai@7 存在（@ai-sdk/provider-utils d.ts），但「Anthropic provider 接受 tool result 图像」未经本仓库验证。
- Plan mode 强制 readonly 并剔除 bash/artifact/imagen（agent-toolset.ts:115-133）；loop 步数保险丝 200 步。
- timeline 中只有 `imagen` tool part 有专属图像渲染组件（assistant-message-timeline.tsx:868, 908）——截图要在 UI 出图必须新增渲染分支。
- 全仓库无 CDP/playwright/puppeteer 依赖；agent server 就在 main 进程里，可直接拿 Electron API。

## 3. Design Decisions

**D1 渲染宿主：WebContentsView（排除 iframe 与 `<webview>`）。** iframe 被 CSP/导航守卫三重封死；`<webview>` 需要在钉死的 `HARDENED_WEB_PREFERENCES` 里开 `webviewTag`，违反安全不变量。WebContentsView 由 main 进程创建并 `mainWindow.contentView.addChildView()` 挂载，app 窗口的安全策略一行不动。Electron ^43 中 BrowserView 已废弃，WebContentsView 是官方路径（addChildView/removeChildView/setBounds/setVisible/setBackgroundColor 均已确认存在）。代价：原生视图浮在整个 DOM 之上，需要 bounds/可见性同步与遮挡管理（D4、§7）。

**D2 会话隔离与导航安全：单一 `session.fromPartition("persist:browser")`，白名单在动作源头强制执行。** 浏览分区与 default session 完全隔离：拿不到 `etyon-attachment://`、拿不到 app 的 CSP 注入、拿不到 preload/IPC。

- **scheme 白名单的执行位置（关键）**：`will-navigate` 只拦 renderer 发起的导航，**不拦 main 进程 `loadURL`/goBack/goForward，也不拦服务端 redirect**。因此 http(s) 白名单必须写成一个纯函数 `isAllowedBrowserUrl(url)`，在 **`browser.navigate` RPC handler 内、`setWindowOpenHandler` 分支内、每次 `loadURL` 调用前**强制执行；`will-navigate`、`will-frame-navigate`、`will-redirect` 三个事件挂同一函数作纵深防御。localhost/127.0.0.1 的 http 放行（本地 dev server 预览是核心场景）。
- 非 http(s)（file:、chrome:、mailto:、自定义 scheme）一律取消并记日志；**不做** mailto→shell.openExternal 自动转发（远程页面不应能唤起外部程序）。
- 权限：`setPermissionRequestHandler` **和** `setPermissionCheckHandler` 都装（默认全拒），加 `setDevicePermissionHandler` 与 `select-hid-device`/`select-serial-port`/`select-usb-device` 全拒。
- loopback 防御：bearer token（已存在）是主防线；另在浏览分区的 `webRequest.onBeforeRequest` 拦截对 Etyon 自身 loopback 端口的请求作纵深防御。
- webPreferences：`sandbox: true, contextIsolation: true`，**无 preload**。
- 下载：v1 保留 Electron 默认行为（系统保存对话框）。
- 每个 chat session 一个 WebContentsView（页面/历史独立——agent run 是 per-session 的，可能在后台 session 运行，共享单 view 会让 agent 抢走用户正在看的页面，因此 per-session 实例是 agent 可控的前提，不是过度设计），但共用同一个 partition（登录一次到处可用）。

**D3 实例生命周期：镜像 pty-manager + 带租约的 LRU。** `Map<sessionId, BrowserSession>`，懒 `ensure(sessionId)`。每个 WebContentsView 是一个真实渲染进程，不能 leak-until-quit：

- `BROWSER_VIEW_LRU_MAX = 3`；**驱逐资格 = 不可见 && 无进行中操作 && 非当前选中 session**，在合格集合里挑最久未用销毁。
- **租约**：manager 暴露 `withLease(sessionId, op)`——agent 工具与 RPC 的每个异步操作（导航等待、read、screenshot）持租约期间该实例不可驱逐；destroy/abort/before-quit 时所有挂起 promise 以可识别错误（`BrowserViewDisposedError`）resolve/reject，绝不悬挂。
- 销毁前记录 `{url, navigationHistory}`，重新 ensure 时恢复 URL。
- abort（agent run 中断）：除了拒绝等待 promise，还要 `webContents.stop()` 并摘除该操作的监听器——页面不能在用户眼皮下继续加载。
- `before-quit` 时 `disposeAllBrowserViews()`（挂在 main/index.ts:143 `disposeAllPtys` 旁）。

**D4 Bounds/可见性同步：显式 prop 驱动可见性，几何驱动 bounds。** 可见性**不依赖组件卸载**（折叠路径不卸载，§2）：路由层把 `isBrowserSurfaceVisible = isProjectContextOpen && selectedView === PROJECT_CONTEXT_BROWSER_TAB_ID` 作为 prop 传入 `BrowserPanel`，prop 变化即调 `browser.setVisible`。组件卸载（tab 切换/artifact 替换/session 切换）时 cleanup 里同样 `setVisible(false)` 兜底。bounds 由 renderer 度量宿主容器 rect（照抄 terminal 的 debounced ResizeObserver + 500ms 定时器兜底 + ≥100x48 门槛，0×0 视为不可见），经 `browser.setBounds` 发给 main；Resizable 拖动期间 throttle ~32ms。遮挡（overlay 压在浏览器区域上）v1 接受瑕疵，freeze-frame 方案进 PR3 打磨（§7 风险 1）。

**D5 RPC 面：oRPC 请求/响应 + raw ipc 推送，照抄 terminal 双轨。**

- schemas：`packages/rpc/src/schemas/browser.ts`（zod v4），`BrowserStateSchema = {url, title, canGoBack, canGoForward, isLoading, faviconUrl?}`。
- procedures（src/main/rpc/router.ts，`browser.*` 组）：`ensure({sessionId, url?}) → BrowserState`、`navigate({sessionId, input})`（URL 规范化：无 scheme 补 `https://`；规范化后必须过 `isAllowedBrowserUrl`，否则报错；不做搜索兜底）、`goBack/goForward/reload/stop({sessionId})`、`setBounds({sessionId, bounds})`、`setVisible({sessionId, visible})`、`dispose({sessionId})`。
- **所有 `browser.*` 处理器拒绝 `context.transport === "http"`**——router 同时暴露在 loopback HTTP 上；bearer token 是主防线，这里是纵深。
- 推送：`browser:state` 通道（did-navigate / did-navigate-in-page / page-title-updated / page-favicon-updated / did-start-loading / did-stop-loading 触发），payload 为 `{sessionId, state, initiator: "user" | "agent"}`，preload 加 `onBrowserState(cb) → unsubscribe`（运行时类型校验，terminal:data 模式）。

**D6 Agent 工具：单一 `browser` 工具，discriminated union action。** `src/main/agents/minimal/browser-tool.ts`，`inputSchema` 为 `z.discriminatedUnion("action", [...])`：

- `{action: "navigate", url}` → 白名单校验 → 等待加载完成（超时 15s 则带 partial 状态返回），返回 `{url, title}`。
- `{action: "read"}` → `executeJavaScript` 提取正文文本（document.title + innerText 派生）。截断策略（自定义，非 bash 先例）：头 9000 字符 + 尾 3000 字符，中间以省略标记连接——页面正文头部信息密度高，与 bash 的日志 tail 场景不同。
- `{action: "screenshot"}` → 先确保 view 已挂载且 bounds 有效（配合 D8 自动聚焦；必要时临时以屏外有效 bounds 挂载），`webContents.capturePage()` → 空帧守卫/重试一次 → PNG 落盘到 **attachments 内容寻址目录**（经 `etyon-attachment://` 供 renderer 展示；不写用户项目目录）→ 持久化输出为 `{path, width, height}`；模型侧经 tool 的 `toModelOutput` 提供图像内容（缩放至最长边 ≤1568px；base64 只进模型上下文，绝不进事件存储/流）。**这是全新 ground（imagen 无此先例）——PR3 第一步先 spike「toModelOutput + Anthropic tool-result 图像」round-trip，不通则降级为 read-only 方案再议**。所有 action 经 D3 的 `withLease` 执行，`abortSignal` 触发时 `webContents.stop()` + 清监听。单工具而非三工具：省工具表开销，且 200 步保险丝下动作粒度天然受控。agent 操作**该 chat session 的同一个 view**——用户所见即 agent 所为。

**D7 审批与 permission mode：只有 bypass 自动放行。**

- 对齐现有语义（`acceptEdits` 只放行文件编辑、bash 照样审批）：browser 的 `navigate`/`read`/`screenshot` 在 `default` **和** `acceptEdits` 模式都需要审批，仅 `bypass` 全放行。`read`/`screenshot` 也要审批的原因：浏览分区带持久登录态，页面内容/截图会**发送给模型供应商**——这不是本地无副作用读取。
- 审批卡文案必须明示数据流向：「页面内容/截图将对模型可见」。
- shared/agents/permission-mode.ts 加纯谓词 `needsBrowserApproval(mode)`（+ 单测）。
- "approve and remember"（per-origin 记忆）v1 不做，进延伸；只有单次审批。审批疲劳的出口是 bypass 模式。
- Plan mode：剔除 browser 工具（跟 bash 同列，navigate 有对外副作用）。
- 工具在 `buildAgentToolset` 注册、审批策略挂 `buildAgentToolApproval`（approval 函数按 input.action 细分）、`AGENT_BASE_INSTRUCTIONS` 补工具说明。

**D8 面板联动：`browser:state` 自带 initiator，无需新 stream part。** agent 发起的导航在 `browser:state` payload 里带 `initiator: "agent"`；chat 路由的订阅者据此把右侧面板切到 browser tab 并展开（复用 `requestProjectPanelReveal` 风格的意图流）。不新增 `CHAT_BROWSER_*` transient data part——view 本身共享、ipc 通道已达 renderer，事件存储里 tool call 记录已足够 run inspector 回放。

## 4. 交互分镜

| 场景 | 行为 |
| --- | --- |
| 点击 browser tab（首次） | 空态：居中地址输入框 + 提示文案；输入后 `ensure + navigate`，main 创建 view 并挂载到面板 rect |
| 切走 tab / artifact 替换 / session 切换 | 组件卸载 → cleanup `setVisible(false)`；页面进程按 D3 规则存活 |
| 折叠面板 | 组件**不卸载**（0×0 隐藏）→ `isBrowserSurfaceVisible` prop 变 false → `setVisible(false)` |
| 切回 tab / 展开面板 | `ensure` 返回当前 BrowserState 同步地址栏 → `setBounds + setVisible(true)` |
| 切换 chat session | 旧 view 隐藏；新 session `ensure`（可能命中 LRU 已回收 → 恢复 URL 重载） |
| 地址栏回车 | URL 规范化 + 白名单校验 → `navigate`；Esc 恢复为当前 URL |
| 页面内 target=_blank / window.open | deny + 白名单校验通过则在当前视图导航到该 URL |
| 非 http(s) 导航（file:、mailto:、自定义 scheme） | 取消 + 日志；不自动转发到任何外部程序 |
| 「在系统浏览器打开」按钮 | 走既有 `open-external-url` IPC（用户显式动作才外开） |
| agent 调 `browser`（default/acceptEdits 模式） | 聊天流出现审批卡（文案含模型可见性提示）→ 批准后执行，面板自动切到 browser tab（initiator=agent），用户实时看到页面 |
| agent 调 `screenshot` | 审批后：自动聚焦 browser tab → capture → timeline 里以图片卡片展示（etyon-attachment://） |
| run abort | 拒绝挂起等待 + `webContents.stop()`，页面停止加载 |
| 窗口 before-quit | `disposeAllBrowserViews()` |

## 5. 接线点

1. **`apps/desktop/src/main/browser/manager.ts`（新）** — `Map<sessionId, BrowserSession>`；`ensureBrowserView / navigate / setBounds / setVisible / disposeBrowserView / disposeAllBrowserViews / withLease`；带租约 LRU；`session.fromPartition("persist:browser")` 单例初始化（permission request+check handler、device handlers、`isAllowedBrowserUrl` 三事件挂载、window-open 策略、loopback 端口 webRequest 拦截）。`isAllowedBrowserUrl` 与 URL 规范化放 `apps/desktop/src/main/browser/url-policy.ts`（纯函数，单测）。窗口经 `getMainWindow()` 解析（rpc context 无窗口身份，terminal/ipc.ts:33 先例）。
2. **`apps/desktop/src/main/browser/ipc.ts`（新）** — `browser:state` 推送（`webContents.isDestroyed()` 防御，payload 含 initiator），`registerBrowserIpcHandlers` 在 main/index.ts:61 附近注册；`disposeAllBrowserViews` 挂 before-quit（main/index.ts:143）。
3. **`packages/rpc/src/schemas/browser.ts`（新）** — 上述 zod v4 schemas，`packages/rpc/src/index.ts` barrel 导出。
4. **`apps/desktop/src/main/rpc/router.ts`** — `browser.*` procedure 组（terminal 块 :570-602 旁边），全部先 `getChatSessionById` 校验 + 拒绝 http transport + navigate 走 url-policy。
5. **`apps/desktop/src/preload/index.ts`** — `onBrowserState(cb) → unsubscribe`，payload 运行时校验，并入 `EtyonElectronApi`（renderer/env.d.ts 同步）。
6. **`apps/desktop/src/renderer/lib/chat/project-context-panel.ts`** — `PROJECT_CONTEXT_BROWSER_TAB_ID = "browser"`；union、`isProjectContextPanelView` 补齐。（保持 node 可测、不 import rpc/window。）
7. **`apps/desktop/src/renderer/lib/chat/browser-panel.ts`（新）** — 纯逻辑：URL 显示格式化、bounds 计算、≥100x48 门槛常量、状态 reducer。单测放 apps/desktop/test/renderer。
8. **`apps/desktop/src/renderer/components/chat/browser-panel.tsx`（新）** — 工具条（back/forward/reload-or-stop、地址栏 Input、open-external）+ 视图占位容器（被度量的 rect）+ 空态/加载态；接收 `isBrowserSurfaceVisible` prop 驱动 `setVisible`，卸载 cleanup 兜底；ResizeObserver + 定时器兜底照抄 terminal-panel.tsx:309-369。
9. **`apps/desktop/src/renderer/components/chat/project-context-panel.tsx`** — 第五个 `Tabs.Tab`（~~:1645）+ `Tabs.Panel`（~~:1716，同款 className），`<BrowserPanel key={selectedSession.id} sessionId={selectedSession.id} isBrowserSurfaceVisible={...} />`。
10. **`apps/desktop/src/renderer/routes/chat.$sessionId.tsx`** — `PROJECT_CONTEXT_TOOLBAR_ITEMS` 加 browser 项（hugeicons Globe 系图标）；`isBrowserSurfaceVisible` 派生与下传；`onBrowserState` 订阅者做 initiator=agent 自动聚焦。
11. **`packages/i18n/src/locales/{en-US,zh-CN,ja-JP}/translation.json`** — `chat.projectPanel.browserView` + 浏览器工具条 aria/label + 审批文案 keys。
12. **`apps/desktop/src/main/agents/minimal/browser-tool.ts`（新）** — D6 的工具（复用 manager 单例与 withLease，abortSignal → stop()，输出截断，截图落盘 attachments + toModelOutput）；`agent-toolset.ts` 注册 + plan-mode 剔除 + `AGENT_BASE_INSTRUCTIONS` 增补；`buildAgentToolApproval` 挂审批。
13. **`apps/desktop/src/shared/agents/permission-mode.ts`** — `needsBrowserApproval` 纯谓词（+ 单测）。
14. **`apps/desktop/src/renderer/components/chat/assistant-message-timeline.tsx`（及 message-tool-trace）** — browser tool part 渲染分支：navigate/read 的紧凑 trace 行 + screenshot 的图片卡片（对标 imagen 专属渲染，:868, :908 先例）。
15. **`doc/browser.md`（落地后）** — 子系统文档（AGENTS.md:179 要求）；安全策略叙述变化同步 window.ts / content-security-policy.ts 注释块与 AGENTS.md Learned Workspace Facts。

## 6. 实施切分

**PR1 — main 进程浏览器宿主 + RPC 面（无 UI）** 接线点 1-5。验收：`vp check` + `vp test run`（url-policy 白名单/规范化、带租约 LRU 驱逐规则、状态 reducer、schema 单测）；dev 驱动（forge binary + CDP）下从 renderer console 调 `rpcClient.browser.ensure/navigate` 能在窗口上看到页面渲染于任意 bounds；**安全硬门槛**：浏览页面未被盖 app CSP（header 回显站点确认）；`file:///` 与 `chrome://` 经 navigate RPC 被拒；redirect 到非 http(s) 被拦；HTTP transport 调 `browser.*` 被拒；远程 origin 访问 `/rpc` 与 `/api/chat` 得 401（bearer 缺失）；浏览分区打 Etyon 自身端口被 webRequest 拦截；permission request/check 全拒生效。

**PR2 — 面板 tab + BrowserPanel UI** 接线点 6-11。验收：`vp check` + `vp test run`；真机 dev 驱动走查：五 tab 切换、折叠/展开（含折叠不卸载路径的 setVisible）、Resizable 拖动 bounds 跟手、session 切换实例隔离、登录态重启保留、target=_blank 在位打开、非 http(s) 被拦、外开按钮工作、空态/加载态符合 DESIGN.md tokens。

**PR3 — agent `browser` 工具 + 审批 + 面板联动** 接线点 12-14（+15 文档）。**第一步 spike**：`toModelOutput` + Anthropic tool-result 图像 round-trip 打通再继续。验收：`vp check` + `vp test run`（permission-mode 谓词、工具输出截断、url-policy 复用单测）；真机：default 与 acceptEdits 模式下三种 action 均出审批卡且文案含模型可见性提示、bypass 直通；批准 navigate 后面板自动切 browser tab（initiator=agent）实时可见；read 返回截断文本；screenshot 在 timeline 出图（事件存储无 base64，仅 path）；plan mode 无 browser 工具；run abort 后页面停止加载（stop() 生效）；LRU 驱逐不会命中持租约实例（并发单测）。

每个 PR 落地后在本文追加 `### PRn 验收记录 (YYYY-MM-DD)`。

### PR2 验收记录 (2026-07-26)

实现:opus-5(中途一次 API 529 中断,零产出后续跑完成)。静态:`vp check` 过(612/493),`vp test run` 1100/1100(含 browser-panel lib 23 个新增单测),workspace tsc 0 错(注意:apps/desktop 下裸 `npx tsc` 会报 45 个假错,须用 workspace 二进制)。真机(HMR + reload,CDP 驱动真实 UI):

- ✅ 第五个 tab「Browser」出现在 tab 条与折叠工具条(GlobeIcon)
- ✅ 空态渲染(居中 Globe + 提示 + 地址输入);输入 `example.com` → Enter → 页面加载,view target 截图验证渲染,host rect 287×816 与 view 比例一致
- ✅ 地址栏 display 格式化生效(`https://example.com` 无尾斜杠);composer 输入不受影响
- 未程序化断言(代码 review 覆盖,留用户肉眼确认):折叠路径的 setVisible(false)(manager 无 bounds/visible getter)、Resizable 拖动跟手、跨 session 实例隔离(lru 单测覆盖)、重启后登录态(persist: 分区语义)
- 实现偏差(已认可):tab 文本无图标(与现有四 tab 一致);空态/错误态整体替换 toolbar(原生 view 盖 DOM,overlay 不可行);500ms 定时器终身轮询(host 平移不触发 ResizeObserver);进度条恒占位 2px(避免加载时 rect 抖动)
- 遗留 polish:navigate 失败(罕见,normalization 已兜大多数)会把整面板置 error 态、活页面暂隐,Retry 可恢复——后续可改成 inline 提示;5 tab 在窄面板触发 tab 条滚动按钮,可观察是否需要压缩 label
- 环境备忘:app 是 hash 路由(`/#/chat/<id>`);本机 Surge 代理会劫持 CDP HTTP 发现端点,driving 须 `--noproxy` 或直连 WS

### PR1 验收记录 (2026-07-26)

实现:opus-5(fable 设计+验收,按用户指示本轮不用 codex)。静态:`vp check` 过(610 格式/490 零 lint),`vp test run` 1077/1077(含 url-policy 9 + lru 6 新增单测),tsc 双包 0 错,window.ts/content-security-policy.ts 零改动。真机 smoke(forge dev + CDP 9230,裸 WS 驱动——本机 Surge 代理会劫持 CDP 的 HTTP 发现端点,须 `--noproxy` 或直连 WS):

- ✅ `browser.ensure/setBounds/setVisible` 后 HN 完整带样式渲染于 620×520(截图验证;外部 CSS 加载成功 = 浏览页未被盖 app CSP)
- ✅ `file:///`、`chrome://`、`javascript:` 经 navigate RPC 全部 REJECTED
- ✅ HTTP transport + 合法 bearer 调 `browser.ensure` → 500,主进程日志确认消息 "Browser controls are not available over the HTTP transport";无 token → 401(bearer 主防线)
- ✅ 浏览页 fetch Etyon loopback(127.0.0.1:59702)→ Failed to fetch(webRequest 拦截生效)
- ✅ geolocation=denied、Notification=denied(request+check handler 全拒)
- ✅ `window.open('https://example.com')` → null(deny)+ 在位导航;`goBack` 回 HN,canGoForward/favicon/title 状态推导正确
- ⚠️ redirect→非 http(s) 的运行时路径未单独触发,由 will-redirect 挂载(code review)+ url-policy 单测覆盖
- 遗留观察(与本 PR 无关):启动日志有既有 `sidebarWidthPx` 校验错误(settings int 校验),待另行处理

## 7. 风险与注意

1. **原生视图 z-order**：WebContentsView 浮在全部 DOM 之上；与浏览器区域重叠的 tooltip/popover/menu 会被盖住。v1 接受（面板区域自身 overlay 少）；若实测刺眼，PR3 引入 freeze-frame：overlay 打开时 `capturePage()` 换成 `<img>` 占位并隐藏 view。设置窗口是独立 window，不受影响。
2. **liquid glass 视觉缝**：面板是半透明表面，原生 view 是不透明矩形；给 view `setBackgroundColor` 贴近 `--card` 色减弱缝隙；圆角如需要再验证 WebContentsView 圆角 API 的平台支持（不确定项，实现时确认）。
3. **内存**：每 view 一个渲染进程；带租约 LRU=3 + before-quit 清理。实测若仍偏重，降为 1（单活动实例 + URL 恢复）。
4. **焦点与快捷键**：用户点进页面后键盘焦点在 WebContentsView，app 热键（Mod+J 等）不触发。v1 接受；延伸考虑 before-input-event 转发白名单热键。
5. **agent/用户争用同一 view**：agent 导航会打断用户浏览。v1 接受（审批卡即是提示）；tool trace 完整记录动作序列。
6. **`toModelOutput` 图像 round-trip 未经验证**：ai@7 API 存在但 Anthropic provider 侧 tool-result 图像未在本仓库跑通——PR3 spike 前置，失败则 screenshot 降级（只落盘展示、不进模型）并重估 read-only 方案。
7. **`ensure` 时序竞争**：组件挂载即 ensure、ResizeObserver 稍后才有有效 bounds——view 创建后先 `setVisible(false)`，拿到首个合法 bounds 再显示，避免闪烁在 (0,0)。
8. **隐私**：浏览分区带持久登录态，read/screenshot 内容会送达模型供应商——审批文案明示（D7）；设置页可加「清空浏览数据」入口（延伸）。
9. **安全复核项（PR1 验收硬门槛）**：浏览分区无 preload、无 node、permission request+check+device 全拒；白名单在 loadURL 源头强制（不依赖 will-navigate）；`browser.*` 拒 HTTP transport；loopback 端口拦截；app 窗口的 window.ts / content-security-policy.ts 零改动。

## 8. 延伸（不在本期）

- Agent 交互动作（click/type/scroll/waitFor）：经 `webContents.sendInputEvent` 或 CDP（`webContents.debugger`）；届时审批粒度与 200 步保险丝需重新设计（批量动作）。
- per-origin「批准并记住」规则（扩展 settings 形状），缓解 D7 的审批疲劳。
- 浏览器内多标签、历史/书签、find-in-page（`webContents.findInPage`）、缩放、下载管理、切走静音（`setAudioMuted`）。
- Plan mode 提供只读 browser（研究场景）。
- chat 内 http(s) 链接点击「在内置浏览器打开」入口（当前全部走 open-external-url）。
- 设置页「清空浏览数据」（`session.clearStorageData`）。
