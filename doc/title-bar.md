# 自定义 Title Bar

## 概述

移除系统默认标题栏，使用 Electron `titleBarStyle: "hidden"` + 自定义 React 组件实现跨平台标题栏，支持窗口拖拽。

## 平台适配

| 平台          | 行为                                                                           |
| ------------- | ------------------------------------------------------------------------------ |
| macOS         | `titleBarStyle: "hidden"` 保留红绿灯按钮，通过 `trafficLightPosition` 微调位置 |
| Windows/Linux | `titleBarOverlay: { height: 36 }` 恢复原生窗口控制按钮                         |

## BrowserWindow 配置

在 `src/main/window.ts` 中：

- `titleBarStyle: "hidden"` — 隐藏默认标题栏
- `trafficLightPosition: { x: 12, y: 10 }` — macOS 红绿灯位置
- `titleBarOverlay: { height: 36 }` — Windows/Linux 原生窗口按钮

## 平台检测

通过 `@electron-toolkit/preload` 在 preload 脚本中暴露 `window.electron.process.platform`，renderer 进程使用该值判断当前平台（如 `"darwin"`），替代不可靠的 `navigator.userAgent` 嗅探。

类型声明位于 `src/renderer/env.d.ts`。

## TitleBar 组件

位于 `src/renderer/components/title-bar.tsx`：

- 固定在窗口顶部，高度 36px
- CSS `app-region: drag` 使整个标题栏可拖拽
- 通过 `window.electron.process.platform === "darwin"` 判断 macOS，左侧留出 72px 空间避开红绿灯
- 导出 `TITLE_BAR_HEIGHT` 常量供页面布局使用

## CSS 工具类

在 `packages/ui/src/styles/globals.css` 中定义：

- `.title-bar-drag` — `app-region: drag`，使元素可拖拽移动窗口
- `.title-bar-no-drag` — `app-region: no-drag`，标记按钮等交互元素为不可拖拽

## 布局集成

在 `src/renderer/routes/__root.tsx` 根路由中：

- `<TitleBar />` 放置在 `<Outlet />` 上方
- 内容区域设置 `paddingTop: TITLE_BAR_HEIGHT` 避免被标题栏遮挡

## 涉及文件

| 文件                                    | 操作                       |
| --------------------------------------- | -------------------------- |
| `src/main/window.ts`                    | 修改 — BrowserWindow 配置  |
| `src/preload/index.ts`                  | 修改 — 暴露 electronAPI    |
| `src/renderer/env.d.ts`                 | 新建 — Window 全局类型声明 |
| `src/renderer/components/title-bar.tsx` | 新建 — TitleBar React 组件 |
| `src/renderer/routes/__root.tsx`        | 修改 — 集成 TitleBar       |
| `packages/ui/src/styles/globals.css`    | 修改 — 拖拽区域 CSS        |
