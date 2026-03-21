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
│   ├── SidebarHeader (title-bar-drag, traffic light zone)
│   ├── SidebarContent (future chat sessions)
│   └── SidebarFooter
└── SidebarInset
    ├── header (title-bar-drag + SidebarTrigger)
    └── <Outlet /> (HomePage)
```

- **Sidebar** 位于左侧，使用 `collapsible="offcanvas"` 模式，支持 `Cmd+B` / `Ctrl+B` 快捷键切换
- **SidebarHeader** 预留 macOS traffic light 拖拽区域（`title-bar-drag` + `pt-6`）
- **SidebarContent** 当前为空占位，后续用于展示 Chat Session 列表
- **SidebarInset** 内部顶部为 `title-bar-drag` header，包含 `SidebarTrigger` 按钮
- 内容区 `<Outlet />` 渲染 `HomePage` 组件
- 首页动效维持轻量 fade + y 轴位移，沿用 `SETTINGS_PAGE_EASE_CURVE`
- `SidebarProvider` 仅在 Home 路由 (`/`) 生效；其他路由（如 `/settings`）保持原有 TitleBar 布局

### Sidebar 组件来源

使用 `@etyon/ui/components/sidebar`，该组件基于 shadcn/ui Sidebar，提供：

- `SidebarProvider` — 状态上下文（展开/折叠、移动端适配）
- `Sidebar` — 侧边栏容器（支持 `collapsible` 模式：`offcanvas` / `icon` / `none`）
- `SidebarInset` — 主内容区（`<main>` 语义元素，自动响应 sidebar 状态）
- `SidebarTrigger` — 切换按钮
- CSS 变量：`--sidebar-width`（默认 `16rem`）、`--sidebar-width-icon`（默认 `3rem`）
- 颜色 token：`bg-sidebar`、`text-sidebar-foreground`、`bg-sidebar-accent` 等

## i18n

- `home` 命名空间保留首页真实文案
- 新增 `home.actions.configureProvider`（en-US: "Configure Provider" / zh-CN: "配置 Provider" / ja-JP: "プロバイダー設定"）

## 涉及文件

- `apps/desktop/src/renderer/components/app-sidebar.tsx` — 主窗口侧边栏组件
- `apps/desktop/src/renderer/routes/__root.tsx` — 根布局，Home 路由引入 SidebarProvider
- `apps/desktop/src/renderer/routes/index.tsx` — 首页组件
- `packages/ui/src/components/sidebar.tsx` — Sidebar 组件源码
