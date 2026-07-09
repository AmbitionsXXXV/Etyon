# Check

`vp check` 当前已在工作区根目录通过。 `vp lint` 当前也可以在工作区根目录通过；`packages/ui` 需要使用 `vp lint`，不能直接调用 IDE 专用的 `oxlint` 包装命令。 `vp run typecheck` 现在也可以在工作区根目录直接运行，会通过 `turbo` 调用各包的 `typecheck` 脚本。 `vp test` 现在会读取根目录 [`vite.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/vite.config.ts) 的 `test.projects`，统一运行 monorepo 里的测试项目。

## Tests

- 根目录统一跑测试：`vp test`
- 根目录 watch 模式：`vp test watch`
- 只跑桌面端测试：在 `apps/desktop` 下执行 `vp test`
- 只跑 `RPC` 测试：在 `packages/rpc` 下执行 `vp test`
- 每个 package 的测试集中放在包内 `test/` 目录，不和 `src/` 业务代码混放；子项目 `vite.config.ts` 的 `test.include` 只扫描 `test/**/*.test.ts`

当前根目录 `test.projects` 已接入以下项目：

- [`apps/desktop/vite.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/vite.config.ts)
- [`packages/rpc/vite.config.ts`](/Users/jiantianjianghui/Web_Project/Etyon/packages/rpc/vite.config.ts)

首批行为测试覆盖：

- [`packages/rpc/test/schemas/settings.test.ts`](/Users/jiantianjianghui/Web_Project/Etyon/packages/rpc/test/schemas/settings.test.ts)：`Moonshot` / `Z.AI` provider 默认值与旧配置补齐
- [`apps/desktop/test/shared/providers/provider-catalog.test.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/test/shared/providers/provider-catalog.test.ts)：providers tab 可见项与 seed models 补水
- [`apps/desktop/test/main/providers/fetch-provider-models.test.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/test/main/providers/fetch-provider-models.test.ts)：上游 `/models` 抓取归一化与 seed capabilities 回填

## 本次修复

- 给 [`apps/desktop/tsconfig.json`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/tsconfig.json) 补上 `rootDir: "../.."`，让桌面端 `typecheck` 在直接引用 workspace 源码包时不再触发 `TS6059`
- 修复桌面端设置页的几处类型错误：
  - `drizzle.config` 测试先做 `dbCredentials` 保护性收窄，再断言 SQLite URL
  - 自定义主题文案工具函数改用 `@etyon/i18n` 的 `TranslationKey` / `TranslationValues`
  - `Select` 的 `onValueChange` 回调显式处理 `null`
  - `TanStack Hotkeys Devtools` 面板通过插件回调透传 `theme` 和 `devtoolsOpen`
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
- 从 `shadcn` 或第三方模板拷贝组件后，先跑一次 `vp check`
- 需要持久化浏览器侧状态时，优先使用平台 API 或封装，不要直接写 `document.cookie`
