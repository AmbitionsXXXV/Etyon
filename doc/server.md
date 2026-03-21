# 本地 HTTP 服务（Hono）

## 概述

Electron main process 内嵌 [Hono](https://hono.dev/) HTTP 服务，通过 `@hono/node-server` 在 `127.0.0.1` 上监听随机端口。该服务为 Renderer 提供 AI 对话流等需要标准 HTTP/SSE 的接口，与现有的 oRPC MessagePort IPC 互补。

## 架构

```text
Renderer (fetch / SSE)
  ↓ HTTP 127.0.0.1:<port>
Main Process (Hono + @hono/node-server)
  ├─ /health        → 健康检查
  └─ /api/chat      → AI 流式对话
```

Renderer 通过 oRPC 的 `server.getUrl` procedure 获取动态端口 URL，然后直接以标准 `fetch` / SSE 连接 Hono 服务。

## 端口策略

- 使用 `port: 0`，由操作系统自动分配空闲端口
- 避免与用户本地其他服务端口冲突
- 仅绑定 `127.0.0.1`，不对外网暴露

## 关键文件

| 文件                                            | 说明                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `apps/desktop/src/main/server/app.ts`           | Hono 应用实例、中间件注册、路由挂载                               |
| `apps/desktop/src/main/server/index.ts`         | 服务生命周期：`startServer()` / `stopServer()` / `getServerUrl()` |
| `apps/desktop/src/main/server/routes/chat.ts`   | AI 流式对话路由                                                   |
| `apps/desktop/src/main/server/lib/providers.ts` | AI Provider 工厂                                                  |

## 生命周期

1. `app.on("ready")` 中调用 `await startServer()` 启动服务
2. `app.on("before-quit")` 中调用 `await stopServer()` 优雅关闭

## 扩展指南

### 新增路由

1. 在 `apps/desktop/src/main/server/routes/` 下新建路由文件
2. 在 `apps/desktop/src/main/server/app.ts` 中通过 `app.route()` 挂载

```typescript
import { Hono } from "hono"

const myRoute = new Hono()
myRoute.get("/data", (c) => c.json({ items: [] }))

export { myRoute }
```

```typescript
import { myRoute } from "./routes/my-route"
app.route("/api", myRoute)
```

### CORS 配置

当前 CORS 允许 `http://localhost:*` 的源。如需更严格限制，修改 `app.ts` 中的 `cors()` 配置。

## 涉及文件

| 文件                                            | 说明                      |
| ----------------------------------------------- | ------------------------- |
| `apps/desktop/src/main/server/app.ts`           | Hono 应用实例             |
| `apps/desktop/src/main/server/index.ts`         | 服务生命周期管理          |
| `apps/desktop/src/main/server/routes/chat.ts`   | AI Chat 路由              |
| `apps/desktop/src/main/server/lib/providers.ts` | Provider 工厂             |
| `apps/desktop/src/main/index.ts`                | 入口，启动/停止服务       |
| `apps/desktop/src/main/rpc/router.ts`           | `server.getUrl` procedure |
| `packages/rpc/src/schemas/server.ts`            | ServerUrl output schema   |
