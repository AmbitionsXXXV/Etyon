# Vite+

工作区已经迁移到 `Vite+`，用它统一承接格式化、Lint、测试和依赖管理入口。

## 当前约定

- 根目录配置文件为 [`vite.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/vite.config.ts)
- `fmt` / `lint` 配置已经从旧的 `.oxfmtrc.jsonc`、`.oxlintrc.json` 合并进根配置
- 保留 `Ultracite` 作为规则来源，`Vite+` 通过 `extends` 继续复用它的 `Oxlint` 规则
- `pnpm-workspace.yaml` 里把 `vite` 和 `vitest` catalog alias 到 `Vite+` 对应实现，这样依赖 `vite` peer 的插件仍可正常工作

## 常用命令

- 安装依赖：`pnpm install`
- 全仓检查：`pnpm check`
- 自动修复：`pnpm fix`
- 全仓测试：`pnpm test`
- 桌面端单测：`pnpm --filter @etyon/desktop test`
- `RPC` 单测：`pnpm --filter @etyon/rpc test`

## 迁移细节

- 代码与配置中的 `vite` 导入改为 `vite-plus`
- 测试文件中的 `vitest` 导入改为 `vite-plus/test`
- 根目录测试入口不再使用单独的 `vitest.workspace.ts`，而是改由根 [`vite.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/vite.config.ts) 的 `test.projects` 承载
- `lefthook` 的 `pre-commit` 现已改为 `pnpm exec vp staged`

## Electron 说明

桌面端仍然保留：

- [`apps/desktop/vite.main.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/vite.main.config.ts)
- [`apps/desktop/vite.preload.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/vite.preload.config.ts)
- [`apps/desktop/vite.renderer.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/vite.renderer.config.ts)

这是因为 `@electron-forge/plugin-vite` 仍然按这些入口文件装配主进程、预加载脚本和 renderer 构建；迁移后这些文件已经改为从 `vite-plus` 导出配置。
