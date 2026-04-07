# Home

主窗口首页现在是一个纯 renderer 的简洁落地页，不再在首屏发起 `orpc.ping` 或 `rpcClient.ping()` 的演示请求。

## 目标

- 作为主窗口的 landing surface，保留 `New Chat`、`Configure Provider` 和 `Settings` 三个主动作
- `New Chat` 当前只触发本地 mock 状态提示，不依赖后端或 IPC 数据请求
- `Configure Provider` 当前复用 `open-settings` IPC，后续对接 Settings 页的 Providers tab
- `Settings` 复用现有 `open-settings` IPC，直接打开独立的 Settings 窗口

## 布局

主窗口采用 `@etyon/ui` 的 `SidebarProvider` + `Sidebar` + `SidebarInset` 布局：

```text
SidebarProvider
├── AppSidebar (left, collapsible="offcanvas")
│   ├── SidebarHeader (title-bar-drag + action buttons)
│   │   └── [SidebarTrigger] [Search] [NewChat]
│   ├── SidebarContent (future chat sessions)
│   └── SidebarFooter
└── SidebarInset
    ├── header (title-bar-drag, collapsed-only action buttons with motion)
    │   └── AnimatePresence → [SidebarTrigger] [Search] [NewChat] (fade+slide)
    └── <Outlet /> (HomePage)
```

- **Sidebar** 位于左侧，使用 `collapsible="offcanvas"` 模式，支持 `Cmd+B` / `Ctrl+B` 快捷键切换
- **SidebarHeader** 包含 3 个 action 按钮（SidebarTrigger、Search、New Chat），`pl-[72px]` 为 macOS traffic light 留出空间，`title-bar-no-drag` 确保按钮可点击
- **SidebarContent** 当前为空占位，后续用于展示 Chat Session 列表
- **SidebarInset** 内部顶部为 `title-bar-drag` header；sidebar 折叠时通过 `AnimatePresence` + `motion.div` 展示全部 3 个 action 按钮（SidebarTrigger、Search、New Chat），入场 100ms delay + 200ms fade-slide，退场 120ms fast-out，与 sidebar offcanvas 过渡交叉淡入淡出
- 内容区 `<Outlet />` 渲染 `HomePage` 组件
- 首页动效维持轻量 fade + y 轴位移，沿用 `SETTINGS_PAGE_EASE_CURVE`
- `SidebarProvider` 仅在 Home 路由 (`/`) 生效；其他路由（如 `/settings`）保持原有 TitleBar 布局

### Sidebar 折叠动画

所有过渡统一使用 `ease-out-quart`（`cubic-bezier(0.25, 1, 0.5, 1)`）：

- **sidebar-gap** — `transition-[width] duration-300`，gap 从 `16rem` 收缩到 `0`
- **sidebar-container** — `transition-[left,right,width] duration-300`，折叠时完全移出屏幕（`left: calc(var(--sidebar-width) * -1)`），`pointer-events-none` 防止透明区域拦截点击
- **sidebar-inner** — `transition-opacity duration-150`，比 container 的位移提前完成，创造"内容在到达 traffic light 位置前已完全淡出"的效果
- **InsetHeader padding** — `transition-[padding] duration-300`，`pl-[76px]` 切换与 sidebar 同步
- **collapsed buttons** — `motion.div` 入场 delay 100ms + 200ms（等 sidebar 内容淡出后再出现），退场 120ms（在 sidebar 开始展开前快速消失）
- 折叠/展开在 traffic light 位置形成自然交叉淡入淡出：sidebar 内容淡出 → collapsed buttons 淡入，collapsed buttons 淡出 → sidebar 内容淡入

### Sidebar 视觉风格

Sidebar 采用 **卡片嵌入式侧栏** 设计语言：

- **大圆角容器**：`rounded-2xl`，外层 `p-1.5` 间距，sidebar-inner 和 `collapsible="none"` 模式均带 `rounded-2xl` + `m-1.5`
- **柔和阴影分层**：`shadow-[0_2px_8px_0_oklch(0_0_0/0.15),0_0_0_1px_oklch(1_0_0/0.04)_inset]`，弱化边框存在感，通过阴影和背景差异定义区域
- **颜色跟随主题**：sidebar 的 `--sidebar` 等 CSS 变量保持在 `default-theme` layer 中为中性值（light 浅、dark 深），custom theme 在 `color-schemas` layer 中正常覆盖
- **Liquid glass 兼容**：`[data-liquid-glass]` 覆盖放在 `default-theme` layer 中（与 `:root` / `.dark` 同层级），没有 custom theme 时生效半透明值，有 custom theme 时被 `color-schemas` layer 覆盖

CSS 变量 layer 优先级：`default-theme` < `color-schemas`。Liquid glass 覆盖在 `default-theme` 中，确保 custom theme 完整还原。

### Sidebar 组件来源

使用 `@etyon/ui/components/sidebar`，该组件基于 shadcn/ui Sidebar，提供：

- `SidebarProvider` — 状态上下文（展开/折叠、移动端适配）
- `Sidebar` — 侧边栏容器（支持 `collapsible` 模式：`offcanvas` / `icon` / `none`）
- `SidebarInset` — 主内容区（`<main>` 语义元素，自动响应 sidebar 状态）
- `SidebarTrigger` — 切换按钮
- CSS 变量：`--sidebar-width`（默认 `16rem`）、`--sidebar-width-icon`（默认 `3rem`）
- 颜色 token：`bg-sidebar`、`text-sidebar-foreground`、`bg-sidebar-accent` 等

### Chat session 列表行

- 会话行外层 `flex items-center`：左侧 pin 为独立 `button`（`showPinAction` 时），中间为打开会话的主 `button`（标题 + git diff 元数据 + 时间列），与时间列对齐的归档为兄弟 `button` 绝对定位叠放，避免 `button` 嵌套。
- 时间列固定 `min-w-8`；归档默认隐藏（`opacity-0` + `pointer-events-none`），在 `SidebarMenuItem` 的 `group/menu-item` 上通过 `group-hover` 与 `group-focus-within` 显示并启用点击，时间文案同步淡出。

### Projects 树

- `projects` 模式下，`Pinned Threads` 下方新增固定总头部 `PROJECTS`，右侧展示 `项目数 / 会话数` 的 `tabular-nums` 计数胶囊。
- 总头部 hover 或 focus-within 时显示新增按钮，图标使用 Hugeicons `FileAddIcon`；点击后通过 Electron `dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] })` 选择目录。
- 主进程 `pick-project-directory` IPC 需要按 Electron 的重载显式分支：有 sender 对应窗口时调用 `dialog.showOpenDialog(window, options)`，否则调用 `dialog.showOpenDialog(options)`；不要传 `undefined` 作为第一个参数占位，否则 `TypeScript` 会命中错误的签名。
- 目录选择确认后，renderer 通过 `window.electron.ipcRenderer.invoke("pick-project-directory")` 拿到路径，再调用 `chatSessions.create({ projectPath })` 创建并打开一个绑定该项目目录的新会话。
- 顶部 `New Chat` 保持原语义：继续继承当前会话或最近会话的 `projectPath`；总头部新增按钮用于显式添加新的项目入口，两条路径并存。
- 单个 `project` 分组仍支持独立折叠，折叠状态通过 `collapsedProjectPaths` 持久化并跨窗口同步；`sidebarWidthPx` 继续单独持久化。

## i18n

- `home` 命名空间保留首页真实文案
- 新增 `home.actions.configureProvider`（en-US: "Configure Provider" / zh-CN: "配置 Provider" / ja-JP: "プロバイダー設定"）
- 新增 `home.sidebar.search`（en-US: "Search" / zh-CN: "搜索" / ja-JP: "検索"）
- 新增 `home.sidebar.toggleSidebar`（en-US: "Toggle Sidebar" / zh-CN: "切换侧边栏" / ja-JP: "サイドバーを切り替え"）
- `app-sidebar.tsx` 和 `__root.tsx` 的 tooltip、`aria-label` 均使用 `useI18n({ keyPrefix: "home" })` 读取翻译，复用 `home.actions.newChat` 作为 New Chat 按钮文案

## 涉及文件

- `apps/desktop/src/renderer/components/app-sidebar.tsx` — 主窗口侧边栏组件
- `apps/desktop/src/renderer/routes/__root.tsx` — 根布局，Home 路由引入 SidebarProvider
- `apps/desktop/src/renderer/routes/index.tsx` — 首页组件
- `packages/ui/src/components/sidebar.tsx` — Sidebar 组件源码
