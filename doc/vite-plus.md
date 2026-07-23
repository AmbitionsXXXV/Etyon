# Vite+

工作区已经迁移到 `Vite+`，用它统一承接格式化、Lint、测试和依赖管理入口。

## 当前约定

- 根目录配置文件为 [`vite.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/vite.config.ts)
- `fmt` / `lint` 配置已经从旧的 `.oxfmtrc.jsonc`、`.oxlintrc.json` 合并进根配置
- 保留 `Ultracite` 作为规则来源，`Vite+` 通过 `extends` 继续复用它的 `Oxlint` 规则
- `pnpm-workspace.yaml` 里允许 `vite` / `vitest` peer 版本透传；项目自身测试 API 和配置入口统一使用 `vite-plus`

## 常用命令

- 安装依赖：`vp install`
- 全仓检查：`vp check`
- 自动修复：`vp run fix`
- 清理依赖与缓存：`vp run clean:cache`
- 产品发版（version bump + changelog + tag）：`vp run release -- patch`（见 [release.md](./release.md)；底层 `vp pm version`）
- 全仓测试：`vp test`
- 桌面端单测：在 `apps/desktop` 下执行 `vp test`
- `RPC` 单测：在 `packages/rpc` 下执行 `vp test`
- 包内测试文件统一放在 `test/` 目录，例如 `apps/desktop/test/`、`packages/rpc/test/`

## 迁移细节

- 代码与配置中的 `vite` 导入改为 `vite-plus`
- 测试文件中的 `vitest` 导入改为 `vite-plus/test`
- 根目录测试入口不再使用单独的 `vitest.workspace.ts`，而是改由根 [`vite.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/vite.config.ts) 的 `test.projects` 承载；子项目测试配置位于各自的 `vite.config.ts`
- 子项目测试配置只扫描包内 `test/**/*.test.ts`，避免测试与 `src/` 业务模块混放
- 已完全移除 `lefthook`，改用 Vite+ 内置的 `.vite-hooks/` 体系（通过 `vp config` 安装）
- `pre-commit`：先运行 `vp staged`（按 `vite.config.ts` 的 `staged` 块对暂存文件执行 `vp check --fix`），再运行 `vp run typecheck` 做全量类型检查
- `commit-msg`：运行 `commitlint` 校验提交信息格式
- `prepare` 脚本从 `lefthook install` 改为 `vp config`，`pnpm install` 后自动安装 hooks

## Electron 说明

桌面端仍然保留：

- [`apps/desktop/vite.main.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/vite.main.config.ts)
- [`apps/desktop/vite.preload.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/vite.preload.config.ts)
- [`apps/desktop/vite.renderer.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/vite.renderer.config.ts)

这是因为 `@electron-forge/plugin-vite` 仍然按这些入口文件装配主进程、预加载脚本和 renderer 构建；迁移后这些文件已经改为从 `vite-plus` 导出配置。

## Vite DevTools（2026-07-18 接入）

`@vitejs/devtools`（0.3.x，满足 `@voidzero-dev/vite-plus-core` 的可选 peer）只挂在 renderer——它是仓库里唯一真实的 Vite dev server；main/preload 是无 dev server 的 rolldown lib 构建，无处可挂。

- 接入点：[`apps/desktop/vite.renderer.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/vite.renderer.config.ts) 中 `...(command === "serve" ? [DevTools()] : [])`，serve 门控保证 `package`/`make` 产物零变化（已用 renderer 生产构建验证）
- dev 启动后 forge 日志会打印 DevTools 的独立入口与一次性授权 URL（`http://localhost:5173/__devtools/auth?id=…`）；应用窗口内会出现 dock 按钮，首次使用需通过授权 URL 信任该浏览器客户端
- 已知噪音（非致命）：授权前 dock 的 RPC 调用报 `DTK0013 Unauthorized`（授权一次即消）；devtools 客户端自带的 Vue 打印 feature-flags 警告
- 与 TanStack Devtools 共存：`devtools()`（`@tanstack/devtools-vite`）插件与 `<TanStackDevtools>` 浮动面板不受影响
