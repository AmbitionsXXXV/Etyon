# shadcn CLI 与 monorepo

## `aliases.ui` 与 tsconfig `paths` 必须对齐

`shadcn` 在运行时通过 `tsconfig-paths` 的 `createMatchPath`，把 `components.json` 里的 `aliases.ui`（例如 `@etyon/ui/components`）解析成**磁盘目录**（见上游 `resolveConfigPaths` → `resolveImport`）。

TypeScript 里只有带通配符的映射（例如 `@etyon/ui/components/*`）时，**无法**匹配「没有子路径」的模块说明符 `@etyon/ui/components`。此时 `tsconfig-paths` 会退化成在 `baseUrl` 下按字面路径拼接，得到应用目录下的 `apps/desktop/@etyon/ui/components`，组件就会被写到错误位置。

同时，`getWorkspaceConfig` 依赖 `resolvedPaths.ui` 与当前 `cwd` 是否落在不同包根上，才能走 `addWorkspaceComponents`。`ui` 解析错误时，`workspaceConfig.ui.resolvedPaths.cwd` 往往仍等于 `apps/desktop`，workspace 分支不会执行。

**约定**：若在 `apps/desktop/components.json` 中把 `ui` 设为 `@etyon/ui/components`，则 `apps/desktop/tsconfig.json` 的 `paths` 中必须同时包含：

- `@etyon/ui/components` → `packages/ui` 下对应目录（目录本身）
- `@etyon/ui/components/*` → 同上目录下的文件（若需要子路径导入）

在 `packages/ui` 内执行 `pnpm dlx shadcn@latest add` 时，应使用 `packages/ui/components.json`，且 `cwd` 指向该包，此时解析使用的是该包自己的 `tsconfig.json`（例如 `@etyon/ui/*` → `./src/*`）。
