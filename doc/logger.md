# 客户端日志系统

## 概述

基于 Wide Events 模式的结构化 JSON 日志收集系统，为后续埋点服务提供基础架构。

## 包结构

日志系统拆分为独立的 `@etyon/logger` 包（`packages/logger`），充分利用 monorepo 的共享能力：

- **`@etyon/logger/types`** — 日志事件类型定义（`LogEvent`、`LogLevel`、`LogTransport` 等），供 main / preload / renderer 共同引用
- **`@etyon/logger/renderer`** — Renderer 端 Logger SDK，提供 `logger` 单例和 wide event builder

Main 进程的日志收集器（`apps/desktop/src/main/logger.ts`）因依赖 Electron API（`app`、`ipcMain`、`fs`），保留在 desktop 应用内部。

Main 进程业务代码应优先调用 `@/main/logger` 暴露的 `logger.info()`、`logger.debug()`、`logger.critical()`，避免直接使用 `console.log()`。
需要表达错误语义时，优先使用 `logger.error()`；它当前会映射到内部 `critical` 级别，兼顾现有事件 schema 与更直观的调用方式。

## 架构

```text
Renderer (Logger SDK — @etyon/logger/renderer)
  ↓ IPC: log:emit
Preload (contextBridge)
  ↓
Main (Log Collector → StreamTransport / FileTransport / RemoteTransport)
```

- **Renderer 层**：`logger` 单例，业务代码调用 `startEvent()` 构建 wide event
- **Preload 层**：通过 `contextBridge.exposeInMainWorld("etyonLogger", ...)` 暴露安全的 IPC 通道
- **Main 层**：监听 `log:emit`，注入环境上下文，写入本地文件
- **Main 层输出流**：主进程统一将结构化日志同时写入本地 `.jsonl` 文件与 `stdout` / `stderr`，便于在开发终端直接观察日志

## 日志级别

| 级别       | 用途               | 存储策略                  |
| ---------- | ------------------ | ------------------------- |
| `debug`    | 开发调试信息       | 仅本地文件                |
| `info`     | 常规业务事件       | 本地文件                  |
| `critical` | 崩溃、关键流程失败 | 本地文件 + 标记待远程上报 |

## 存储

- **目录**：`~/.etyon/logs/`
- **格式**：JSON Lines（`.jsonl`），每行一条结构化 JSON
- **文件命名**：`{date}.jsonl`（如 `2026-03-18.jsonl`）
- **清理策略**：保留最近 30 天，启动时自动清理

## 使用方式

### Wide Event 模式（推荐）

```typescript
import { logger } from "@etyon/logger/renderer"

const event = logger.startEvent("checkout")
event.set("user_id", userId)
event.set("cart_total", cart.total)

try {
  await processCheckout()
  event.set("outcome", "success")
  event.info()
} catch (error) {
  event.set("outcome", "error")
  event.set("error_message", error.message)
  event.critical()
}
```

### 快捷方法

```typescript
import { logger } from "@etyon/logger/renderer"

logger.info("page_view", { path: "/home", referrer: "/login" })
logger.debug("component_render", { component: "UserList", count: 42 })
logger.critical("unhandled_error", { message: error.message })
logger.error("unhandled_error", { message: error.message })
```

### 宽事件 Builder

主进程与 Renderer 端都支持 `startEvent()`，适合把一次请求或一次流程收敛成一条完整日志：

```typescript
const requestLog = logger.startEvent("http_request", {
  method: "POST",
  path: "/api/chat",
  request_id: requestId
})

try {
  await next()
  requestLog.merge({
    outcome: "success",
    status_code: 200
  })
  requestLog.info()
} catch (error) {
  requestLog.merge({
    error,
    outcome: "error",
    status_code: 500
  })
  requestLog.error()
}
```

### 类型引用

```typescript
import type { LogEvent, LogLevel, LogTransport } from "@etyon/logger/types"
```

## 涉及文件

| 包/应用          | 文件                   | 说明                                  |
| ---------------- | ---------------------- | ------------------------------------- |
| `@etyon/logger`  | `src/core.ts`          | 通用 Logger 工厂与 wide event builder |
| `@etyon/logger`  | `src/types.ts`         | 日志事件类型定义                      |
| `@etyon/logger`  | `src/renderer.ts`      | Renderer 端 Logger SDK                |
| `@etyon/desktop` | `src/main/logger.ts`   | Main 进程日志收集器                   |
| `@etyon/desktop` | `src/preload/index.ts` | Preload IPC bridge                    |

## 扩展点

- `LogTransport` 接口抽象，后续实现 `RemoteTransport` 接入远程埋点
- `critical` 级别自动标记 `_pendingRemote: true`，支持离线缓存待上报
- `LogEvent` 支持任意扩展字段（`user_id`、`session_id`、`feature_flags` 等）
- 其他 app（如 CLI）未来可直接引用 `@etyon/logger/types` 共享类型定义
