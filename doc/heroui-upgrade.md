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

## 2026-10-02：恢复 Pro 安装产物

按 [官方 beta.10 changelog](https://heroui.pro/docs/react/releases/beta-10) 核对，当前 `@heroui-pro/react@1.0.0-beta.10` 要求 `@heroui/react` / `@heroui/styles >=3.2.6`、`react-aria >=3.52.1`、`react-aria-components >=1.21.1`。当前安装版本分别为 `3.2.6`、`3.2.6`、`3.52.1`、`1.21.1`。工作区已有的 `packageExtensions` 继续补齐认证安装前引导包未声明的 peer 约束。

5 个既有聊天 UI 测试套件在跳过 lifecycle scripts 的验证副本中均以 0 个测试加载失败：`assistant-message-timeline`、`composer-plan-queue`、`message-tool-trace`、`subagent-entries`、`subagent-row`。原因是 npm 安装的 Pro 引导包没有组件入口；认证安装脚本尚未恢复 `dist/index.js` 和 `dist/components/chat-tool/index.js`。

按 [官方安装文档](https://heroui.pro/docs/react/getting-started/installation)，常规安装必须允许 Pro postinstall，并使用现有 CLI 登录或 `HEROUI_AUTH_TOKEN` 完成认证：

```bash
rtk proxy vp install --frozen-lockfile
```

如果 manifest 与 lock 已有差异，先用 `rtk proxy vp install --no-frozen-lockfile` 同步锁文件。工作区已经允许 `@heroui-pro/react` 的安装脚本，Release CI 也已传入 `HEROUI_AUTH_TOKEN`。

如果此前为了安装其他依赖而使用 `--ignore-scripts`，仅安装引导包不能完成 UI 验证。已有 peer 依赖齐全时，可单独恢复 Pro 产物，不重新安装 peers 或修改脚本允许配置：

```bash
rtk proxy vp exec --filter @etyon/ui heroui-pro install react --yes --skip-peers --no-trust-patch
```

`ChatTool` 保持官方规定的 `@heroui-pro/react/chat-tool` 子路径导入，其 `shiki@4.4.3` peer 已安装；无需更改组件或 mock Pro 模块。恢复认证安装后，原先 5 个失败套件的全部 48 项测试通过。

验证结果：

- 真实工作区的 5 个 UI 套件、48 项测试通过；原验证副本使用上述单独恢复命令后，同样全部通过。
- `rtk proxy vp test run --maxWorkers 2`：全量 155 个测试文件、1,268 项测试通过。默认并发运行曾出现耗时和超时，限制并发后完整通过。
- `rtk proxy vp run typecheck`：全部 workspace 及根配置类型检查通过。
- `rtk proxy vp check`：676 个文件格式检查、541 个文件 lint 检查通过。
- `rtk proxy vp install --frozen-lockfile --offline --ignore-scripts --lockfile-only`：冻结锁文件一致性检查通过。此命令仅校验 lock；组件产物已在此前的认证安装中恢复。
