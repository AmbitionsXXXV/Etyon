# Check

`pnpm check` 当前已在工作区根目录通过。
`pnpm lint` 当前也可以在工作区根目录通过；`packages/ui` 需要使用 `vp lint`，不能直接调用 IDE 专用的 `oxlint` 包装命令。
`pnpm typecheck` 现在也可以在工作区根目录直接运行，会通过 `turbo` 调用各包的 `typecheck` 脚本。
`pnpm test` 现在会使用根目录的 [`vitest.workspace.ts`](/Users/jiantianjianghui/Web_Project/Etyon/vitest.workspace.ts) 统一运行 monorepo 里的 `Vitest` 项目。

## Tests

- 根目录统一跑测试：`pnpm test`
- 根目录 watch 模式：`pnpm test:watch`
- 只跑桌面端测试：`pnpm --filter @etyon/desktop test`
- 只跑 `RPC` 测试：`pnpm --filter @etyon/rpc test`

当前 `Vitest` workspace 已接入以下项目：

- [`apps/desktop/vitest.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/vitest.config.ts)
- [`packages/rpc/vitest.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/packages/rpc/vitest.config.ts)

首批行为测试覆盖：

- [`packages/rpc/src/schemas/settings.test.ts`](/Users/jiantianjianghui/Web_Project/Etyon/packages/rpc/src/schemas/settings.test.ts)：`Moonshot` / `Z.AI` provider 默认值与旧配置补齐
- [`apps/desktop/src/shared/providers/provider-catalog.test.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/src/shared/providers/provider-catalog.test.ts)：providers tab 可见项与 seed models 补水
- [`apps/desktop/src/main/providers/fetch-provider-models.test.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/src/main/providers/fetch-provider-models.test.ts)：上游 `/models` 抓取归一化与 seed capabilities 回填

## 本次修复

- 删除了 `apps/desktop/src/renderer/components/sidebar/` 和 `apps/desktop/src/renderer/lib/sidebar/` 下未被引用的空占位文件，避免 `no-empty-file` 失败
- 调整了 [`packages/ui/src/components/sidebar.tsx`](/Users/jiantianjianghui/Web_Project/Etyon/packages/ui/src/components/sidebar.tsx)，消除以下 `Ultracite` / `Oxlint` 问题：
  - 去掉参数重赋值
  - 去掉否定条件表达式
  - 去掉作用域变量遮蔽
  - 给原生 `button` 补充 `type="button"`
  - 将内联点击函数改为稳定回调
  - 用 `Cookie Store API` 替代直接写 `document.cookie`

## 约束

- 不要提交空文件占位符；如果暂时不实现，宁可不创建文件
- 从 `shadcn` 或第三方模板拷贝组件后，先跑一次 `pnpm check`
- 需要持久化浏览器侧状态时，优先使用平台 API 或封装，不要直接写 `document.cookie`
