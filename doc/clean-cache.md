# Clean Cache

根目录提供 `clean:cache` 脚本，用于清理依赖目录和常见生成缓存，适合在 workspace 依赖链接异常、Vite / Turbo 缓存疑似污染，或需要重新安装依赖前使用。

## 命令

预览将被清理的路径：

```bash
vp run clean:cache -- --dry-run
```

执行清理：

```bash
vp run clean:cache
```

## 清理范围

- 根目录、`apps/*`、`packages/*` 下的 `node_modules`
- Turbo / Vite / 通用缓存：`.turbo`、`.vite`、`.cache`
- 测试覆盖率与临时状态：`coverage`、`.nyc_output`
- 常见构建输出：`dist`、`out`
- TypeScript 增量缓存：`*.tsbuildinfo`

脚本不会删除 `pnpm-lock.yaml`、源码文件、配置文件或 `.vite-hooks`。

## Desktop Dev

`apps/desktop` 的 Vite 配置会把 `@etyon/i18n`、`@etyon/rpc`、`@etyon/logger` 和 `@etyon/ui` 显式解析到 workspace 源码。这样清理 `packages/*/dist` 后，`vp run dev:desktop` 不需要先手动构建共享包。
