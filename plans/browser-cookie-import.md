# Plan: Browser Cookie Import — 导入本机 Chromium 系浏览器的已有登录态

> Source: 2026-07-27 用户指令：「接入目前已有比如 chromium 内核的 profile 已有的登录态」。目标：把用户本机 Chrome / Edge / Brave / Arc 等 Chromium 系浏览器 profile 里的 cookies 导入内嵌浏览器的 `persist:browser` 分区，让它直接获得已有登录态，免去逐站重登。fable 设计 → opus-5 执行 → fable 验收。分支 feat/browser-cookie-import。

## 1. 可行性结论与边界

**可行（macOS + Chromium 系）**，成熟先例是 yt-dlp `--cookies-from-browser` 与 browser_cookie3：

- Chromium 系在 macOS 用 Keychain 的「\<Browser\> Safe Storage」条目存加密口令，cookie 值以 `v10` 前缀 AES-128-CBC 加密（PBKDF2-SHA1，salt `saltysalt`，1003 轮，16 字节 key，IV = 16 个空格）。
- **Chrome 130+ 变更**：解密出的明文前 32 字节是 `SHA256(host_key)`，必须剥离（剥离前后做 hash 比对判定，兼容旧版无前缀格式）。
- Cookies 库是标准 SQLite——仓里已有 `@libsql/client`（main db 驱动），`file:` URL 直接读，**零新依赖**；解密用 node:crypto，Keychain 读取用 `security` CLI，均内置。
- **交互代价**：`security find-generic-password` 首次会弹系统授权框，用户须点「允许」（真机验收时暂停等用户配合——既有工作流先例）。
- 已知局限（对话框文案与文档明示）：只导 cookies，不导 localStorage/IndexedDB——纯 localStorage token 登录的站点导入后仍未登录；导入是一次性快照，源浏览器之后轮换 cookie 不会同步（可随时重导）。

**边界**：v1 仅 macOS（平台即 darwin）+ Chromium 系；Safari（binarycookies + 沙箱）与 Firefox（NSS/明文 sqlite）进延伸；Windows DPAPI/app-bound 进延伸。

## 2. 现状与证据

- 内嵌浏览器所有 session 共享单一 `session.fromPartition("persist:browser")`（plans/browser-tab.md D2），Electron `session.cookies.set` 可写任意含 httpOnly 的 cookie——导入即全局生效且随分区持久化。
- `browser.*` RPC 有 `assertBrowserRpcAccess`（MessagePort-only + session 校验）门禁，新 procedures 沿用。
- main db 驱动是 `@libsql/client`（`src/main/db/index.ts`），标准 SQLite 文件可读。
- BrowserPanel 有空态（未加载页面：地址栏 + Go）与就绪态工具栏（后退/前进/刷新/选取/外开）两种形态（browser-panel.tsx）。
- persist:browser 的登录态可见性已有审批门：agent read/screenshot 默认需审批，文案明示「页面内容将发送给模型，含登录态」（PR3）——导入放大的是这道门背后的内容，不新开口子。

## 3. Design Decisions

**D1 支持矩阵（源浏览器发现表）。** 常量表驱动，`~/Library/Application Support/` 下：

| browser | 目录 | Keychain service / account |
| --- | --- | --- |
| Chrome | `Google/Chrome` | `Chrome Safe Storage` / `Chrome` |
| Edge | `Microsoft Edge` | `Microsoft Edge Safe Storage` / `Microsoft Edge` |
| Brave | `BraveSoftware/Brave-Browser` | `Brave Safe Storage` / `Brave` |
| Arc | `Arc/User Data` | `Arc Safe Storage` / `Arc` |
| Chromium | `Chromium` | `Chromium Safe Storage` / `Chromium` |

profile 枚举 = 根目录下 `Default` 与 `Profile *`（存在 `Cookies` 文件者）；显示名从根目录 `Local State` JSON 的 `profile.info_cache[dir].name` 读（读不到回退目录名）。

**D2 读取与解密（全部在 main，新模块 `src/main/browser/cookie-import.ts`）。**

- Cookies 文件先 `copyFile` 到 `app.getPath("temp")` 下一次性文件再读（运行中的浏览器持写锁/WAL，拷贝规避；用后删除）。
- `createClient({ url: "file:..." })` 读 `cookies` 表：`host_key, name, path, value, encrypted_value, is_secure, is_httponly, expires_utc, samesite`。
- 解密：`value` 列非空直接用；否则 `encrypted_value` 剥 `v10` 前缀 → AES-128-CBC 解密（key 缓存进程内，按浏览器一份）→ 剥 PKCS 填充 → 若前 32 字节 === `SHA256(host_key)` 再剥（Chrome 130+）。解密失败逐条计数跳过，不中断。
- Keychain：`execFile("security", ["find-generic-password", "-w", "-s", service, "-a", account])`；非零退出（用户拒绝/无条目）→ 类型化错误 `keychain-denied` / `keychain-missing`。

**D3 写入 persist:browser。** 逐条 `cookies.set`：

- `url` 由 `host_key` 推导：去前导点，`is_secure ? "https" : "http"` + host + `path`；`host_key` 带前导点 → 传 `domain`（域 cookie），否则不传（host-only）。
- `expirationDate = expires_utc / 1e6 - 11644473600`（Chrome epoch 1601 → Unix）；`expires_utc === 0` 保持 session cookie（不传）。
- `sameSite` 映射：chromium `-1/0/1/2` → electron `unspecified/no_restriction/lax/strict`；`no_restriction` 强制 `secure: true`（Electron 约束）。`__Host-`/`__Secure-` 前缀天然要求 secure + https url，失败进逐条计数。
- 返回 `{ failed, imported, total }`；同名 cookie 直接覆盖（`cookies.set` 语义）。

**D4 RPC（沿用 browser 组门禁）。**

- `browser.listCookieSources()` → `{ sources: [{ browser, cookieCount, id, profileDir, profileName }] }`——只扫目录与 `Cookies` 文件行数（拷贝后 `select count(*)`），**不碰 Keychain**（列表阶段零弹窗）。
- `browser.importCookies({ domainFilter?, sessionId, sourceId })` → `{ failed, imported, total }`。`domainFilter` 为可选子串匹配（`host_key` 包含即导入，如 `github.com`），空 = 整 profile。
- 两个都过 `assertBrowserRpcAccess`（listCookieSources 无 sessionId 语义但仍要求传当前 sessionId 走同一门禁，保持 http transport 拒绝面一致）。

**D5 UI 入口与对话框。** BrowserPanel 工具栏加「导入登录态」按钮（`DownloadCircle01Icon` 一类，空态与就绪态都显示）→ HeroUI Dialog：

- 源列表（浏览器图标 + profile 名 + cookie 数，单选）；`listCookieSources` 打开时拉取，空列表显示「未发现支持的浏览器」。
- 可选域名过滤输入（placeholder 如 `仅导入包含此域名的 cookie，留空导入全部`）。
- 说明文案（两条，不藏折叠）：①「导入后，经你批准，agent 可读取这些站点的登录内容」；②「首次导入会请求钥匙串访问权限（\<浏览器名\> Safe Storage）」。
- 导入按钮 → pending 态 → 行内结果（`已导入 N 条（失败 M 条）`）→ 可关闭。错误分支：keychain-denied / 源消失 给对应文案。
- i18n keys 收在 `chat.projectPanel.cookieImport*`（三语）。

**D6 安全框架（负面清单）。**

- 源浏览器 profile **只读**（拷贝副本，绝不写回、绝不删源）；临时副本用后删除。
- 明文 cookie 值只存在于 main 进程内存，**不落盘、不过 RPC**——renderer 只拿计数与源元数据。
- preload / `HARDENED_WEB_PREFERENCES` / url-policy / persist:browser 权限拒绝面零改动；不提供任何「导出」能力；agent browser 工具不感知此功能。
- Keychain key 进程内缓存即止，不持久化。

## 4. 接线点

1. `apps/desktop/src/main/browser/cookie-import.ts`（新）— D1-D3：发现表、profile 枚举、拷贝读取、解密（含 130+ 前缀剥离）、cookies.set 写入、类型化错误。纯逻辑子函数（chrome epoch 换算、sameSite 映射、host→url 推导、v10 解包判定）拆成可单测的导出。
2. `packages/rpc/src/schemas/browser.ts` + `index.ts` — CookieSource / list & import 输入输出 schema。
3. `apps/desktop/src/main/rpc/router.ts` — `browser.listCookieSources` / `browser.importCookies`。
4. `apps/desktop/src/renderer/components/chat/browser-panel.tsx` — 入口按钮 + 导入 Dialog（状态机：idle/loading/importing/done/error）。
5. `packages/i18n/*/translation.json` — `cookieImport*` keys 三语。
6. 测试 — 纯函数单测（epoch/sameSite/url 推导/前缀剥离判定，用构造的密文样本走完整解密路径——key 已知时可离线构造）；schema 往返；发现表 profile 枚举用临时目录 fixture。
7. `doc/browser.md` — 「登录态导入」一节（落地后）。

## 5. 验收（单 PR）

`vp check` + `turbo run typecheck` + `vp test run` 全绿后，真机（main 改动 → 全量 relaunch + CDP）：

- 对话框列出本机真实浏览器与 profile（cookie 计数合理）；列表阶段无 Keychain 弹窗。
- 选 Chrome Default 导入：**Keychain 授权框弹出——暂停，等用户点「允许」**；导入计数返回；内嵌浏览器打开一个用户已登录的站点验证登录态生效（站点由用户指定或用 github.com）。
- 域名过滤：填 `github.com` 时 imported 数明显小于全量。
- 错误路径：Keychain 拒绝 → 友好错误不崩；不存在的浏览器不出现在列表。
- 安全面回归：renderer 侧网络面板/RPC payload 无明文 cookie；临时副本已删；源 profile mtime 未变。

落地后：本文追加验收记录；doc/browser.md 补节。

## 6. 延伸（不在本期）

- Safari（binarycookies 解析 + 完全磁盘访问权限）与 Firefox（profiles.ini + 明文 sqlite）；Windows（DPAPI / Chrome app-bound encryption，后者当前无稳定用户态方案）；导入后按站点管理/清除 UI（分区 cookie 浏览器）；自动定期同步（涉及常驻 Keychain 访问，暂不做）。

### PR8 验收记录 (2026-07-27)

**分工**：fable 设计 → opus-5 实现（接线点 1-7）→ fable diff review + 两处收紧/修复 + 真机走查（Keychain 授权由用户配合完成）。

**静态审查**：diff 对照 D1-D6 通过；opus 报告的 6 处偏差全部接受（`Browser*` 前缀命名、错误 reason 走 `ORPCError.data`（oRPC 会把普通 Error 折叠成 "Internal server error"）、`intMode: "bigint"`（`expires_utc` 超安全整数、默认 number 模式直接抛错）、cookie 写入 `Promise.all`（`no-await-in-loop` 全仓 error 且 Chromium cookie store 内部串行）、对话框打开时隐藏原生 view（WebContentsView 压在 DOM 之上）、源列表 query `retry: false`）。fable 收紧一处：cookie 写入改走 `manager.getBrowsingSession()`（导出加固入口），不再依赖「面板先建过 view 才装上权限拒绝面」的调用时序。

**真机走查发现 P0 崩溃并修复（两轮）**：用户点 Keychain 授权后应用整体崩溃——libsql 0.9.30 Rust 核心 `value.rs:237` 对非法 UTF-8 的 TEXT 值 `from_utf8().unwrap()` panic（SIGABRT，JS 不可捕获，整个 Electron 主进程死亡）。第一轮把四个 text 列 cast 为 blob 仍崩；离线复现（无 Electron/无 Keychain，直连 Chrome Cookies 副本跑生产同款 select）+ 单进程逐列二分后定位真凶：**sqlite 按值而非按列定型——声明为 BLOB 的 `encrypted_value` 列在真实 profile 里存在 TEXT 类型的行**（本机 Chrome 库中 1 行），该值字节非合法 UTF-8。最终修复：`COOKIE_COLUMNS` 所有非整数列（含 `encrypted_value`）一律 `cast(… as blob)`，JS 侧 `Buffer.toString("utf-8")` 有损解码文本、密文保持原始字节；回归测试用 `cast(x'…ff…' as text)` 构造 TEXT 类型的毒 `value` 与毒 `encrypted_value` 驱动同一条 select。教训：**凡用 libsql 读不可信外部 SQLite，文本列必须 cast blob**——这不是错误处理问题，是进程级 panic。

**真机走查**（清场 relaunch ×3 + CDP :9230）：

1. **源发现**：对话框列出 6 个源（Chrome×2、Arc×4）带 cookie 计数与 profile 显示名；列表阶段确认零 Keychain 弹窗 ✓。
2. **导入**：Chrome · etcetera（1762 cookies）→ Keychain 授权（用户点「始终允许」，崩溃修复后重启进程静默读取）→ **Imported 1762 of 1762 cookies，零失败** ✓。
3. **登录态生效**：notion.so 页面 `document.cookie` 可见 10 个导入 cookie（分区持有且随请求发送，机制端到端确证）；open.spotify.com 与 expo.dev 均不出现匿名态必有的 Log in / Sign up 按钮（登录态头部）✓。github.com / notion.so 落在未登录页——离线查证源 profile 里 GitHub 无 `user_session`（只有 `_octo`/`logged_in` 分析 cookie）、Notion 会话已过期，**属源数据状态，非导入缺陷**。
4. Keychain 交互链路：授权一次后（始终允许）后续导入与重启均静默；崩溃会使「仅允许一次」失效需重新授权（已在真机上亲历两轮）。

**已知观察**：HeroUI Dialog 包装器触发 react-aria「Heading slot=title」a11y 警告刷屏——`@etyon/ui` Dialog 的既有行为，全 app 各对话框同样存在，非本 PR 引入（另行处理）。
