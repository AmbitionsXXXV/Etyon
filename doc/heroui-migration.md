# HeroUI 迁移记录

## 当前边界

- `@etyon/ui/components/*` 仍然是业务侧唯一稳定入口，`apps/desktop` 暂不批量改 import。
- React 端不引入 `HeroUIProvider`；HeroUI v3 组件通过组件本身和 CSS token 工作。
- HeroUI 依赖放在真正消费组件的 `packages/ui`，`apps/desktop` 不直接持有 `@heroui-pro/react`。
- 核心包装层采用薄适配：组件内部直接使用 HeroUI 组件，旧 shadcn prop 只保留必要桥接，不继续复制旧视觉设计。
- 核心差异集中在 app theme build 和 token 扩展层处理，业务组件不再承担样式兼容逻辑。

## 样式系统共存

- `packages/ui/src/styles/globals.css` 的导入顺序是：
  `tailwindcss` -> `@heroui/styles` -> `@heroui-pro/react/css` -> `tw-animate-css` -> `shadcn/tailwind.css` -> 项目主题文件。
- 以 HeroUI 语义 token 为主：`surface`、`overlay`、`separator`、`default`、`success`、`warning`、`danger`、`segment`、`surface-shadow`、`overlay-shadow`。
- 旧 shadcn / Etyon 变量继续存在，并映射到 HeroUI token：`background`、`card`、`popover`、`sidebar`、`input`、`border`、`ring` 等调用点不需要立刻迁移。
- 现有 color schema 文件继续覆盖旧变量；全局 `color-schemas` layer 会把这些旧变量再映射回 HeroUI 主 token，避免两套颜色源互相覆盖。
- 液态玻璃模式继续覆盖 `background`、`card`、`popover`、`sidebar`，并同步覆盖 `surface`、`overlay`。

## 已迁移组件

- `Button`：直接使用 HeroUI `Button`，仅桥接旧 `variant`、`size`、`disabled`、`onClick` 和元素式 `render`。
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

- `rtk vp install`
- `rtk vp run ui#typecheck`
- `rtk vp run desktop#typecheck`
- `rtk vp check`
- `rtk vp run desktop#dev`
