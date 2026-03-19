# RPC 通信架构

## 概述

基于 [oRPC](https://orpc.dev/) + Electron MessagePort Adapter 的端到端类型安全 RPC 通信系统。一套 router 定义同时服务 Electron IPC 和未来的本地 HTTP 服务。

## 包结构

| 包/应用          | 路径                                   | 职责                                       |
| ---------------- | -------------------------------------- | ------------------------------------------ |
| `@etyon/rpc`     | `packages/rpc/`                        | 共享 Zod schema，不依赖 Electron API       |
| `@etyon/i18n`    | `packages/i18n/`                       | 共享 locale schema 与翻译能力，供 RPC 消费 |
| `@etyon/desktop` | `apps/desktop/src/main/rpc/`           | 定义 router + handler，创建 RPCHandler     |
| `@etyon/desktop` | `apps/desktop/src/renderer/lib/rpc.ts` | 创建 oRPC client + TanStack Query utils    |

## 架构

```text
Renderer (oRPC Client — MessageChannel port1)
  ↓ window.postMessage("start-orpc-client", port2)
Preload (MessagePort Forwarder)
  ↓ ipcRenderer.postMessage("start-orpc-server", port)
Main (RPCHandler — MessagePort Adapter → App Router)
```

### 数据流

1. Renderer 创建 `MessageChannel`，保留 `port1` 作为 client 端，将 `port2` 通过 `window.postMessage` 发送给 preload
2. Preload 监听 `message` 事件，收到 `"start-orpc-client"` 后将 port 转发给 main process（`ipcRenderer.postMessage`）
3. Main process 监听 `"start-orpc-server"`，用 `RPCHandler.upgrade(port)` 接管 MessagePort
4. 通信建立后，renderer 通过 `rpcClient.xxx.yyy()` 调用 procedure，oRPC 自动完成序列化 / 反序列化 / 类型推导

## Router 定义

Router 定义在 `apps/desktop/src/main/rpc/router.ts`，引用 `@etyon/rpc` 的 Zod schema：

```typescript
import { os } from "@orpc/server"
import { LogEventSchema } from "@etyon/rpc"
import { dispatch, enrichLogEvent } from "../logger"

export const loggerEmit = os
  .input(LogEventSchema)
  .handler(async ({ input }) => {
    const enriched = enrichLogEvent(input)
    dispatch(enriched)
  })

export const router = {
  logger: {
    emit: loggerEmit
  }
}

export type AppRouter = typeof router
```

## Renderer 使用

### 直接调用

```typescript
import { rpcClient } from "./lib/rpc"

await rpcClient.logger.emit({
  event: "page_view",
  level: "info",
  timestamp: new Date().toISOString()
})
```

### 结合 TanStack Query

```typescript
import { useMutation } from "@tanstack/react-query"
import { orpc } from "./lib/rpc"

const mutation = useMutation(orpc.logger.emit.mutationOptions())
mutation.mutate({
  event: "button_click",
  level: "info",
  timestamp: new Date().toISOString()
})
```

### Logger SDK

```typescript
import { logger } from "@etyon/logger/renderer"

logger.info("page_view", { path: "/home" })

const event = logger.startEvent("checkout")
event.set("cart_total", 99)
event.info()
```

Logger SDK 在 `index.tsx` 中通过 `initLogger()` 初始化，注入 RPC emit 函数。

## 扩展指南

### 新增 Procedure

1. 在 `packages/rpc/src/schemas/` 下新增 Zod schema 文件，并在 `src/index.ts` 中导出
2. 在 `apps/desktop/src/main/rpc/router.ts` 中新增 procedure，添加到 router 对象
3. Renderer 端自动获得类型提示，无需额外配置

### Settings Schema 扩展

`settings.get` / `settings.update` 现在会携带 `locale` 字段，因此：

- `packages/rpc/src/schemas/settings.ts` 依赖 `@etyon/i18n` 导出的 `LocalePreferenceSchema`
- 旧的本地设置文件即使没有 `locale` 字段，也会由 `AppSettingsSchema.parse()` 自动补默认值 `"system"`
- `renderer` 与 `main` 会继续通过同一条 `settings-changed` 广播链路同步完整的设置对象

### 新增本地 HTTP 服务

同一个 `router` 可以同时被 MessagePort adapter 和 HTTP adapter 消费：

```typescript
import { RPCHandler as NodeHandler } from "@orpc/server/node"
import { router } from "./router"

const httpHandler = new NodeHandler(router)
```

## 涉及文件

| 文件                                   | 说明                               |
| -------------------------------------- | ---------------------------------- |
| `packages/rpc/src/schemas/logger.ts`   | LogEvent Zod schema                |
| `packages/rpc/src/index.ts`            | Schema 统一导出                    |
| `apps/desktop/src/main/rpc/router.ts`  | App Router 定义                    |
| `apps/desktop/src/main/rpc/index.ts`   | RPCHandler + ipcMain 注册          |
| `apps/desktop/src/main/logger.ts`      | 日志 transport 工具函数            |
| `apps/desktop/src/main/index.ts`       | 入口，注册 RPC handler             |
| `apps/desktop/src/preload/index.ts`    | MessagePort 转发                   |
| `apps/desktop/src/renderer/lib/rpc.ts` | oRPC client + TanStack Query utils |
| `apps/desktop/src/renderer/index.tsx`  | Logger SDK 初始化                  |
