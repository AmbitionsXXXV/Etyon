# TanStack Table v9

**核对及升级日期：** 2026-08-10（Asia/Tokyo）。本项目现在使用稳定版 `@tanstack/react-table@9.1.2`；该版本要求 Node.js `>=20`、React `>=18`，与 Etyon 的 Node.js 24 和 React 19 兼容。[官方 release](https://github.com/TanStack/table/releases/tag/%40tanstack%2Freact-table%409.1.2)

## Etyon 实现

`apps/desktop` 通过根 `catalog` 声明该依赖，锁文件解析为 `9.1.2`。设置页的“Recent Commands”表格使用 TanStack Table 生成列、表头、行和单元格模型；HeroUI Table 继续负责语义化标记、视觉样式和无障碍行为。

该表目前只是最多十行的只读展示，没有排序、筛选或分页。因此它只使用 `tableFeatures({})` 的核心行模型，没有引入 `stockFeatures` 或未使用的状态能力：

```tsx
const features = tableFeatures({})
const helper = createColumnHelper<typeof features, RecentCommand>()

const table = useTable({
  columns,
  data,
  features,
  getRowId: (command) => `${command.timestampLabel}-${command.command}`
})
```

渲染时必须通过实例方法读取模型，并使用 `<table.FlexRender>` 渲染列定义的 header 和 cell。不要把 `row`、`cell`、`column` 或 `header` 的实例方法解构后作为独立函数调用；v9 的这些方法依赖实例 `this`。

## 后续扩展

TanStack Table 是无渲染层的数据模型。后续若增加排序、筛选、分页等交互，应只注册实际需要的 feature 及其对应 row-model factory，例如排序使用 `rowSortingFeature` 加 `createSortedRowModel()`。不要使用 `stockFeatures` 作为默认配置；同时保持 TanStack 作为状态的唯一来源，HeroUI 只负责呈现和交互外观。

TanStack 随包提供与已安装版本对应的 v9 指引：`node_modules/@tanstack/react-table/skills/getting-started/SKILL.md` 和 `node_modules/@tanstack/table-core/skills/table-features/SKILL.md`。旧的 HeroUI TanStack demo 仍是 v8 API 示例，不能复制其中的 `useReactTable` 或 `getCoreRowModel()` 配置。
