# Plan: Update & Release — 应用内更新检查 + 发版闸门

> Source: 2026-07-27 用户指令：「设计后续实现更新发版的内容」。fable 设计 → opus-5 执行 → fable 验收。分支 `feat/in-app-updates`（自 main 切出，与 feat/chat-ui-motion 互不相关）。

## 1. 现状与证据

- 发版管线已存在且已跑通：`script/release.mjs`（根 + desktop lockstep bump → git-cliff CHANGELOG → release commit + annotated tag，`--push` 可选）→ tag push 触发 `.github/workflows/release.yml`（macos-latest arm64、未签名、强制 .dmg+.zip 双产物、git-cliff notes、softprops gh-release）。线上已有 Releases：v0.1.5 / v0.1.7 / v0.1.8（latest，2026-07-21）。
- 仓库 `AmbitionsXXXV/Etyon` 是 **PUBLIC** → 未认证 `GET https://api.github.com/repos/AmbitionsXXXV/Etyon/releases/latest` 可直接用（自动排除 draft/prerelease；限流 60 次/h/IP，绰绰有余）。
- 应用内更新为零：无 autoUpdater / update-electron-app / publisher；`app.getVersion()` 仅 logger 使用（`main/logger.ts:80`）；设置页无版本显示、无 About 区。
- 构建未签名（forge.config.ts 无 osxSign/osxNotarize）→ macOS 上 Squirrel.Mac 自动更新是死路（签名是硬前提）。本期 = 检查 + 通知 + 跳转下载；静默自更新排延伸。Fuses（asar integrity + onlyLoadFromAsar）本期无影响，但约束延伸期方案。
- `release.mjs` 打 tag 前不跑任何检查（typecheck/lint/test 全缺）——违背 audit-before-deploy 惯例。
- 可复用的既有件：`isRuntimeReleaseBuild()`（`main/app-paths.ts:45`）；oRPC 样板 `tokenSavings.get`（schema `packages/rpc/src/schemas/token-savings.ts` → `main/rtk-token-savings.ts` → `main/rpc/router.ts:437` → `settings/token-savings-tab.tsx`）；preload 带运行时校验的 `onBrowserState` 监听样板；`settings-changed` 全窗口广播（`router.ts:247`）；Sonner `<Toaster />` 已挂载但只在非 sidebar 分支（`routes/__root.tsx:185`）且全仓 0 调用；`menu.ts` app 子菜单已有 about role（`:15`）；`createSettingsWindow(tab)` + `settings-navigate-tab` 深链（`window.ts:226`）；i18n 三语（en-US/ja-JP/zh-CN，TranslationKey 由 en-US 派生，缺 en key = type error）。

## 2. 设计决策（D1）

1. **更新源 = GitHub Releases latest API**。主进程 `net.fetch`（Chromium 栈，继承应用代理设置），headers：`User-Agent: Etyon/<version>`、`Accept: application/vnd.github+json`；`AbortSignal.timeout(10_000)`；并发去重（in-flight 复用同一 promise）。检查只发生在主进程，renderer CSP 零改动。
2. **状态机**：`idle → checking → up-to-date | available | error`。单一事实源在主进程内存；oRPC 拉取 + `updates:status-changed` 推送。`errorCode ∈ network | http | invalid-response`（文案由 renderer 侧 i18n 映射）。
3. **通知策略**：只有 **auto** 检查发现新版、且 `version !== settings.updates.lastNotifiedVersion` 时 toast 一次（sonner 的首个消费者）；manual 检查只在 About 区内联反馈；错误永不 toast（auto 失败静默，manual 失败内联）。
4. **auto-check**：仅 `isRuntimeReleaseBuild() && settings.updates.autoCheck`（默认 true）；ready 后延迟 15s 首查，之后每 6h 重查。dev build 允许 manual 检查（UI 显示 development 徽标）。`lastCheckedAt` 仅内存，不持久化。
5. **安全**：`shell.openExternal` 只打开缓存 status 里的 URL，且必须命中前缀 `https://github.com/AmbitionsXXXV/Etyon/`；rpc 不接受 renderer 传入 URL。release notes 是远端 markdown → 必须走 `<AgentMarkdown>`（P1 约定的第 6 处消费点）。
6. **发版闸门**：`release.mjs` 在 bump 之前依次跑 `vp run typecheck` / `vp run check` / `vp test run`，新增 `--skip-checks` 逃生口，dry-run 输出 checks 计划。只加 JS 闸门（rust 工作区与桌面发版产物无关，不拖慢发版）。`release.yml` 本期零改动。
7. **命名雷区**：仓库已有 `UpdateSettingsSchema` = 「settings 的 patch schema」。新增组字段名 `updates`、schema 名 `UpdatesSettingsSchema`；改 `schemas/settings.ts` 时严禁碰旧名。

## 3. 契约

```ts
// packages/rpc/src/schemas/updates.ts（新）
UpdateCheckErrorCode = "network" | "http" | "invalid-response"
AvailableUpdate = {
  version: string            // "0.2.0"（去 v）
  tagName: string            // "v0.2.0"
  publishedAt: string | null // ISO
  htmlUrl: string            // release 页
  notes: string | null       // markdown body
  dmgUrl: string | null
  dmgSizeBytes: number | null
}
UpdateStatus = {
  state: "idle" | "checking" | "up-to-date" | "available" | "error"
  buildIdentifier: "development" | "release"
  currentVersion: string
  lastCheckedAt: number | null
  checkReason: "auto" | "manual" | null
  available: AvailableUpdate | null
  errorCode: UpdateCheckErrorCode | null
}
// schemas/settings.ts 增量
UpdatesSettingsSchema = { autoCheck: boolean = true, lastNotifiedVersion: string | null = null }
// AppSettingsSchema += updates（带 default）；UpdateSettingsSchema（patch）+= updates?: optional
```

- oRPC `updates` 组（router.ts）：`status`（读缓存）、`check`（manual 触发，await 完成后返回最新 status）、`openDownload`（开 `dmgUrl ?? htmlUrl`）、`openReleasePage`（开 `htmlUrl`）。
- 推送：`updates:status-changed`（payload = UpdateStatus，`BrowserWindow.getAllWindows()` 广播）；preload 加带运行时校验的 `onUpdatesStatusChanged`（仿 `onBrowserState`），并入 `EtyonElectronApi` 类型。

## 4. 接线点

1. `packages/rpc/src/schemas/updates.ts`（新）+ `packages/rpc/src/index.ts` 导出 + `schemas/settings.ts`（updates 组，AppSettings/patch 双 schema 同步加）。
2. `apps/desktop/src/main/updates/core.ts`（新，纯逻辑零 electron import，node 可测）：`compareSemver`、`parseLatestRelease(json, currentVersion)`（含 draft/prerelease 防御、非 vX.Y.Z tag → invalid-response）、`pickDmgAsset(assets)`、`isAllowedReleaseUrl(url)`、`shouldNotify(status, lastNotifiedVersion)`。
3. `apps/desktop/src/main/updates/index.ts`（新）：状态持有 + `checkForUpdates({ reason })` + `setupUpdates()`（15s 延迟首查 + 6h interval，release-only）+ 广播 + `openUpdatesSettings()`（给菜单用：开/聚焦 settings 窗口 about tab + 触发 manual check）。
4. `apps/desktop/src/main/index.ts`：`handleAppReady` 里调 `setupUpdates()`（menu 之后即可）。
5. `apps/desktop/src/main/menu.ts`：app 子菜单 about 之后加 `menu.app.checkForUpdates`（「检查更新…」）→ `openUpdatesSettings()`。
6. `apps/desktop/src/preload/index.ts`：`onUpdatesStatusChanged`。
7. renderer 设置页四件套：`lib/settings-page/nav-config.ts`（`about` 放 nav 最后，Hugeicons 信息类 stroke 图标，用 hugeicons MCP 选型）→ `settings-page.tsx` 的 `SETTINGS_SECTION_IDS` + 渲染分支 → `components/settings/about-tab.tsx`（新）→ i18n ×3。
8. `routes/__root.tsx`：`<Toaster />` 移出条件分支（app-shell 分支目前根本没挂，不修 toast 必挂空）；app-shell 侧挂 status 监听 → available && auto && 未通知过 → sonner toast（标题「Etyon vX.Y.Z 已发布」+ action 查看 → 打开设置 about tab）+ `settings.update` 写 `lastNotifiedVersion`。
9. `script/release.mjs`：checks 闸门 + `--skip-checks` + help/dry-run 文案同步。
10. 文档：`doc/packaging.md`、`doc/release.md` 增补（更新检查 + 闸门说明）；本 plan 文件随 PR 提交。

## 5. About 区 UI 规格（紧凑）

- 卡 1「关于」：行式 版本 `0.1.8`（dev build 加 Dev chip）。不放 logo 大图、不堆链接。
- 卡 2「更新」：状态行（未检查 / 检查中 spinner / 已是最新（附上次检查时间）/ 错误文案）+「检查更新」按钮；available 时：新版本号 + 发布日期 + notes（`<AgentMarkdown>`，max-h 滚动）+ 主按钮「下载 DMG」（openDownload）+ 次链接「发布页」；「自动检查更新」Switch = 即时保存（token-savings 先例，不进 draft save bar）。
- 复用 `settingsPageSectionMotion` 编排；样式对齐现有 tab（space-y-4 卡片）。

## 6. 负面清单（本期不做）

签名/公证；静默自更新与应用内下载进度（quitAndInstall 路线）；electron-updater / update-electron-app 依赖（零新依赖）；publisher-github；Windows/Linux CI 矩阵；`release.yml` 改动；tray 菜单项；CSP / webPreferences 改动；现有 `UpdateSettingsSchema` 改名。

## 7. 验收

- `vp run typecheck` && `vp run check` && `vp test run` 全绿。
- 新单测 `apps/desktop/test/main/updates.test.ts`（仿 `app-paths.test.ts`，纯逻辑）：compareSemver（新/旧/相等/畸形）、parseLatestRelease fixture（available / up-to-date / 本地更新 → up-to-date / 畸形 tag → invalid-response / draft 防御）、pickDmgAsset、isAllowedReleaseUrl（http / 异仓库 / javascript: 全拒）、shouldNotify。
- i18n：en-US / ja-JP / zh-CN 三份齐（en 由类型兜底，ja/zh 人工核对语感）。
- `node script/release.mjs patch --dry-run` 显示 checks 计划且不动 git；`--skip-checks` 生效。
- fable 真机（dev 起包 + CDP）：About 区渲染、manual check → 已是最新、菜单项、dev 徽标、Toaster 挂载不破坏现有布局。
- 端到端真值验证留给下次真实发版：合并后 `vp run release -- patch`（v0.1.9，走新闸门）→ 旧版 0.1.8 启动 15s 内应收到 toast。

## 8. 延伸（不在本期）

Apple Developer ID 签名+公证（forge osxSign/osxNotarize + CI secrets）→ 之后 update-electron-app + update.electronjs.org（public 仓库已满足条件）或自托管 Squirrel feed，实现静默自更新与 quitAndInstall；应用内下载进度条；publisher-github 替代 workflow 手工上传；Windows/Linux 构建矩阵；PR CI（typecheck/test）workflow。
