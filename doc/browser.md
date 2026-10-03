# Etyon 内置浏览器（Browser Tab）

右侧 project-context 面板的 Browser surface（动态 tab session 类型之一，见 `doc/chat-project-context.md` 的「右侧面板动态 Tab Sessions」）可以重复创建。每个实例都是主进程持有的真实浏览器视图：用户可以直接浏览（地址栏、前进/后退、刷新）；该类型的主实例仍由 agent 的 `browser` 工具共同驱动，额外实例是用户独立浏览 session。设计与取舍见 `plans/browser-tab.md`。

## 1. 架构

**渲染宿主：`WebContentsView`（不是 iframe，也不是 `<webview>`）。**

- app 窗口的 renderer CSP 是 `frame-src 'self'`，且 `onHeadersReceived` 会把严格 CSP 盖到 default session 的所有文档上（`src/main/content-security-policy.ts`）→ iframe 方案不可行。
- `HARDENED_WEB_PREFERENCES`（`src/main/window.ts`）是钉死的安全不变量，`webviewTag` 未开启 → `<webview>` 方案不可行。
- `WebContentsView` 由主进程创建并 `mainWindow.contentView.addChildView()` 挂载，app 窗口的安全策略一行不动。代价是原生视图浮在全部 DOM 之上（tooltip/popover 会被盖住），并且需要 renderer 侧度量宿主矩形后同步 bounds/可见性。

**会话隔离：单一 `session.fromPartition("persist:browser")`。**

- 与 default session 完全隔离：拿不到 `etyon-attachment://`、拿不到 app 的 CSP 注入、拿不到 preload/IPC。
- webPreferences 固定为 `{ contextIsolation: true, sandbox: true }`，**无 preload、无 node**。
- 登录态跨重启保留（`persist:` 前缀），且所有 chat session 共用这一个 partition——登录一次到处可用。

**三道安全墙（`src/main/browser/manager.ts`）：**

1. **URL 白名单**：`isAllowedBrowserUrl` 只放行 `http:`/`https:`（因此 `http://localhost` 本地 dev server 可预览）。执行位置是 `beginBrowserLoad` —— **每一次 `loadURL` 之前**，因为 `will-navigate` 系列事件看不见主进程发起的导航。`will-navigate` / `will-frame-navigate` / `will-redirect` 三个事件挂同一个纯函数作纵深防御，`setWindowOpenHandler` 一律 deny（白名单通过则在当前视图内导航）。
2. **权限全拒**：`setPermissionRequestHandler` + `setPermissionCheckHandler` + `setDevicePermissionHandler` 全部拒绝，`select-hid-device` / `select-serial-port` / `select-usb-device` 全部取消。
3. **loopback 拦截**：浏览分区的 `webRequest.onBeforeRequest` 拦掉指向 Etyon 自身本机端口的请求。分区隔离不是网络隔离，恶意页面完全可以对 127.0.0.1 发请求；这是 bearer token（`/rpc/*` 与 `/api/*` 的主防线）之外的纵深。

URL 规范化与白名单是纯函数，放在 `src/main/browser/url-policy.ts`（无 Electron 依赖，node 下单测）。

## 2. RPC 面

请求/响应走 oRPC，高频状态推送走 raw ipc —— 照抄 terminal 的双轨。

- schemas：`packages/rpc/src/schemas/browser.ts`（`BrowserStateSchema = {canGoBack, canGoForward, faviconUrl?, isLoading, title, url}`）。
- procedures（`src/main/rpc/router.ts` 的 `browser.*` 组）：`ensure`、`navigate`、`goBack`、`goForward`、`reload`、`stop`、`setBounds`、`setVisible`、`dispose`、`pickElement`、`cancelElementPick`（后两个见 §6）。
- 输入里的 `sessionId` 是具体 runtime session；额外 tab 同时传 `chatSessionId`，router 用 owner chat session 做权限与存在性校验，再对独立 runtime ID 执行操作。旧的主实例调用不传该字段时仍以 `sessionId` 兼容。
- **所有 `browser.*` 处理器拒绝 `context.transport === "http"`**：router 同时暴露在本机 HTTP 上，bearer token 是主防线，这里是纵深。
- 推送：`browser:state` 通道，payload 为 `{initiator, sessionId, state}`，preload 侧 `onBrowserState(cb) → unsubscribe` 带运行时类型校验。`initiator: "agent"` 是 chat 路由自动切到 browser tab 并展开面板的唯一触发源（`routes/chat.$sessionId.tsx`）。

renderer 侧：`components/chat/browser-panel.tsx` 是工具条 + 被度量的空容器，纯逻辑（bounds 取整、≥100×48 门槛、地址显示格式化、状态 reducer）在 `lib/chat/browser-panel.ts`。

## 3. 生命周期：租约 + LRU

每个 chat session 有一个与 agent 共享的主 `WebContentsView`，并可按右侧 tab 创建额外用户实例。每个视图是一个真实渲染进程，因此不能 leak-until-quit：

- `BROWSER_VIEW_LRU_MAX = 3`；**驱逐资格 = 不可见 && 无进行中操作 && 非当前选中 session**（`src/main/browser/lru.ts`，纯函数 + 单测）。
- **租约**：`withBrowserLease(sessionId, op)` 在 op 期间把视图钉住不可驱逐，并让 op 与"视图被销毁"竞速——销毁时所有挂起 promise 以 `BrowserViewDisposedError` reject，绝不悬挂。agent 工具的每个动作都跑在租约内。
- 驱逐前记录 `lastUrl`，下次 `ensure` 时恢复 URL（SPA 内存态/表单/滚动位置不保证）。
- 关闭 Browser tab 会显式 `dispose` 对应视图；切换 chat 或离开页面时释放额外实例。主实例继续保留原有跨 chat 切换恢复行为。
- `before-quit` 调 `disposeAllBrowserViews()`（挂在 `disposeAllPtys` 旁边）。

## 4. Agent 工具 `browser`

`src/main/agents/minimal/browser-tool.ts`，单个工具 + `z.discriminatedUnion("action", …)`，注册在 `buildAgentToolset` 中，门槛与 bash 相同（可写 profile 才有；plan mode 把 profile 翻成 readonly，因此自动剔除），另外要求存在 chat session（工具驱动的就是这个 session 的视图）。

| action | 行为 | 输出 |
| --- | --- | --- |
| `navigate` | `resolveAllowedBrowserUrl` 规范化 + 白名单（失败抛描述性错误）→ 以 `initiator: "agent"` 加载（面板自动聚焦）→ 等待加载完成，15s 超时返回 partial 而非报错 | `{action, status: "aborted"｜"loaded"｜"timeout", title, url}` |
| `read` | isolated world 读取可见 `innerText`、标题和本轮元素 refs；名称关联 label / `aria-labelledby`，输出 textbox、checkbox、radio、combobox 等角色。非 password 文本字段 value 最多 1000 字符，checkbox / radio 返回 checked | `{action, elements, text, title, truncated, url}` |
| `screenshot` | 必要时临时给视图屏外有效 bounds + 可见性（`withPaintableBrowserView`）→ `capturePage()` → 空帧重试一次 → 最长边缩到 ≤1568px → PNG 写入 attachments 内容寻址目录 | `{action, height, imageUrl, path, title, url, width}` |
| `click` | 校验本轮 ref、节点仍连接、未禁用、可见及中心点未被其他元素覆盖，再发原生 mouse down / up | `{action, title, url}` |
| `type` | 校验真实焦点及可编辑性，以原生 select-all / insertText 输入；普通 input / textarea append 保留旧值并整体写入，contenteditable append 将 Range 移到末尾保留既有 markup；总输入最多 20000 字符 | `{action, title, url}` |
| `scroll` | 有界滚动页面或指定本轮 ref；每轴最多 10000 像素 | `{action, title, url}` |
| `press` | 聚焦可选 ref 后发送 Enter、Tab、方向键等固定枚举，原生键码映射不暴露任意组合键 | `{action, title, url}` |

要点：

- **截断策略是页面专属的**（`src/main/browser/page-content.ts`）：头 9000 + 尾 3000 字符，中间插省略标记。刻意不同于 bash 的双流 tail —— 日志的信息在尾部，网页的信息在头部。
- **abort**：run 被中断时 navigate 不只是停止等待，还会 `webContents.stop()` 并摘掉监听器——页面不能在用户眼皮下继续加载。
- **截图落盘在 attachments 目录**（`persistAttachmentBytes`，`src/main/attachments.ts`），不是用户项目目录：它是 app 产物不是项目产物，而且 renderer 只能通过 `etyon-attachment://` 协议读它。**base64 永远不进持久化输出、不进事件存储、不进 UI 流**。
- **视图丢失**：`BrowserViewDisposedError` 被翻译成一句人话错误返回给模型。
- **输入确认**：email / number 使用原生编辑命令，不调用不适用的 DOM selection API；select、checkbox、radio 拒绝 `type`，通过 `click` / `press` 操作。`append` 和 replace 都检查 readonly、焦点重定向及节点脱离。页面校验 / 格式化导致最终值与请求不同，会报告错误并让模型重新读取。
- **窗口归属**：manager 保存创建视图时的真实 owner，paintable callback 将它传入交互层。原生鼠标 / 键盘输入要求视图已有可绘制 surface 且该 owner 已激活；隐藏或失焦时提示用户聚焦 Etyon，不自动抢其他窗口的焦点，也不把新的全局 main window 当作旧 view 的 owner。
- **脚本边界**：固定交互函数及其 helper 在同一个序列化 factory 内；参数通过 JSON 编码，没有任意 `eval` action。打包 / minify 后仍以同一 bounded surface 工作。
- **模型 JSON**：元素元数据明确映射成 JSON 字段，省略 `undefined`；保留 `checked: false` 等有效状态，value 最多 1000 字符，password 字段的 value 在模型输出层再次排除。

### 审批语义

`shared/agents/permission-mode.ts` 的 `needsBrowserApproval(mode)` 只在 `bypass` 返回 false —— `default` **和** `acceptEdits` 都要审批。这与 bash 对齐而非与文件编辑对齐：`acceptEdits` 只自动放行项目内文件编辑，而浏览器带着用户的持久登录态，read/screenshot 的内容会**发送给模型供应商**，不是本地无副作用读取。没有"批准并记住"，审批疲劳的出口是 bypass 模式。

审批策略挂在 `buildAgentToolApproval` 的 `browser` 项上；聊天里的审批卡（`components/chat/message-tool-trace.tsx` 的 `BrowserToolCard`）显示 action + 目标 URL，并**在卡片正文里**明示"页面内容/截图将发送给模型"（i18n key `chat.browserTool.modelVisibilityHint`）——这个后果不该藏在详情折叠里。

### 供应商门控的截图视觉

`toModelOutput` 决定截图以什么形态进入模型上下文，门控在 `buildAgentToolset`：

```
effectiveModelId = profile.preferredModel || sessionModelId
supportsToolResultImages = getModelProviderId(effectiveModelId) === "anthropic"
```

- **原生 anthropic provider**：返回 `{type: "content", value: [{type: "text", …}, {type: "file", data: {type: "data", data: <base64>}, mediaType: "image/png"}]}`，`@ai-sdk/anthropic` 会把 file part 转成原生 `tool_result` 图像块。
- **其他所有 provider**（包括 OpenAI-compatible 的 chat-completions 中继）：返回 `{type: "json", value: output}`。这不是保守起见——chat-completions 路径会把 content 输出 `JSON.stringify` 成纯文本，真发图就等于把 base64 垃圾灌进上下文。
- 模型 id 没有可识别的 provider 前缀时一律走 JSON 分支（保守默认）。
- base64 是在 `toModelOutput` 里按需从 attachments 读回来的，读取路径经 `resolveAttachmentRequestPath` 的目录包含校验，因此被手改过的历史记录也无法让它读到 attachments 目录之外的文件。
- 注意：`convertToModelMessages` 在本仓库不传 `tools`（`agents/agent-chat-context.ts`），所以图像只在**产生它的那一轮**留在上下文里；后续轮次的历史里它退化成元数据 JSON。

## 5. 聊天时间线渲染

- 三种 action 都以紧凑 trace 行出现在 work section 里（标题 = action，描述 = 目标 URL），纯取值逻辑在 `renderer/lib/chat/browser-tool-ui.ts`（node 可测）。
- 截图**额外**在消息正文下方渲染成图片卡片（对标 imagen），src 直接是 `etyon-attachment://` —— renderer CSP 的 `img-src` 允许该 scheme。之所以两处都渲染：审批必须发生在 work section 的 trace 行上，而 work section 在 run 结束后会折叠，图片得留在外面。

## 6. 元素选取（用户侧）

工具条上的选取 toggle（i18n `chat.projectPanel.browserPickElement`）把页面里的一个元素捞进 composer，是**用户动作**，与 agent 的 `browser` 工具无关。

- 页面侧注入：`src/main/browser/element-picker.ts` 的 `PICKER_SCRIPT` 是一段纯浏览器 JS 字符串，经 `executeJavaScriptInIsolatedWorld(1013, …)` 注入。分区没有 preload，所以这是页面与 main 之间唯一的通道；隔离 world 与页面共享 DOM（高亮框可见）但不共享 JS 全局，`globalThis.__etyonCancelElementPick` 这个取消钩子在页面 console 里看不到。
- 脚本装 capture 阶段的 `mousemove`/`click`/`keydown` + 一个 `pointer-events:none` 的 fixed 高亮框（左上角 tag 徽标），并把 `documentElement` 的 cursor 改成 crosshair；点击 `preventDefault + stopImmediatePropagation`（页面链接不跳转），Esc 取消；无论哪条路径都在 `try/finally` 里先卸监听 + 移除 overlay + 还原 cursor + 删钩子再 resolve。
- main 侧 `runElementPick` 跑在 `withBrowserLease` 内，与主 frame `did-start-navigation`、`destroyed`、120s 超时竞速；取消路径尽力调一次页面钩子做清理再返回 `null`。同 session 重复选取先取消旧的（脚本开头也会自我取消上一轮，双保险）。
- selector 采集：id 唯一则短路成 `#id`，否则 `nth-of-type` 路径向上最多 5 层。
- RPC：`browser.pickElement({sessionId}) → {element|null}`（长挂起，MessagePort 无调用超时）与 `browser.cancelElementPick`，同样拒绝 HTTP transport。
- 传给 composer：新 mention kind `webElement`（`{label, selector, url, title, tagName, innerText, outerHtml, styles}`，`rect` 只留在 pick 结果里）。面板 → composer 走模块级 store `renderer/lib/chat/web-element-capture.ts`（仿 project-panel-navigation），PromptInput 订阅后插入既有 `projectMention` 节点 + 尾随空格。chip 的 label 在 renderer 生成（`tag#id.firstClass`，≤40 字符）。
- 模型上下文：`agents/agent-chat-context.ts` 把 webElement mention 拼成独立 system 块（url/title/selector/outerHtml 代码块/innerText/styles），chat 与 agent 两条路径都经 `prepareAgentChatContext`，因此一处生效。payload 自带，不读 project snapshot。

## 7. 登录态导入（用户侧）

地址栏下方的导入提示条与工具条上的「导入登录态」（i18n `chat.projectPanel.cookieImportAction`）把本机 Chromium 系浏览器 profile 里的 cookie 导进 `persist:browser`，免去逐站重登。提示条可关闭，导入成功后本 Browser tab 内不再显示；工具条入口始终保留。设计见 `plans/browser-cookie-import.md`，实现全在 `src/main/browser/cookie-import.ts`（renderer 只拿计数与源元数据）。

- **平台与支持面**：仅 macOS + Chromium 系（Chrome / Edge / Brave / Arc / Chromium，常量表 `CHROMIUM_BROWSERS` 驱动）。其他平台抛类型化的 `unsupported-platform`。profile 枚举 = 根目录下 `Default` 与 `Profile N`（须有 `Cookies` 文件），显示名取 `Local State` 的 `profile.info_cache[dir].name`，读不到回退目录名。
- **读取**：`Cookies` 先 `copyFile` 到 `app.getPath("temp")` 再用 `@libsql/client` 打开（运行中的浏览器持写锁；源 profile 只读、绝不写回），用完连副本的 `-wal`/`-shm` 一起删。客户端必须 `intMode: "bigint"` —— `expires_utc` 是 1601 起的微秒数，超过安全整数范围，默认 number 模式会直接抛。
- **解密**：Keychain 口令经 `security find-generic-password -w -s "<Browser> Safe Storage" -a "<Browser>"` 读出（**首次会弹系统授权框**），PBKDF2-SHA1(`saltysalt`, 1003, 16B) 派生 key（按浏览器缓存在进程内存，不持久化）；`v10` 前缀 → AES-128-CBC（IV = 16 个空格）→ 手工剥 PKCS#7 → 前 32 字节等于 `SHA256(host_key)` 时再剥（Chrome 130+，比对而非假设，兼容旧格式）。非 `v10`（Windows DPAPI / app-bound）与坏填充逐条返回 null 并计入 `failed`。
- **写入**：`session.fromPartition("persist:browser").cookies.set` 逐条；`host_key` 带前导点 → 传 `domain`（域 cookie），否则 host-only 不传；`expires_utc === 0` 保持 session cookie；`samesite -1/0/1/2 → unspecified/no_restriction/lax/strict`，其中 `no_restriction` 被 Electron 要求必须 secure，因此强制 secure 并按 https 拼 url。单条失败只计数不中断，返回 `{failed, imported, total}`。
- **RPC**：`browser.listCookieSources({chatSessionId?, sessionId}) → {sources}`（**不碰 Keychain**，打开对话框零弹窗；`cookieCount` 读不到时为 null 而非丢掉该 profile）与 `browser.importCookies({chatSessionId?, domainFilter?, sessionId, sourceId})`，同样过 `assertBrowserRpcAccess`。`sourceId` 形如 `chrome:Default`，落地时重新枚举匹配，调用方给的路径永远不会进 fs。
- **错误面**：`keychain-denied` / `keychain-missing` / `source-missing` / `unsupported-platform` 是类型化 reason。oRPC 会把普通 Error 抹成 "Internal server error"，所以 router 把它们翻成带 `data.reason` 的 `ORPCError`，renderer 侧 `lib/chat/cookie-import.ts`（node 可测）再翻成文案。
- **对话框**（`components/chat/browser-cookie-import-dialog.tsx`）：按浏览器 / profile 分层显示源、cookie 数量与单选状态，并提供可选域名过滤（`host_key` 子串）；两条后果文案**不折叠**（导入后经批准 agent 可读这些登录内容；首次导入会请求钥匙串权限）。对话框打开期间面板把原生视图 `setVisible(false)` —— 视图压 DOM，否则弹窗会被页面盖住。

## 8. 不可回退的不变量

改这块代码时，以下任何一条被破坏都属于安全回归：

1. `src/main/window.ts` 的 `HARDENED_WEB_PREFERENCES` 与 `src/main/content-security-policy.ts` 的 CSP 注入**不因浏览器功能而放宽**（PR1/PR2/PR3 对这两个文件零改动）。
2. 浏览分区不得有 preload、不得开 node、权限 request/check/device 全拒。
3. 白名单在 `loadURL` 源头强制（不能只依赖 `will-navigate`），且新增的导航入口必须走 `beginBrowserLoad` 这个唯一 chokepoint。
4. `browser.*` RPC 拒绝 HTTP transport；浏览分区不得访问 Etyon 自身 loopback 端口。
5. 所有 agent 侧异步操作在 `withBrowserLease` 内执行，销毁时以 `BrowserViewDisposedError` 结算，不留悬挂 promise。
6. 截图 base64 不得进入持久化输出、事件存储或 UI 流；只在 `toModelOutput` 里按需读回，且只对原生 anthropic provider 发送。
7. 导入的 cookie 明文与 Keychain 口令只存在于主进程内存：不落盘、不过 RPC、不进日志（日志只记浏览器 id 与三个计数）；源 profile 只读，临时副本必删；不提供任何导出能力。

## 9. 已知限制

- agent 的交互使用最近一次 read 的 refs；页面重读、控件变化或脱离后须重新读取。原生 input 要求 Etyon owner window 在前台并具备可绘制视图。
- 原生视图 z-order 压 DOM：与浏览区域重叠的 overlay 会被盖住。
- 用户点进页面后键盘焦点在 `WebContentsView`，app 热键不触发。
- agent 与用户争用 Browser 主实例：agent 导航会打断主实例里的用户浏览（审批卡即是提示）；额外 Browser tab 不受 agent 导航影响，但 agent 工具也不能指定它们。
- 没有 per-origin"批准并记住"，也没有"清空浏览数据"入口。
- 元素选取只覆盖主 frame（iframe 内元素取不到）；只拦 `click`，`mousedown` 驱动的页面控件仍会响应；不做元素区域截图、多选与持久标记。
- 登录态导入只导 cookie（纯 localStorage token 的站点导入后仍未登录），且是一次性快照——源浏览器之后轮换 cookie 不会同步，可随时重导；Safari / Firefox / Windows 与「按站点清除已导入 cookie」的 UI 都不在本期。
