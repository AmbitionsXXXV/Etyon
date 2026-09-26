# 2026-09-26 依赖升级

本次覆盖根目录、全部 5 个 JavaScript workspace、Rust CLI workspace，以及 macOS 屏幕感知辅助程序。产品版本与内部 workspace 版本保持不变。

## 主要版本

通过 `vp update -r --latest` 更新了 85 个存在新版的 JavaScript 直接依赖，并同步默认 catalog 与 `pnpm-lock.yaml`。升级后 `vp outdated -r --format json` 返回 `{}`。

| 依赖                       | 原版本       | 新版本        |
| -------------------------- | ------------ | ------------- |
| Vite+                      | 0.3.2        | 1.0.0-rc.0    |
| Electron                   | 43.1.0       | 44.4.5        |
| React / React DOM          | 19.2.7       | 19.3.0        |
| AI SDK                     | 7.0.31       | 7.0.114       |
| HeroUI React / Styles      | 3.2.4        | 3.2.6         |
| HeroUI Pro                 | 1.0.0-beta.8 | 1.0.0-beta.10 |
| Motion                     | 12.42.2      | 13.4.4        |
| MapLibre GL                | 5.24.0       | 6.11.2        |
| TypeScript Language Server | 5.3.0        | 6.0.1         |
| reqwest                    | 0.12.28      | 0.13.5        |
| PermissionFlow             | 1.0.0        | 2.11.2        |

Vite+ 现在配套 Vitest 5.0.1、Oxfmt 0.70.0、Oxlint 1.85.0。Vite+ 的 `latest` 标签当前为 RC；HeroUI Pro、node-pty 和 Pierre Trees 继续使用各自已有的预发布通道。

## 兼容性处理

- 根目录 Node.js 约束改为 `^22.22.2 || ^24.11.0 || >=26.0.0`，同时满足 Vite+ 与 TypeScript Language Server；本次使用 `.node-version` 指定的 Node.js 24.18.0。
- HeroUI Pro 的 npm 元数据是安装引导包，完整 peer 声明在认证 postinstall 后才出现。通过 `packageExtensions` 补齐 beta.10 对 `marked >=18` 和 `react-aria >=3.52.1` 的要求，避免 hoisted 布局让 Pro 加载旧版本。
- 新版 Oxlint 识别出 8 个不捕获父作用域变量的辅助函数，将它们移至模块作用域；函数逻辑保持不变。按新版 Oxfmt 调整两个 `shimmer` 类名顺序，以及已有的翻译类型排版。TanStack Router 构建重新生成路由树，只有声明顺序变化。
- `Cargo.lock` 按项目 Rust 1.85 的最低版本约束更新。reqwest 0.13 显式启用原有 native TLS、字符集、HTTP/2、JSON、stream 和系统代理功能，避免默认 TLS 后端变化。`ignore` 等需要更高 Rust 版本的新版不强行引入。
- 删除 Cargo deny 中已不再匹配的 `wit-bindgen 0.46.0` 例外，以及 Vite+ 0.3.2 的过期发布时间例外。
- PermissionFlow 2.11.2 要求 Swift 6.2，因此同步提高 Swift package 的 tools version；本机 Swift 6.4 编译与测试通过。

## 验证

- JavaScript 全量测试：152 个测试文件、1,238 项测试通过。
- `vp run typecheck`：通过。
- `vp check`：通过。
- `vp run build`：桌面应用打包通过。
- `vp run rust:check`：格式、Clippy、依赖来源和许可证检查通过。
- `vp run rust:test`：10 项测试通过。
- `swift test --package-path native/screen-awareness-macos`：3 项测试通过。

升级前已有 Electron 二进制缺失导致的 9 个测试文件加载失败；安装 Electron 44 二进制后，全量测试恢复通过。Electron Forge 的 fuses 插件仍声明旧的 `@electron/fuses ^1` peer 范围，项目原有的 2.1.3 保持不变，本次打包验证通过。Rust deny 仍有非阻断的重复版本与未使用许可证允许项提示。

本次验证不包含桌面交互验收，也没有发布、提交或推送代码。工作区原有的屏幕感知功能改动保留。

## 上游参考

- [Motion 13 升级说明](https://motion.dev/docs/react-upgrade-guide)
- [MapLibre GL 6 发行说明](https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.0.0)
- [PermissionFlow 2.11.2 的 Swift package 定义](https://github.com/jaywcjlove/PermissionFlow/blob/v2.11.2/Package.swift)
