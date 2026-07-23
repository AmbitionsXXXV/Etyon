# TanStack Table v9 调研

**核对日期：** 2026-07-21（Asia/Tokyo）。本报告只采用 npm、TanStack 官方站和 `TanStack/table` 仓库的一手资料。

## 结论

截至核对日，`@tanstack/react-table` 的正式稳定线仍是 **v8.21.3**；v9 已公开发布，但仅为 **`9.0.0-beta.55` 预发布版**，不应当作为生产依赖升级目标。TanStack 官方网站的 `latest` 文档明确显示为 **v8**，访问 `/table/v9/...` 会以 `307` 跳回 `/table/latest/...`；因此不存在已上线的 v9 官方网站文档或稳定版迁移承诺。

仓库的 v9 beta 源码内已包含完整的 React v8 -> v9 迁移文档，可作为 beta.55 的实现依据，但它随 beta 仍可能变动，不能替代稳定迁移指南。

## 发布状态与证据

| 范围 | 已核实事实 | 一手来源 |
| --- | --- | --- |
| npm | `latest` = `8.21.3`；`beta` = `9.0.0-beta.55`；`alpha` = `9.0.0-alpha.54`。 | [npm registry 元数据](https://registry.npmjs.org/@tanstack%2Freact-table) |
| GitHub release | 最新 release 为 `v9.0.0-beta.55`，标记 `prerelease: true`，于 2026-07-17 发布；`v8.21.3` 是非预发布 release。 | [v9 beta.55 release](https://github.com/TanStack/table/releases/tag/v9.0.0-beta.55)；[v8.21.3 release](https://github.com/TanStack/table/releases/tag/v8.21.3) |
| 分支 | 仓库默认分支为 `beta`；同时有 `main`、`alpha`、`v6`、`v7` 等分支。分支列表没有 `v9` 分支，v9 以 `beta` 分支和 `v9.0.0-beta.*` 标签推进。 | [仓库元数据](https://api.github.com/repos/TanStack/table)；[分支 API](https://api.github.com/repos/TanStack/table/branches?per_page=100) |
| 公网文档 | `latest` 页的产品版本标签为 v8；`/table/v9/docs/introduction` 和 `/table/v9/docs/guide/migrating` 均重定向至 `latest`。 | [v8 Introduction](https://tanstack.com/table/latest/docs/introduction)；[v8 迁移页](https://tanstack.com/table/latest/docs/guide/migrating) |
| beta 迁移材料 | `v9.0.0-beta.55` 标签内有 React v8 -> v9 指南及随包分发的迁移 skill；这是源码级一手材料，尚非上述公网 v9 文档。 | [React migration guide](https://github.com/TanStack/table/blob/v9.0.0-beta.55/docs/framework/react/guide/migrating.md)；[migration skill](https://github.com/TanStack/table/blob/v9.0.0-beta.55/packages/react-table/skills/migrate-v8-to-v9/SKILL.md) |

## 已证实的 v8 -> v9 变化

以下均以 `9.0.0-beta.55` 的 React 迁移指南为准，且会随后续 beta 改动。

- 构造：`useReactTable(options)` 改为 `useTable({ features, ...options })`；`features` 是必填的显式能力注册表。`stockFeatures` 可暂时取得近似 v8 的全功能行为，但会增大包体。
- 行模型与函数注册：v8 的 `getCoreRowModel()` 不再配置（核心行模型自动提供）；过滤、排序、分页等 `get*RowModel()` 改为 `tableFeatures()` 内的 `create*RowModel()` 槽位。`filterFns`、`sortingFns`、`aggregationFns` 也移入 features，其中排序名称改为 `sortFns`。
- 状态：移除 `table.getState()` 与顶层 `onStateChange`；改用 `table.state`、`table.store`、`table.atoms`，或受控的 `state.<slice>` + `on<Slice>Change`。React 适配器还提供选择器和 `table.Subscribe`。
- 类型与实例：核心类型新增 `TFeatures` 泛型；`createColumnHelper` 也需要 feature 类型。行、单元格、列、表头的方法改由原型共享，不能解构或作为裸回调调用，否则会丢失 `this`。
- 语义/API：列固定从物理 `left` / `right` 改为逻辑 `start` / `end`；列尺寸与拖拽拆为 `columnSizingFeature` / `columnResizingFeature`；`sortingFn` 改为 `sortFn`；所有下划线内部 API 均移除。
- 过渡层：`@tanstack/react-table/legacy` 提供已标记为 deprecated 的 `useLegacyTable`，只适合逐步迁移期间短暂使用，不是最终架构。

迁移前还必须确认 `react >=18` 与 `node >=20`：这是 beta.55 包的 peer dependency 和 engine 要求。[beta package 元数据](https://registry.npmjs.org/@tanstack%2Freact-table/9.0.0-beta.55)

## 对 Etyon 的含义

- **React 19：** 当前项目使用 React 19，且根 `engines` 为 Node `>=22.13.0`，满足 beta.55 的最低运行条件；这只是依赖范围兼容，不代表 v9 beta 已获得项目级或生产稳定性验证。[根 package.json](../package.json)
- **HeroUI v3 Table：** 现有设置页已经直接以 `@heroui/react` 的 `Table` 复合组件渲染表格，且项目未依赖 `@tanstack/react-table`。[现有表格实现](../apps/desktop/src/renderer/components/settings/token-savings-tab.tsx)

### HeroUI 的 TanStack v8 demo 与项目匹配

HeroUI v3 的官方 Table 文档明确将 Table 定位为 headless table library 的渲染层，并提供 [TanStack Table demo](../.heroui-docs/react/demos/table/tanstack-table.tsx)。该 demo 使用稳定 v8 的 `useReactTable`、`getCoreRowModel()`、`getSortedRowModel()`、`getPaginationRowModel()` 和 `flexRender()`，再将 header groups、rows、cells 分别渲染为 `Table.Header`、`Table.Body` 与 `Table.*`；这与 TanStack 的 [v8 React basic demo](https://github.com/TanStack/table/blob/v8.21.3/examples/react/basic/src/main.tsx) 一致。

- demo 以唯一的 TanStack `sorting` state 为事实来源，并在 `Table.Content` 的 `sortDescriptor` / `onSortChange` 与 TanStack `SortingState` 之间转换；HeroUI 负责排序控件的外观与无障碍，TanStack 负责排序后的行模型。
- 这正是复杂设置列表应采用的方向：HeroUI 继续负责语义标记、样式和无障碍外观，TanStack 负责列定义、行模型、排序/筛选/分页状态，并通过 `flexRender` 映射到 `Table.*`。排序、选择、分页状态必须只有一个所有者，不能同时让两套状态机控制。
- 当前 `RecentCommandsTable` 只是轻量展示，没有排序、分页或筛选需求，保持 HeroUI 原生 Table 更合适。需要复杂表格时，应先复用该 v8 demo 的边界设计。
- 此 demo **不是 v9 示例**：它直接依赖 `useReactTable`、`get*RowModel()` 与 `table.getState()`。升级到 v9 时必须按 beta migration guide 改写为 `useTable`、`tableFeatures()`、`create*RowModel()` 和新的状态读取方式，不能混用两套 API。

## 风险与建议

1. 当前只需要展示数据的表格应继续使用 HeroUI v3 Table；没有必要为了静态/轻量列表增加 headless grid 依赖。
2. 若现在必须建设复杂客户端表格，选择稳定的 v8 作为单独的、可测试的实施决策；本调研不修改依赖。v9 beta 不应直接进入生产。
3. 若要评估 v9，建立隔离 PoC，精确锁定 `9.0.0-beta.55`，仅注册实际用到的 features，并验证排序、筛选、分页、选择、列固定、列宽及受控状态。不要以 `stockFeatures` 或 `useLegacyTable` 作为最终方案。
4. 等待 v9 stable、官方 `/table/v9` 文档上线和正式 release notes 后，再以当时精确版本重新核对迁移指南；beta.38、beta.48/49 已经出现 pinning 与 aggregation 的破坏性调整，说明 beta API 仍在演进。
