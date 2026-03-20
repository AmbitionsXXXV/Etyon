# Home

主窗口首页现在是一个纯 renderer 的简洁落地页，不再在首屏发起 `orpc.ping` 或 `rpcClient.ping()` 的演示请求。

## 目标

- 作为主窗口的 landing surface，只保留 `New Chat` 和 `Settings` 两个主动作
- `New Chat` 当前只触发本地 mock 状态提示，不依赖后端或 IPC 数据请求
- `Settings` 复用现有 `open-settings` IPC，直接打开独立的 Settings 窗口

## 布局

- 首页改为单列居中布局：品牌图标、标题、说明、主按钮、次按钮和一行状态提示
- `title-bar` 在首页场景以嵌入式 header 形式出现在同一个外层窗口壳里，和内容区通过边框分区，而不是悬浮在页面之上
- 首页动效维持轻量 fade + y 轴位移，沿用 `SETTINGS_PAGE_EASE_CURVE`

## i18n

- `home` 命名空间只保留首页真实文案
- 已删除旧的 `ping` / `directCall` 临时翻译资源
