# RPC 通信架构

## 概述

基于 [oRPC](https://orpc.dev/) + Electron MessagePort Adapter / Fetch Adapter 的端到端类型安全 RPC 通信系统。同一套 router 同时服务桌面内部 `MessagePort` 调用和 Hono 下的本地 HTTP RPC 入口。

## 包结构

| 包/应用          | 路径                                   | 职责                                       |
| ---------------- | -------------------------------------- | ------------------------------------------ |
| `@etyon/rpc`     | `packages/rpc/`                        | 共享 Zod schema，不依赖 Electron API       |
| `@etyon/i18n`    | `packages/i18n/`                       | 共享 locale schema 与翻译能力，供 RPC 消费 |
| `@etyon/desktop` | `apps/desktop/src/main/rpc/`           | 定义 router + handler，创建 RPCHandler     |
| `@etyon/desktop` | `apps/desktop/src/main/db/`            | Drizzle / libsql 数据库基础设施            |
| `@etyon/desktop` | `apps/desktop/src/renderer/lib/rpc.ts` | 创建 oRPC client + TanStack Query utils    |

## 架构

```text
Renderer (oRPC Client — MessageChannel port1)
  ↓ window.postMessage("start-orpc-client", port2)
Preload (MessagePort Forwarder)
  ↓ ipcRenderer.postMessage("start-orpc-server", port)
Main (MessagePort RPCHandler → App Router)

Renderer / Main HTTP Client
  ↓ HTTP 127.0.0.1:<port>/rpc/*
Main (Hono → Fetch RPCHandler → App Router)
```

### 数据流

1. Renderer 创建 `MessageChannel`，保留 `port1` 作为 client 端，将 `port2` 通过 `window.postMessage` 发送给 preload
2. Preload 监听 `message` 事件，收到 `"start-orpc-client"` 后将 port 转发给 main process（`ipcRenderer.postMessage`）
3. Main process 监听 `"start-orpc-server"`，用 `RPCHandler.upgrade(port)` 接管 MessagePort
4. 通信建立后，renderer 通过 `rpcClient.xxx.yyy()` 调用 procedure，oRPC 自动完成序列化 / 反序列化 / 类型推导

### 共享 Context

主进程 RPC 统一通过 `AppRpcContext` 注入以下能力：

- `db`：Drizzle `libsql` 数据库实例
- `logger`：主进程结构化 logger
- `transport`：当前请求来源，区分 `message-port` 与 `http`
- `requestId?`：来自 Hono 请求日志中间件的 request id
- `headers?`：HTTP RPC 请求头

## Router 定义

Router 定义在 `apps/desktop/src/main/rpc/router.ts`，引用 `@etyon/rpc` 的 Zod schema：

```typescript
import { rpc } from "@/main/rpc/context"
import { LogEventSchema } from "@etyon/rpc"
import { dispatch, enrichLogEvent } from "../logger"

export const loggerEmit = rpc
  .input(LogEventSchema)
  .handler(async ({ context, input }) => {
    const enriched = enrichLogEvent({
      ...input,
      request_id: context.requestId ?? input.request_id,
      transport: context.transport
    })
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

### 新增本地 HTTP RPC 入口

同一个 `router` 可以同时被 MessagePort adapter 和 Hono / Fetch adapter 消费：

```typescript
import { RPCHandler as FetchRPCHandler } from "@orpc/server/fetch"

const httpHandler = new FetchRPCHandler(router)
```

## 涉及文件

| 文件                                   | 说明                                |
| -------------------------------------- | ----------------------------------- |
| `packages/rpc/src/schemas/logger.ts`   | LogEvent Zod schema                 |
| `packages/rpc/src/index.ts`            | Schema 统一导出                     |
| `apps/desktop/src/main/rpc/context.ts` | `AppRpcContext` + transport builder |
| `apps/desktop/src/main/rpc/router.ts`  | App Router 定义                     |
| `apps/desktop/src/main/rpc/index.ts`   | MessagePort / Fetch RPCHandler 注册 |
| `apps/desktop/src/main/db/index.ts`    | Drizzle / libsql 数据库实例         |
| `apps/desktop/src/main/logger.ts`      | 日志 transport 工具函数             |
| `apps/desktop/src/main/index.ts`       | 入口，注册 RPC handler              |
| `apps/desktop/src/preload/index.ts`    | MessagePort 转发                    |
| `apps/desktop/src/renderer/lib/rpc.ts` | oRPC client + TanStack Query utils  |
| `apps/desktop/src/renderer/index.tsx`  | Logger SDK 初始化                   |
