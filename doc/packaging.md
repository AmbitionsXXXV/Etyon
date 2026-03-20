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

## 平台字段

- macOS：补充 `appCategoryType`、`darwinDarkModeSupport`、`appCopyright`
- Windows：补充 `win32metadata`，包含 `CompanyName`、`FileDescription`、`InternalName`、`OriginalFilename`、`ProductName` 与 `"requested-execution-level"`

## 图标与运行时显示

- 桌面端图片资源统一放在 `apps/desktop/resources/`
- 打包阶段通过 `packagerConfig.icon = "resources/icon"` 同时支持 `resources/icon.icns` 与 `resources/icon.ico`
- 运行时通过 `packagerConfig.extraResource` 把 `icon.icns`、`icon.ico`、`tray.png` 和 `tray@2x.png` 一并复制到产物 `resources`，供主进程在 `app.isPackaged === true` 时读取
- 开发阶段主进程直接从 `apps/desktop/resources/` 读取图标；非 `macOS` 窗口图标通过 `BrowserWindow({ icon })` 生效，`macOS` Dock 图标通过 `app.dock.setIcon()` 生效
- 开发阶段如果使用 `electron-forge start`，`macOS` Dock / Finder 显示的应用名仍然来自 `Electron.app` 本体，无法仅靠 `forge.config.ts` 或 `app.setName()` 改掉；代码里只能把菜单文案、窗口标题和 Dock 图标切到项目自己的元数据

字段来源参考 Electron Forge 配置文档与 Electron Packager `Options` 文档：

- [https://www.electronforge.io/config/configuration](https://www.electronforge.io/config/configuration)
- [https://electron.github.io/packager/main/interfaces/Options.html](https://electron.github.io/packager/main/interfaces/Options.html)
