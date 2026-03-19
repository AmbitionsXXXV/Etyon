# ESM

Desktop 应用的模块系统策略。Main process 使用 ESM 输出，preload 保持 CJS（Electron 沙箱限制）。

## 模块格式

| 进程     | 构建输出格式 | 原因                                                |
| -------- | ------------ | --------------------------------------------------- |
| Main     | ESM          | Electron 28+ 原生支持 ESM，可直接使用 ESM-only 依赖 |
| Preload  | CJS          | Electron 沙箱环境不支持 `import` 语句，必须为 CJS   |
| Renderer | ESM          | 浏览器环境，Vite 默认 ESM                           |

## Path Alias

所有 Vite 配置文件通过 `vite-tsconfig-paths` 插件自动同步 `tsconfig.json` 中的 `compilerOptions.paths`，无需手动维护 `resolve.alias`。

## Vite 构建配置

### Main Process

`vite.main.config.ts` 通过 `build.lib.formats: ["es"]` 覆盖 Forge 插件默认的 CJS 输出。

由于部分第三方依赖（如 `electron-store` 内部依赖的 `conf` → `ajv`）仍包含 CJS `require()` 调用，构建产物通过 `rollupOptions.output.banner` 注入 `createRequire` polyfill：

```typescript
const REQUIRE_POLYFILL = `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`
```

这使得打包后的 ESM 模块中残留的 `require()` 调用能正常工作。

### Preload

`vite.preload.config.ts` 仅覆盖 `rollupOptions.input`，Forge 插件内部默认配置提供 `format: "cjs"` + `inlineDynamicImports: true`。

### Renderer

`vite.renderer.config.ts` 无需特殊配置，Vite 默认输出 ESM。ESM-only 的 `@tanstack/devtools-vite` 可以直接静态导入。

## `__dirname` 替代

ESM 中不存在 `__dirname`、`__filename` 全局变量。使用 `import.meta.url` 替代：

```typescript
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
```

当前仅 `src/main/window.ts` 需要此模式（定位 preload 脚本和 renderer HTML 路径）。

## ESM-only 包处理

| 包                        | 迁移前                    | 迁移后            |
| ------------------------- | ------------------------- | ----------------- |
| `electron-store`          | 动态 `await import()`     | 顶层静态 `import` |
| `@tanstack/devtools-vite` | 注释禁用                  | 直接静态 `import` |
| `font-list`               | Vite `external`（无变化） | 同上              |

## 限制

- **Preload 必须为 CJS**：Electron 沙箱化的 preload 环境使用 `vm.runInNewContext` 执行脚本，不支持 ES module 语法
- **`createRequire` polyfill**：第三方 CJS 依赖被 Rolldown 打包后保留的 `require()` 调用需要此 polyfill；当所有依赖迁移到 ESM 后可移除
- **Forge 插件内部仍为 CJS**：`@electron-forge/plugin-vite` 自身使用 CJS 调用 Vite API，会产生 `The CJS build of Vite's Node API is deprecated` 警告，等待 Forge 8.x 解决

## 涉及文件

- `apps/desktop/vite.main.config.ts` — Main process ESM 构建配置
- `apps/desktop/vite.preload.config.ts` — Preload CJS 构建配置
- `apps/desktop/vite.renderer.config.ts` — Renderer ESM 构建配置 + devtools 启用
- `apps/desktop/src/main/window.ts` — `__dirname` → `import.meta.url` 替代
- `apps/desktop/src/main/settings.ts` — `electron-store` 改为顶层静态导入
- `apps/desktop/src/main/rpc/index.ts` — 移除 CJS lint 抑制注释
