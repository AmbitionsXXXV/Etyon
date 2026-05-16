# HeroUI 迁移记录

## 当前边界

- `apps/desktop` 业务侧可以对已完成 API 对齐的基础组件直接 import `@heroui/react`，优先从高频动作组件开始。
- `@etyon/ui/components/*` 仍然保留为共享组件和未完成迁移组件的稳定入口，避免一次性改动 `Dialog`、`Select`、`Combobox`、`Sidebar` 等复杂组合。
- React 端不引入 `HeroUIProvider`；HeroUI v3 组件通过组件本身和 CSS token 工作。
- HeroUI 基础组件依赖放在真正消费组件的 package 中；`apps/desktop` 直接使用 `@heroui/react` 时需要声明直接依赖。
- Pro 组件仍由 `packages/ui` 消费，`apps/desktop` 暂不直接持有 `@heroui-pro/react`。
- 核心包装层采用薄适配：组件内部直接使用 HeroUI 组件，旧 shadcn prop 只保留必要桥接，不继续复制旧视觉设计。
- 核心差异集中在 app theme build 和 token 扩展层处理，业务组件不再承担样式兼容逻辑。

## 样式系统共存

- `packages/ui/src/styles/globals.css` 的导入顺序是：
  `tailwindcss` -> `@heroui/styles` -> `@heroui-pro/react/css` -> `tw-animate-css` -> `shadcn/tailwind.css` -> 项目主题文件。
- 以 HeroUI 语义 token 为主：`surface`、`overlay`、`separator`、`default`、`success`、`warning`、`danger`、`segment`、`surface-shadow`、`overlay-shadow`。
- 主题切换使用 HeroUI v3 推荐的 `data-theme`：`default` 会解析为 `light` / `dark`，内置 schema 会解析为 `one-light`、`paper`、`aquarium` 等具体主题名。
- 现有 color schema 文件直接覆盖 HeroUI 主 token：`accent`、`background`、`foreground`、`surface`、`overlay`、`default`、`field-*`、`success`、`warning`、`danger`、`segment`、`border`、`separator`、`focus`、`link`。
- 旧 shadcn / Etyon 变量只作为兼容别名存在，并映射到 HeroUI token：`primary -> accent`、`secondary -> default`、`card -> surface`、`popover -> overlay`、`ring -> focus`、`destructive -> danger`。
- `sidebar-*`、`chart-*`、`muted-foreground`、`input` 仍是项目扩展 token，但由 `globals.css` 统一从 HeroUI token 派生，schema 文件不再单独维护这些项目变量。
- 液态玻璃模式继续覆盖 `background`、`surface`、`overlay`、`sidebar`，并通过兼容别名自动影响 `card`、`popover` 等旧调用点。

## 已迁移组件

- `apps/desktop` 业务侧 `Button`：直接使用 `@heroui/react` 的 `Button`，按 HeroUI v3 使用 `onPress`、`isDisabled`、`isIconOnly`、`variant="danger-soft"` 等语义 prop。
- `@etyon/ui` 内部 `Button`：暂保留薄适配层，继续服务共享组件内部和未迁移调用点，只桥接旧 `variant`、`size`、`disabled`、`onClick` 和元素式 `render`。
- `Input` / `Textarea`：直接使用 HeroUI `Input` / `TextArea`，仅桥接旧 `disabled` 写法。
- `Badge`：直接使用 HeroUI `Badge`，旧 variant 只映射到 HeroUI `color` / `variant`。
- `Separator`：直接使用 HeroUI `Separator`。
- `Empty`：根节点使用 HeroUI `EmptyState`，子组件保持原有导出。
- `Switch` / `Checkbox`：直接使用 HeroUI compound API，仅桥接旧 `checked`、`defaultChecked`、`onCheckedChange`。

## 暂保留组件

- `Tooltip`：当前调用依赖 Base UI 的元素式 `render` API，暂保留现有实现。
- `Dialog` / `Sheet`：当前关闭按钮、portal、overlay 和动画依赖 Base UI Dialog API，后续单独迁移。
- `Select` / `Combobox`：当前 positioner、scroll arrow、chips、input-group 组合较深，后续按组件逐个复刻。
- `Sidebar`：继续作为单独阶段处理。现有桌面固定、offcanvas、动画、宽度调整和 macOS 交通灯避让逻辑不能直接替换。

## 验证命令

- `vp run ui#typecheck`
- `vp run desktop#typecheck`
- `vp check`
- `vp run desktop#dev`
