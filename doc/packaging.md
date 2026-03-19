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

字段来源参考 Electron Forge 配置文档与 Electron Packager `Options` 文档：

- [https://www.electronforge.io/config/configuration](https://www.electronforge.io/config/configuration)
- [https://electron.github.io/packager/main/interfaces/Options.html](https://electron.github.io/packager/main/interfaces/Options.html)
