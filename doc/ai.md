# AI SDK 集成

## 概述

基于 [Vercel AI SDK](https://ai-sdk.dev/) v6 的流式对话系统。支持 OpenAI、Anthropic、Vercel AI Gateway 三种 Provider，通过 Hono 本地 HTTP 服务向 Renderer 提供 SSE 流式响应。

## Provider 支持

| Provider   | 包                  | Model ID 格式                         | 认证方式           |
| ---------- | ------------------- | ------------------------------------- | ------------------ |
| OpenAI     | `@ai-sdk/openai`    | `openai/gpt-4o`                       | API Key            |
| Anthropic  | `@ai-sdk/anthropic` | `anthropic/claude-sonnet-4-5`         | API Key            |
| AI Gateway | `ai`（内置）        | `gateway/anthropic/claude-sonnet-4-5` | AI Gateway API Key |

## 配置

AI 配置存储在 `electron-store` 的 `settings.ai` 字段中：

```typescript
{
  ai: {
    defaultProvider: "openai",      // "openai" | "anthropic" | "gateway"
    defaultModel: "gpt-4o",         // 默认模型 ID
    providers: {
      openai: { apiKey: "sk-..." },
      anthropic: { apiKey: "sk-ant-..." },
      gateway: { apiKey: "..." }
    }
  }
}
```

所有字段有默认值，旧的 settings 文件升级时自动补全。

## 架构

```text
Renderer (useChat + DefaultChatTransport)
  ↓ HTTP POST /api/chat (SSE stream)
Hono Server (127.0.0.1:<port>)
  ↓ resolveModel(modelId)
AI Provider Factory
  ↓ streamText({ model, messages })
OpenAI / Anthropic / AI Gateway
```

## Renderer 端使用

### 获取 Transport

```typescript
import { getChatTransport } from "@/renderer/lib/ai/transport"

const transport = await getChatTransport()
```

### useChat Hook（AI SDK v6）

```tsx
import { useChat } from "@ai-sdk/react"
import { useState } from "react"

const ChatComponent = () => {
  const [input, setInput] = useState("")
  const { messages, sendMessage } = useChat({ transport })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage({ text: input })
    setInput("")
  }

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          {m.parts.map((part, i) => {
            if (part.type === "text") {
              return <span key={i}>{part.text}</span>
            }
            return null
          })}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}
```

### AI SDK v6 注意事项

- `useChat` 不再内置 input state，需手动使用 `useState` 管理
- 使用 `sendMessage()` 替代已废弃的 `handleSubmit`
- 使用 `DefaultChatTransport` 替代 `api` 选项
- 使用 `toUIMessageStreamResponse()` 替代 `toDataStreamResponse()`
- Tool 调用使用 `part.type === "tool-<toolName>"` 替代 `"tool-invocation"`
- `inputSchema` 替代 `parameters`，`maxOutputTokens` 替代 `maxTokens`

## Provider 工厂

`resolveModel(modelId)` 解析 model ID 字符串：

- `"openai/gpt-4o"` → OpenAI Provider + gpt-4o
- `"anthropic/claude-sonnet-4-5"` → Anthropic Provider + claude-sonnet-4-5
- `"gpt-4o"`（无 prefix）→ 使用 settings 中的 `defaultProvider`

## 安全

- API Key 存储在 `~/.config/etyon/settings.json`
- Hono 服务仅绑定 `127.0.0.1`
- 日志中不记录 API Key
- 后续可引入 `electron.safeStorage` 加密 API Key

## 涉及文件

| 文件                                            | 说明                                     |
| ----------------------------------------------- | ---------------------------------------- |
| `apps/desktop/src/main/server/routes/chat.ts`   | Chat 流式对话端点                        |
| `apps/desktop/src/main/server/lib/providers.ts` | AI Provider 工厂                         |
| `apps/desktop/src/renderer/lib/ai/transport.ts` | Renderer 端 Chat Transport               |
| `packages/rpc/src/schemas/settings.ts`          | AI Settings Schema（`AiSettingsSchema`） |
