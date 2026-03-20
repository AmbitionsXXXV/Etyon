# Tray

桌面端托盘相关逻辑集中在主进程的 `apps/desktop/src/main/tray.ts`，不和 `window.ts`、`menu.ts` 混在一起。

## 结构

- `index.ts`：应用启动时初始化托盘，并在 `before-quit` 时销毁
- `startup.ts`：同步登录项设置，并判断本次启动是否应直接停留在托盘
- `tray.ts`：持有 `Tray` 单例，负责托盘图标、菜单和点击行为
- `window.ts`：负责主窗口的显示、隐藏、聚焦与显式退出状态
- `native-ui.ts`：在语言切换后同时刷新应用菜单和托盘菜单

## 行为

- `Close to system tray` 开启时，主窗口点击关闭按钮会隐藏到托盘；关闭时会直接退出应用
- `Minimize to system tray` 开启时，主窗口点击最小化按钮会直接隐藏到托盘；关闭时保留原生最小化行为
- 当用户开启 `Start minimized to system tray` 且应用由系统登录项自动启动时，主窗口不会立即创建，应用会直接停留在托盘
- 托盘菜单第一版包含：
  - 显示主窗口
  - 打开设置
  - 退出应用
- 托盘点击会显示并聚焦主窗口；若主窗口尚未创建，则重新创建
- 设置窗口不参与托盘接管，仍按现有逻辑独立打开和关闭

## 图标

- 托盘优先使用 `apps/desktop/resources/tray.png`
- 打包产物会额外带上 `tray.png` 与 `tray@2x.png`
- 创建托盘图标时会执行 `nativeImage.createFromPath(iconPath).resize({ height: 16 })`
- 如果托盘专用图标不存在，则回退到应用运行时图标
