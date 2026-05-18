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
- **颜色跟随主题**：sidebar 的 `--sidebar` 等项目扩展 token 由 `globals.css` 从 HeroUI `surface` / `default` / `accent` / `separator` token 派生，随当前 `data-theme` 一起变化
- **Liquid glass 兼容**：`[data-liquid-glass]` 覆盖放在 `theme` layer 中，直接半透明化 `background`、`surface`、`overlay`、`sidebar`，并通过兼容别名影响 `card` / `popover`

主题选择由 renderer 把 `lightColorSchema` / `darkColorSchema` 解析为 HeroUI `data-theme`，schema 文件只覆盖 HeroUI 语义 token。

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
- 归档按钮调用 `chatSessions.archive`，主进程写入 `archived_at` 并清空 `pinned_at`。归档后的会话不会再出现在 sidebar active list；如果归档的是当前会话，renderer 会自动跳到列表中的下一个会话，没有下一个会话则回到首页。
- `chatSessions.list` 会在主进程通过 `git status --porcelain=v1 -z` 为每个项目目录补充可选 `gitStatus`；非 Git 目录不展示 Git 元信息。
- Git 变更摘要不再回退为 `5 files` 文案，也不再在 `Projects` 模式下额外占用第二行；会话 item 统一在右侧用小型状态徽标展示 `+1 ~2 -1 R1 ?1`，与右侧 review panel 的新增 / 删除颜色保持一致。

### Chat 项目上下文面板

- Chat 页面通过顶部 `Review` trigger 展开右侧项目上下文面板，不再依赖 `VITE_ENABLE_CHAT_SESSION_DETAILS` 调试开关。
- 面板使用 `@heroui-pro/react` 的 `Resizable` 组织为主聊天区 + 可拖拽右侧面板；chat 路由和 `Resizable` 顶层使用 `h-svh` 建立明确视口高度边界，标题和 `Review` trigger 放在左侧 panel 内，左右 `Panel` 只负责横向尺寸，内部 `h-full` 只在已有明确高度的子级继续使用。
- 主聊天区只保留 header、消息列表和 composer 的全高 flex 布局，不再用 card 容器包裹；外层禁止滚动，只有消息列表在 header 和 composer 的剩余高度内通过 `ScrollShadow` 滚动。
- 消息列表滚动离开底部超过阈值后，会在 messages 区底部显示一个悬浮回到底部按钮；点击后平滑滚回最新消息，不改变 composer 的固定位置。
- 消息 actions 行始终预留高度，但默认隐藏；hover 或 focus 到单条 message 时才显示。Assistant message 保留 `copy / good / bad / regenerate`，user message 显示 `copy / regenerate / edit`；编辑或重新生成 user message 时会截掉其后的模型输出再重新请求。
- Composer 的 `@` 指示器继续按文件夹、文件分组展示项目快照候选项；`$` 指示器专门用于筛选和选择 skills，使用紧凑单行列表展示 skill 名称、描述和来源项目，显式选择后会优先注入对应 skill instructions。
- 右侧 panel 的间距和高度放在独立内容容器中，面板本体保持完整高度和独立滚动，避免右侧内容高度或 padding 反向影响 main 区布局。
- app shell 的折叠侧栏控制区改为绝对浮层，不再占用 chat route 高度；chat 标题行和右侧 panel 顶部 tab bar 使用 `title-bar-drag`，交互按钮使用 `title-bar-no-drag`，保证顶部空间可用于内容且仍能拖动窗口。
- `Review` trigger 使用紧凑 diff stat（例如 `11 +508 -47`）；展开后的面板状态条使用完整文案（例如 `11 files changed +508 -47`）。数字使用千分位分隔，新增为 success，删除为 danger。
- 右侧 panel 本身是一个完整工作区：顶部全局 `Files` / `Changes` / `Commit` tabs 和刷新按钮固定在面板顶部，Git 摘要作为统一状态条展示在 tabs 下方；各 view 的内容区独立滚动，不带动面板 header。
- 右侧 panel 收起时保留窄 toolbar rail，提供 `Files` / `Changes` / `Commit` 图标入口；点击任一入口会先切换目标 view 再展开 panel，`Commit` 图标用 badge 显示变更文件数。
- `Files` view 显示文件树，`Changes` view 显示基于 Git 的 file diff，`Commit` view 显示变更文件列表和提交信息编辑区；Commit 文件路径按右侧 panel 可用宽度换行，状态标签保持固定尺寸；当前 `Commit` 按钮仅作为视图入口，不执行 Git 写操作。
- `Files` view 使用 `@pierre/trees/react`：数据来自 `projectSnapshots.listFiles({ query: "", limit: 5000 })`，传入文件相对路径，并用 `gitStatus.files` 显示变更状态；文件树颜色通过项目 theme token 覆盖 Pierre 默认色。
- `Changes` view 使用 `@pierre/diffs/react`：主进程通过 `git diff --cached` 和 `git diff` 返回 patch，renderer 用 `parsePatchFiles` 拆成多个可折叠 `FileDiff`；diff 背景、gutter、选择态和新增 / 删除色都映射到系统 theme token。
- `Changes` view 的滚动由 view 内容区统一持有，单个 diff 卡片不再整块 sticky，避免滚动条移动但高内容卡片仍停留在视口内。
- Git 摘要和文件树会区分新增 / 删除 / 修改 / 重命名 / 未跟踪状态，其中新增使用 success，删除使用 danger。
- 当前 diff 只展示 tracked file patch；untracked 文件会出现在 Git 摘要和文件树状态中，但不会展开为 patch 内容。

### Projects 树

- `projects` 模式下，`Pinned Threads` 下方新增固定总头部 `PROJECTS`，右侧展示 `项目数 / 会话数` 的 `tabular-nums` 计数胶囊。
- 总头部 hover 或 focus-within 时显示新增按钮，图标使用 Hugeicons `FileAddIcon`；点击后通过 Electron `dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] })` 选择目录。
- 主进程 `pick-project-directory` IPC 需要按 Electron 的重载显式分支：有 sender 对应窗口时调用 `dialog.showOpenDialog(window, options)`，否则调用 `dialog.showOpenDialog(options)`；不要传 `undefined` 作为第一个参数占位，否则 `TypeScript` 会命中错误的签名。
- 目录选择确认后，renderer 通过 `window.electron.ipcRenderer.invoke("pick-project-directory")` 拿到路径，再调用 `chatSessions.create({ projectPath })` 创建并打开一个绑定该项目目录的新会话。
- 顶部 `New Chat` 保持原语义：继续继承当前会话或最近会话的 `projectPath`；总头部新增按钮用于显式添加新的项目入口，两条路径并存。
- 单个 `project` 分组仍支持独立折叠，折叠状态通过 `collapsedProjectPaths` 持久化并跨窗口同步；`sidebarWidthPx` 继续单独持久化。
- 单个 `project` 分组 hover / focus 时显示更多操作按钮，使用 HeroUI Dropdown 渲染 DOM 菜单，不走 Electron native menu。菜单项包括置顶/取消置顶项目、在系统文件管理器中打开、重命名项目、归档该项目 chats、移除项目。
- 项目重命名只写入 `sidebarUiState.projectDisplayNames` 作为侧边栏显示名，不移动磁盘目录；项目置顶写入 `sidebarUiState.projectPins`，置顶项目排在普通项目前。
- `Archive chats` 会软归档该项目下所有 active chats；`Remove` 会删除该项目对应的本地 chat rows，并清理项目显示名、置顶和折叠状态，但不会删除磁盘上的项目文件夹。
- `Open in Finder / Explorer / File Manager` 由 renderer 调用 `open-project-in-file-manager` IPC，主进程校验路径存在后通过 Electron `shell.openPath(projectPath)` 打开目录。

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
