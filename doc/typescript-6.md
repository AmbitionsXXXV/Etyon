# TypeScript 6 升级记录

本次升级将工作区的 `TypeScript` 从 `5.9.3` 提升到 `6.0.2`。

参考：

- 官方发布说明：<https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/>

## 这次调整了什么

- `pnpm-workspace.yaml` 的 `catalog.typescript` 升级到 `^6.0.2`
- `apps/desktop/package.json` 增加 `@types/node`，并把 `apps/cli`、`packages/ui` 的 `@types/node` 收敛到 workspace catalog
- 根 `tsconfig` 显式设置 `types: []`，避免依赖 TypeScript 版本默认值
- `tsconfig.root.json`、`apps/desktop/tsconfig.json`、`apps/cli/tsconfig.json` 显式声明 `types`
- 移除 `apps/desktop/tsconfig.json` 与 `packages/ui/tsconfig.json` 中的 `baseUrl`

## 为什么要这样改

TypeScript 6.0 里，和这个仓库最相关的变化主要有两类：

- `types` 的默认行为调整后，更适合显式声明需要注入的环境类型
- `baseUrl` 已被标记为废弃，不再适合作为路径别名配置的依赖前提

这个仓库同时包含 Electron main、preload、renderer 和 Node CLI。显式声明类型环境可以避免不同子工程之间“碰巧可用”的隐式类型泄漏。

## 验证

- `pnpm exec tsc -v` -> `Version 6.0.2`
- `pnpm typecheck`
- `pnpm check`
