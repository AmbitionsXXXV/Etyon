# HeroUI 升级记录

2026-08-10，工作区将 HeroUI React 升级至 `3.2.4`，HeroUI Styles 升级至 `3.2.4`，HeroUI Pro 升级至 `1.0.0-beta.8`。

为满足新的 peer dependency 约束，`@etyon/ui` 同步升级了 `react-aria-components` 至 `1.20.0`，以及 `tailwind-variants` 至 `3.3.1`。

HeroUI Pro 组件应使用组件子路径导入，避免依赖根入口的转导出：

```ts
import { ChatTool } from "@heroui-pro/react/chat-tool"
import { BarChart } from "@heroui-pro/react/bar-chart"
import { Resizable } from "@heroui-pro/react/resizable"
```

已验证 `@etyon/ui` 与 `@etyon/desktop` 的格式、lint 和 TypeScript 类型检查。
