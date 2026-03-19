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
| Settings Component | `apps/desktop/src/renderer/components/settings-page.tsx` | 设置页面 UI 组件                                                                                                               |
| Renderer Entry     | `apps/desktop/src/renderer/index.tsx`                    | URL 参数分流：`?window=settings` 渲染 SettingsPage，否则渲染主应用                                                             |
| Settings Lib       | `apps/desktop/src/renderer/lib/settings.ts`              | `applySettings()` DOM 应用函数                                                                                                 |

## 数据模型

```typescript
interface AppSettings {
  theme: "light" | "dark" | "system"
  fontFamily: string // 默认 "System Default"
  fontSize: number // 12-24，默认 16
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
- **字体**：设置 CSS 自定义属性 `--user-font-family` 和 `--user-font-size`
- **启动加载**：`index.tsx` 中启动时异步调用 `rpcClient.settings.get()`，随后执行 `applySettings(settings)`，确保首帧尽早应用用户配置

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

## 涉及文件

- `packages/rpc/src/schemas/settings.ts` — Settings Zod schema
- `packages/rpc/src/schemas/fonts.ts` — Font list Zod schema
- `packages/rpc/src/index.ts` — 导出 settings + fonts schema
- `apps/desktop/src/main/settings.ts` — electron-store 封装
- `apps/desktop/src/main/fonts.ts` — 系统字体枚举（跨平台，带缓存）
- `apps/desktop/src/main/rpc/router.ts` — settings + fonts RPC 路由
- `apps/desktop/src/main/window.ts` — 主窗口 + settings 窗口创建
- `apps/desktop/src/main/menu.ts` — 原生应用菜单
- `apps/desktop/src/main/index.ts` — IPC handler + 菜单初始化
- `apps/desktop/src/renderer/components/settings-page.tsx` — 设置页面组件
- `apps/desktop/src/renderer/routes/settings.tsx` — 设置页面路由（复用组件）
- `apps/desktop/src/renderer/routes/__root.tsx` — 快捷键 IPC 触发
- `apps/desktop/src/renderer/lib/settings.ts` — DOM 应用逻辑
- `apps/desktop/src/renderer/index.tsx` — 启动分流 + 设置加载
- `packages/ui/src/styles/globals.css` — CSS 变量 + scrollbar 样式

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

1. 新增设置字段：在 `AppSettingsSchema` 中添加（带 `.default()`），在 `UpdateSettingsSchema` 中添加对应的 `.optional()` 字段（不带 `.default()`），在 `DEFAULTS` 中设默认值
2. 新增设置分区：在 `settings-page.tsx` 的 `NAV_ITEMS` 和 JSX 中添加对应 section
3. 新增菜单项：在 `menu.ts` 的 `template` 中添加
