# Check

`pnpm check` 当前已在工作区根目录通过。
`pnpm typecheck` 现在也可以在工作区根目录直接运行，会通过 `turbo` 调用各包的 `typecheck` 脚本。

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
