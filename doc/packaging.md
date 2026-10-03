# Packaging

桌面端打包配置集中在 `apps/desktop/forge.config.ts`，目前补齐了 Electron Forge `packagerConfig` 里的应用元数据，并区分开发环境与 `release` 环境。

## 环境判定

优先级从高到低：

1. `ELECTRON_FORGE_BUILD_IDENTIFIER` / `ETYON_BUILD_IDENTIFIER`
2. `ETYON_RELEASE` / `RELEASE`
3. `NODE_ENV=production`
4. `npm_lifecycle_event` 或 `process.argv` 中是否命中 `build`、`make`、`package`、`publish`、`release`

最终会落成两个标识：

- `development`
- `release`

## 应用元数据

### `release`

- `name`: `Etyon`
- `executableName`: `etyon`
- `appBundleId`: `com.etcetera.etyon`
- `helperBundleId`: `com.etcetera.etyon.helper`

### Development

- `name`: `Etyon Dev`
- `executableName`: `etyon-dev`
- `appBundleId`: `com.etcetera.etyon.dev`
- `helperBundleId`: `com.etcetera.etyon.dev.helper`

这样做的目的，是避免本地开发包和正式包在 macOS / Windows 上发生应用标识冲突。

## 运行数据路径隔离

`vite.main.config.ts` 会在构建主进程时把同一个 build identifier 固化到 bundle。运行时路径统一由 `apps/desktop/src/main/app-paths.ts` 生成，目录名使用无空格的小写形式，避免开发版与正式版复用 settings、SQLite、日志、附件、模型和 Chromium session 数据。

| 数据 | Development | Release |
| --- | --- | --- |
| 应用配置 | `~/.config/etyon-dev/` | `~/.config/etyon/` |
| 结构化日志 | `~/.etyon-dev/logs/` | `~/.etyon/logs/` |
| Electron `userData` / `sessionData` | `<appData>/etyon-dev/` | `<appData>/etyon/` |

`electron-forge start`、development package 和本地 Drizzle 命令默认使用 development 路径；release package 继续使用原有正式路径，不迁移或覆盖正式数据。Electron 的 `userData` 与 `sessionData` 会在 `ready` 前完成设置，确保 Chromium cache、local storage 等内部数据也保持隔离。

## 平台字段

- macOS：补充 `appCategoryType`、`darwinDarkModeSupport`、`appCopyright`
- Windows：补充 `win32metadata`，包含 `CompanyName`、`FileDescription`、`InternalName`、`OriginalFilename`、`ProductName` 与 `"requested-execution-level"`

## 图标与运行时显示

- 桌面端图片资源统一放在 `apps/desktop/resources/`
- 打包阶段通过 `packagerConfig.icon = "resources/icon"` 同时支持 `resources/icon.icns` 与 `resources/icon.ico`
- 运行时通过 `packagerConfig.extraResource` 把 `icon-dark.png`、`icon-light.png`、`icon.icns`、`icon.ico` 和 `tray.png` 一并复制到产物 `resources`，供主进程在 `app.isPackaged === true` 时读取
- 开发阶段主进程直接从 `apps/desktop/resources/` 读取图标；所选 PNG 用于 `macOS` Dock、Windows / Linux 窗口和托盘，缺失时回退到 `icon.icns` 或 `icon.ico`
- 开发阶段如果使用 `electron-forge start`，`macOS` Dock / Finder 显示的应用名仍然来自 `Electron.app` 本体，无法仅靠 `forge.config.ts` 或 `app.setName()` 改掉；代码里只能把菜单文案、窗口标题和 Dock 图标切到项目自己的元数据

## 版本与发版入口

产品版本（根 `etyon` + `@etyon/desktop`）通过 Vite+ / pnpm 原生 versioning 锁定，统一入口：

```bash
vp run release -- patch -- --dry-run
vp run release -- patch
```

说明见 [release.md](./release.md)。不要引入 Changesets；tag push 后由下方 workflow 负责打包与 GitHub Release。

## GitHub Actions release

Release workflow 位于 [`.github/workflows/release.yml`](/Users/jiantianjianghui/Web_Project/Etyon/.github/workflows/release.yml)，触发条件：

- 任意 tag push

workflow 使用 `voidzero-dev/setup-vp@v1` 安装 Vite+，并固定 Node.js `22` 作为 Electron Forge 打包运行时，再执行：

```bash
vp install --frozen-lockfile
cd apps/desktop
pnpm_version=$(node -p "require('../../package.json').packageManager.split('@')[1]")
export PATH="$HOME/.vite-plus/package_manager/pnpm/$pnpm_version/pnpm/bin:$PATH"
ELECTRON_FORGE_BUILD_IDENTIFIER=release ETYON_RELEASE=true ../../node_modules/.bin/electron-forge make
```

CI 只执行 Electron Forge 的默认 `make`，不单独传 `--arch` / `--platform` / `--targets`。workflow 会先收集 Electron Forge 在 `out/release/make/` 里生成的 `.dmg` 和 `.zip`，统一放到 `apps/desktop/out/release/artifacts/macos-arm64/`。如果其中任意一种产物缺失，但已经生成了 `out/release/**/*.app`，workflow 会从 `.app` 补齐缺失的 `Etyon-macos-arm64.zip` 或 `Etyon-macos-arm64.dmg`；最终验收要求 Release assets 同时包含 `.dmg` 和 `.zip`。

tag push 会额外通过 `softprops/action-gh-release@v3` 创建 GitHub Release，并把同一批 DMG / ZIP 产物上传到 Release assets。同仓库发布不需要额外配置 `GH_TOKEN` secret；该 action 会默认使用 GitHub Actions 内置的 `github.token`，但 workflow 必须保留 `permissions.contents: write`。

因为项目依赖 `@heroui-pro/react`，GitHub 仓库必须配置 `HEROUI_AUTH_TOKEN` secret。路径：

1. GitHub 仓库页面打开 `Settings`
2. 进入 `Secrets and variables` -> `Actions`
3. 点击 `New repository secret`
4. `Name` 填 `HEROUI_AUTH_TOKEN`
5. `Secret` 填 HeroUI Pro 授权 token

workflow 在安装依赖时注入：

```yaml
env:
  HEROUI_AUTH_TOKEN: ${{ secrets.HEROUI_AUTH_TOKEN }}
```

## 本轮 agent 功能的打包验收

`workflow-worker.ts` 通过独立的 `vite.workflow.config.ts` 构建为 `.vite/build/workflow-worker.js`，不能只检查主进程入口存在。升级包还应包含 `0015` / `0016` migration、MCP / Web 的运行时依赖、ASAR 解包后的 native 模块和 `screen-awareness` helper。

本轮使用 `ETYON_RELEASE=true ELECTRON_FORGE_BUILD_IDENTIFIER=release` 执行本地 `vp run make`。当前产品版本保持 `0.1.8`；此处的 release 配置代表打包模式，未执行版本递增、tag push 或 GitHub Release。最终产物与实际 UI 验收结果见 [本轮验收记录](./feature-completion-2026-10-03.md)。

本地 ad-hoc 签名验证仅证明文件与本次签名一致；正式 Developer ID、notarization 和正式 helper 的授权升级流程需要在正式签名产物上单独验收。

## 应用内更新检查

Release 产物尚无 Developer ID 签名与 notarization 验收，macOS 上没有 Squirrel.Mac 自动更新的前提条件，所以本期只做「检查 + 通知 + 跳转下载」，不做静默自更新。

- 更新源：`GET https://api.github.com/repos/AmbitionsXXXV/Etyon/releases/latest`（仓库 public，免认证；该端点自动排除 draft / prerelease）
- 请求只发生在主进程 `apps/desktop/src/main/updates/index.ts`：启用应用代理时复用 `createProxyAwareFetch`，否则使用 Electron `net.fetch`；renderer CSP 与 `webPreferences` 零改动
- 纯逻辑（版本比较、release 解析、DMG 资产挑选、URL 允许名单、通知判定）在 `apps/desktop/src/shared/updates/core.ts`（跨进程共享，renderer 的 toast 判定同源），零 electron import，单测见 `apps/desktop/test/shared/updates.test.ts`
- 自动检查仅在 release build 且 `settings.updates.autoCheck` 打开时运行：ready 后 15s 首查，之后每 6h 一次；development build 只保留设置页的手动按钮（版本行带 Dev 徽标）
- `shell.openExternal` 只接受缓存 status 里、且命中 `https://github.com/AmbitionsXXXV/Etyon/` 前缀的 URL；renderer 不能通过 rpc 传入任意 URL
- release notes 是远端 markdown，统一走 `<AgentMarkdown>` 渲染；其中 http(s) 链接通过 `open-external-url` IPC 打开
- 主窗口挂载时会回放主进程缓存的更新状态，覆盖隐藏启动期间已经完成首次自动检查的场景
- UI 在设置页 About 区（nav 最后一项），菜单入口是 macOS 应用菜单的「检查更新…」

字段来源参考 Electron Forge 配置文档与 Electron Packager `Options` 文档：

- [https://www.electronforge.io/config/configuration](https://www.electronforge.io/config/configuration)
- [https://electron.github.io/packager/main/interfaces/Options.html](https://electron.github.io/packager/main/interfaces/Options.html)
