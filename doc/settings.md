# Settings

应用级用户设置，支持主题切换、字体配置，通过 `electron-store` 持久化存储。Settings 作为独立的 Electron 原生窗口打开。

## 架构

```text
Main (createSettingsWindow)
  ↓ BrowserWindow(?window=settings)
Renderer (index.tsx 分流)
  ↓ SettingsPage 组件
  ↓ oRPC
Main (settings.ts + electron-store)
  ↓ JSON
~/.config/etyon/settings.json
```

### 窗口模型

Settings 使用独立的 `BrowserWindow`，与主窗口共享同一 renderer 入口（通过 URL 参数 `?window=settings` 分流）。

- 单例模式：重复打开时 focus 已有窗口
- 固定尺寸 680x520，不可缩放/最大化
- macOS: `titleBarStyle: "hidden"` + 红绿灯
- Windows/Linux: `titleBarOverlay`

### 包结构

| 层级               | 路径                                                     | 职责                                                                                                                           |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Schema             | `packages/rpc/src/schemas/settings.ts`                   | Zod schema 定义（`AppSettingsSchema`、`ThemeSchema`、`UpdateSettingsSchema`）                                                  |
| Font Schema        | `packages/rpc/src/schemas/fonts.ts`                      | `FontListOutputSchema` — 系统字体列表返回值 schema                                                                             |
| Main Store         | `apps/desktop/src/main/settings.ts`                      | `electron-store` 封装（ESM 顶层静态导入），提供 `getSettings()` / `updateSettings()`，持久化到 `~/.config/etyon/settings.json` |
| Main Fonts         | `apps/desktop/src/main/fonts.ts`                         | `listSystemFonts()` — 跨平台系统字体枚举（macOS/Linux/Windows），带内存缓存                                                    |
| RPC Router         | `apps/desktop/src/main/rpc/router.ts`                    | `settings.get` / `settings.update` / `fonts.list` 路由                                                                         |
| Window             | `apps/desktop/src/main/window.ts`                        | `createSettingsWindow()` 单例窗口创建                                                                                          |
| Menu               | `apps/desktop/src/main/menu.ts`                          | 原生菜单，含 Settings 菜单项，直接调用 `createSettingsWindow()`                                                                |
| IPC                | `apps/desktop/src/main/index.ts`                         | `open-settings` IPC handler，供 renderer 快捷键触发                                                                            |
| Settings Component | `apps/desktop/src/renderer/components/settings-page.tsx` | 设置页面 UI 组件（分区布局、骨架与动效编排）                                                                                   |
| Settings Page Lib  | `apps/desktop/src/renderer/lib/settings-page/`           | 草稿状态 hook、导航与选项数据、色板 swatch 常量、动效与侧栏宽度常量（与 UI 组件解耦）                                          |
| Renderer Entry     | `apps/desktop/src/renderer/index.tsx`                    | URL 参数分流：`?window=settings` 渲染 SettingsPage，否则渲染主应用                                                             |
| Settings Lib       | `apps/desktop/src/renderer/lib/settings.ts`              | `applySettings()` DOM 应用函数                                                                                                 |
| i18n Package       | `packages/i18n/`                                         | 共享 locale schema、翻译资源、React Provider、`CLI` 参数解析                                                                   |

## 数据模型

```typescript
interface AppSettings {
  appIcon: "default" | "alt" // 默认 "default"
  autoStart: boolean // 默认 false
  closeToTray: boolean // 默认 false，关闭主窗口时隐藏到托盘而不是退出
  customThemes: CustomTheme[] // 默认 []
  darkColorSchema:
    | "aquarium"
    | "chadracula-evondev"
    | "default"
    | "poimandres"
    | "tokyo-night" // 默认 "default"
  fontFamily: string // 默认 "System Default"
  fontSize: number // 12-24，默认 16
  lightColorSchema: "default" | "one-light" | "paper" // 默认 "default"
  locale: "system" | "en-US" | "zh-CN" | "ja-JP" // 默认 "system"
  minimizeToTray: boolean // 默认 false，最小化主窗口时隐藏到托盘
  startMinimizedToTray: boolean // 默认 false，仅在登录项自动启动时生效
  theme: "light" | "dark" | "system"
}
interface CustomTheme {
  colors: {
    accent: string // #RRGGBB
    background: string // #RRGGBB
    secondary: string // #RRGGBB
    text: string // #RRGGBB
  }
  createdAt: string
  id: string
  name: string
  preset: "custom" | "ocean" | "forest" | "sunset" | "nord" | "monokai"
  type: "dark" | "light"
  updatedAt: string
}
```

## 入口方式

| 方式     | 触发                                                     | 说明                                                                       |
| -------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| 快捷键   | `Cmd+,`（macOS）/ `Ctrl+,`（Win/Linux）                  | renderer `useHotkey` → `ipcRenderer.send("open-settings")` → main 创建窗口 |
| 原生菜单 | App → Settings...（macOS）/ File → Settings（Win/Linux） | 菜单 click 直接调用 `createSettingsWindow()`                               |
| 路由     | `/settings`（主窗口内）                                  | 保留 TanStack Router route，复用同一组件                                   |

## 主题应用

设置变更后通过 `applySettings()` 实时应用：

- **主题**：切换 `document.documentElement` 的 `dark` / `light` class
- **颜色方案**：设置 `data-dark-color-schema` / `data-light-color-schema`，由 `packages/ui/src/styles/*.css` 下的 schema 文件覆盖 CSS 变量
- **字体**：设置 CSS 自定义属性 `--user-font-family` 和 `--user-font-size`
- **字号生效机制**：`--user-font-size` 应用在 `:root` 的 `font-size` 上（而非 `body`），确保所有使用 `rem` 单位的 Tailwind 类（`text-sm`、`text-xs`、`text-lg` 等）按比例缩放。早期版本放在 `body` 上导致 Tailwind 工具类覆盖失效
- **启动加载**：`index.tsx` 中启动时异步调用 `rpcClient.settings.get()`，随后执行 `applySettings(settings)`，确保首帧尽早应用用户配置
- **系统主题跟随**：当 `theme === "system"` 时，`watchSystemTheme()` 通过 `matchMedia("(prefers-color-scheme: dark)")` 的 `change` 事件监听操作系统外观切换，自动应用 `applyThemePreview("system")` 并带过渡动画；每个 `BrowserWindow` 的 renderer 各自注册独立监听器

### Color Schema

- `theme` 仍只负责 `light` / `dark` / `system` 外观模式切换
- Settings 左侧导航使用单独的 `Color Schema` tab，当前布局为 `Custom Themes` area + `Dark Mode Theme` block + `Light Mode Theme` block
- 新增 `darkColorSchema` 和 `lightColorSchema` 两个设置字段，分别控制深色和浅色模式下的色板
- `default` 表示继续使用 `globals.css` 中现有的内建 token，不需要单独的 schema 文件
- 自定义色板放在 `packages/ui/src/styles/`，目前提供：
  - `aquarium.css`（dark）
  - `chadracula-evondev.css`（dark）
  - `poimandres.css`（dark）
  - `tokyo-night.css`（dark）
  - `one-light.css`（light）
  - `paper.css`（light）
- 所有色板 token 使用 `oklch(...)` 定义，并通过独立 CSS 文件覆盖 `--background`、`--foreground`、`--primary`、`--sidebar-*`、`--chart-*`、scrollbar 等语义变量
- 设置页 swatch 预览的 React key 使用 `schema value + swatch index`，以支持同一 palette 内重复色值

#### 跨窗口实时预览

用户在 Settings 窗口修改 color schema 后，所有其他窗口实时 preview 变更（无需保存）。

```text
Settings Renderer
  → useEffect 监听 draft.darkColorSchema / draft.lightColorSchema
  → ipcRenderer.send("settings-preview-color-schemas", { darkColorSchema, lightColorSchema })
Main Process (ipcMain.on)
  → 遍历所有 BrowserWindow（排除 sender + isDestroyed 检查）
  → webContents.send("settings-preview-color-schemas", preview)
Other Renderers (RendererRoot)
  → ipcRenderer.on("settings-preview-color-schemas")
  → applyColorSchemaPreview() 设置 data-dark-color-schema / data-light-color-schema + 200ms 过渡动画
```

- 预览仅修改 CSS data 属性，不改变 theme 模式（dark/light class）
- effect 依赖精确为 `[draftDarkColorSchema, draftLightColorSchema]`，避免非 color schema 字段变更触发冗余 IPC
- 设置窗口关闭时（`closed` 事件 + 组件卸载 cleanup），会将 preview 重置回已保存的 snapshot 值
- `applyColorSchemaPreview` 带 `theme-transitioning` 过渡动画，与 `applyThemePreview` 一致

### Custom Themes Area

- `customThemes` 暂存于同一个 `settings.json` 内，由现有 `AppSettingsSchema` 和 `updateSettings()` 流程统一持久化
- 设置页草稿 hook 会维护独立的已保存 snapshot；保存成功或收到 `"settings-changed"` 广播后，只会在没有本地未保存修改时回写 draft，避免底部保存条闪烁
- 点击 `Save` 时会先做 optimistic save：立即把当前 draft 视为新的 saved snapshot，让底部操作浮条先消失；如果 RPC 保存失败，再回滚到之前的 snapshot / draft
- 当前 area 用于管理用户自定义主题，位于 `Color Schema` tab 内
- v1 仅支持 `创建 + 删除`，不支持编辑，也不会接入当前 built-in `Color Scheme` 应用逻辑
- 创建对话框使用 `@tanstack/react-form` + `@etyon/ui/components/field.tsx`
- 当前只实现 `Simple` 模式：`Display Name`、`Type`、4 个核心颜色、preset 和实时 preview；`Advanced` 仅作为占位提示
- `Create Theme` 对话框在窄窗口中使用单列布局，在更宽的视口下切换为表单 + preview 双列布局

## 语言设置

`AppSettings` 新增了 `locale` 字段，支持：

- `system`
- `en-US`
- `zh-CN`
- `ja-JP`

### 解析顺序

- 当 `locale !== "system"` 时，直接使用用户显式选择
- 当 `locale === "system"` 时：
  `main` 使用 `app.getLocale()`，`renderer` 使用 `navigator.language`
- 不支持的 locale 会回退到 `en-US`

### 生效范围

- `renderer` 页面文案
- `Settings` 独立窗口标题
- `Electron` 原生菜单

语言切换后，`main` 会立即重建菜单并更新 `Settings` 窗口标题，所有窗口继续通过 `"settings-changed"` 广播同步新的 `AppSettings`

## App Icon Preview

- `General -> App Icon` 中的选项预览直接使用 `apps/desktop/resources/` 下的真实图标资源，而不是 `emoji` 占位
- 当前设置页预览复用 `tray.png`，保证用户在切换图标选项时看到的是实际应用资源，而不是抽象占位符

## 启动设置

- `autoStart` 在 macOS / Windows 下会同步到 `app.setLoginItemSettings()`；Linux 目前只持久化，不主动注册登录项
- 开发构建（`is.dev`）下会跳过登录项同步，避免未打包 Electron 在本机开发过程中触发系统权限 / 注册异常；此时设置仍会正常保存
- `startMinimizedToTray` 仅影响“登录项自动启动”场景，手动启动应用时仍会照常打开主窗口
- macOS 通过 `app.getLoginItemSettings().wasOpenedAtLogin` 判断是否为登录项拉起；若启用最小化到托盘，则启动时只初始化托盘，不创建主窗口
- Windows 在注册登录项时附带 `--start-minimized-to-tray` 参数；应用启动后检测到该参数时，同样只保留托盘而不直接显示主窗口

## Window Behavior

- `minimizeToTray` 控制主窗口点击最小化按钮时的行为；开启后会拦截 `minimize` 事件并直接 `hide()` 到托盘
- `closeToTray` 控制主窗口点击关闭按钮时的行为；开启后会拦截 `close` 事件并隐藏到托盘，关闭后会走显式 `app.quit()`
- 两个设置都通过 `AppSettingsSchema` 持久化，并和设置页其他字段一样走 `settings.update` 广播同步

## Sidebar 组件

设置页侧边栏已从自定义 `motion.aside` 迁移到 `@etyon/ui/components/sidebar`，与主窗口共享同一套 Sidebar 组件和 CSS token：

- 使用 `SidebarProvider` 包裹整个设置页，通过 `style={{ "--sidebar-width": "17rem" }}` 控制宽度
- 独立 Settings 窗口会显式把 `SidebarProvider` 高度设为 `100svh`；嵌入主窗口的 `/settings` 路由则使用 `calc(100svh - TITLE_BAR_HEIGHT)`，避免出现双重滚动
- `Sidebar collapsible="none"`：设置页导航栏固定不可折叠
- 导航项使用 `SidebarMenu` > `SidebarMenuItem` > `SidebarMenuButton`，替代原自定义 `NavButton`
- `SidebarHeader` 预留 macOS traffic light 拖拽区（`title-bar-drag` + `pt-8`）
- 主内容区使用 `SidebarInset`，并在 inset 内建立独立的 `overflow-y-auto` scroll area；浏览器根滚动不再带动 sidebar 一起移动
- 颜色 token 统一为 `bg-sidebar`、`text-sidebar-foreground`、`bg-sidebar-accent` 等
- 原 `SETTINGS_PAGE_SIDEBAR_WIDTH_CLASS` Tailwind class 已删除，宽度改由 CSS 变量 `--sidebar-width` 控制

## Motion 动效

页面使用 [`motion`](https://motion.dev/)（原 framer-motion 精简版）实现入场动效：

- **设置页**：标题和各 section 卡片依次向下淡入（staggered，delay 0.1s → 0.15s → 0.25s）
- **首页**：品牌区与按钮组整体轻量向上淡入，`New Chat` mock 状态提示在默认说明与 mock 提示之间做小幅切换
- **缓动函数**：统一使用 `[0.25, 0.1, 0.25, 1]`（ease-out-quart 变体），避免 bounce/elastic 等过时缓动；数值定义在 `lib/settings-page/constants.ts` 的 `SETTINGS_PAGE_EASE_CURVE`
- **时长**：0.2s-0.4s 范围内，遵循"轻量 → 快速"原则

依赖安装在 `apps/desktop`，通过 `import { motion } from "motion/react"` 引入。

## Scrollbar 样式

全局 scrollbar 使用 WebKit 伪元素自定义（Electron Chromium 引擎完全支持）：

- 宽度 6px，纤细风格
- 透明轨道，圆角滑块
- Light 模式：`oklch(0.556 0 0 / 25%)`，hover 45%
- Dark 模式：`oklch(0.708 0 0 / 20%)`，hover 40%
- 定义在 `packages/ui/src/styles/globals.css` 的 `@layer base`

## 系统字体检测

通过 `fonts.list` RPC 端点获取本机已安装的字体列表，由 `apps/desktop/src/main/fonts.ts` 实现。

### 跨平台实现

使用 [`font-list`](https://www.npmjs.com/package/font-list)（v2.0.2）包，统一跨平台字体枚举。调用 `getFonts({ disableQuoting: true })` 返回去除引号的字体名称数组，内部自动适配 macOS / Linux / Windows。

### 缓存策略

首次调用后结果缓存于内存（`cachedFonts`），进程生命周期内不重复查询系统字体。

### UI 交互

Font Family 选择器使用 `ComboboxTrigger` + 弹出式下拉菜单：

- 触发按钮显示当前选中字体名称（使用该字体渲染预览）
- 下拉面板包含搜索输入框和虚拟化字体列表
- 每项字体使用对应字体渲染，直观预览效果
- 如果系统字体获取失败，回退到硬编码的常用字体列表

Font Size 输入使用 `@etyon/ui` 的 `Input` 组件（基于 `@base-ui/react/input`），统一了输入框的视觉样式和交互行为（focus ring、border transition 等），内部右侧叠加 "px" 单位标签。

## 涉及文件

- `packages/rpc/src/schemas/settings.ts` — Settings Zod schema
- `packages/rpc/src/schemas/fonts.ts` — Font list Zod schema
- `packages/rpc/src/index.ts` — 导出 settings + fonts schema
- `apps/desktop/src/main/startup.ts` — 登录项同步与“启动后隐藏到托盘”判定
- `apps/desktop/src/main/settings.ts` — electron-store 封装
- `apps/desktop/src/main/localization.ts` — `main` 进程 locale 解析与翻译入口
- `apps/desktop/src/main/native-ui.ts` — 菜单与窗口标题的本地化刷新
- `apps/desktop/src/main/fonts.ts` — 系统字体枚举（跨平台，带缓存）
- `apps/desktop/src/main/rpc/router.ts` — settings + fonts RPC 路由
- `apps/desktop/src/main/window.ts` — 主窗口 + settings 窗口创建
- `apps/desktop/src/main/menu.ts` — 原生应用菜单
- `apps/desktop/src/main/index.ts` — IPC handler + 菜单初始化
- `apps/desktop/src/renderer/components/settings-page.tsx` — 设置页面组件
- `apps/desktop/src/renderer/lib/settings-page/` — `constants.ts`（缓动曲线）、`motion.ts`、`nav-config.ts`、`color-schema-swatches.ts`、`build-*-options`、`use-settings-page-draft.ts`、`settings-equal.ts`
- `apps/desktop/src/renderer/components/settings/color-schema/color-schema-tab.tsx` — `Color Schema` tab 主组件，包含 `Custom Themes` 区块，以及拆分后的 `Dark Mode` / `Light Mode` 独立 blocks
- `apps/desktop/src/renderer/components/settings/color-schema/` — 子模块：`constants/`（`defaults.ts`、`presets.ts`）、`utils/`（表单与颜色、`theme-labels.ts` 共享文案映射）、`components/` 对话框与字段；对外仅 `index.ts` 导出 `ColorSchemaTab`
- `apps/desktop/src/renderer/routes/settings.tsx` — 设置页面路由（复用组件）
- `apps/desktop/src/renderer/routes/__root.tsx` — 快捷键 IPC 触发
- `apps/desktop/src/renderer/lib/settings.ts` — DOM 应用逻辑
- `apps/desktop/src/renderer/index.tsx` — 启动分流 + 设置加载
- `packages/i18n/` — 共享 i18n 基础设施
- `packages/ui/src/styles/aquarium.css` — Aquarium dark color schema
- `packages/ui/src/styles/chadracula-evondev.css` — Chadracula Evondev dark color schema
- `packages/ui/src/styles/globals.css` — CSS 变量 + scrollbar 样式
- `packages/ui/src/styles/one-light.css` — One Light light color schema（base OKLCH tokens）
- `packages/ui/src/styles/paper.css` — Paper light color schema
- `packages/ui/src/styles/poimandres.css` — Poimandres dark color schema
- `packages/ui/src/styles/tokyo-night.css` — Tokyo Night dark color schema（base OKLCH tokens）

## Partial Update Schema 设计

`UpdateSettingsSchema` 使用显式 `z.object` 定义，每个字段标记为 `.optional()`，**不含** `.default()`。这是一个关键设计决策：

- `AppSettingsSchema` 中的字段带有 `.default()` 修饰，用于创建完整的设置对象
- 如果直接用 `AppSettingsSchema.partial()` 生成 update schema，Zod 在 parse 时会为缺失字段自动填充 `.default()` 值
- 这会导致只修改单个字段（如 theme）时，其他字段（如 fontFamily、fontSize）被意外重置为默认值
- 因此 `UpdateSettingsSchema` 必须独立定义，仅使用 `.optional()` 而不带 `.default()`，确保未传入的字段保持 `undefined`，不会覆盖已有存储值

## 图标

设置页面使用 [Hugeicons](https://hugeicons.com/) 图标库（stroke-rounded 风格），通过 pnpm catalog 统一管理版本：

- `@hugeicons/react` — React 渲染组件 `HugeiconsIcon`
- `@hugeicons/core-free-icons` — 免费图标集（icon 数据对象）

使用方式：

```tsx
import { Sun02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
;<HugeiconsIcon icon={Sun02Icon} size={24} />
```

主题选择器使用的图标：

| 主题   | 图标名     | 导出           |
| ------ | ---------- | -------------- |
| Light  | `sun-02`   | `Sun02Icon`    |
| Dark   | `moon-02`  | `Moon02Icon`   |
| System | `computer` | `ComputerIcon` |

版本由 `pnpm-workspace.yaml` 的 catalog 统一管控，`packages/ui` 和 `apps/desktop` 均以 `catalog:` 引用。

## 扩展

1. 新增设置字段：在 `AppSettingsSchema` 中添加（带 `.default()`），在 `UpdateSettingsSchema` 中添加对应的 `.optional()` 字段（不带 `.default()`），并确保 `main/settings.ts` 继续通过 `AppSettingsSchema.parse()` 兼容旧配置
2. 新增设置分区：在 `settings-page.tsx` 的 `NAV_ITEMS` 和 JSX 中添加对应 section
3. 新增菜单项：在 `menu.ts` 的 `template` 中添加
