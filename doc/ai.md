# AI SDK 集成

## 概述

基于 [Vercel AI SDK](https://ai-sdk.dev/) v6 的流式对话系统。当前支持 OpenAI、Anthropic、Vercel AI Gateway、Moonshot 与 Z.AI Coding Plan，通过 Hono 本地 HTTP 服务向 Renderer 提供 SSE 流式响应。

## Provider 支持

| Provider   | 包                  | Model ID 格式                         | 认证方式           |
| ---------- | ------------------- | ------------------------------------- | ------------------ |
| OpenAI     | `@ai-sdk/openai`    | `openai/gpt-5.4`                      | API Key            |
| Anthropic  | `@ai-sdk/anthropic` | `anthropic/claude-sonnet-4-5`         | API Key            |
| AI Gateway | `ai`（内置）        | `gateway/anthropic/claude-sonnet-4-5` | AI Gateway API Key |
| Moonshot   | `@ai-sdk/openai`    | `moonshot/kimi-k2.5`                  | API Key            |
| Z.AI Coding Plan | `@ai-sdk/openai` | `zai-coding-plan/glm-5`           | API Key            |

## 配置

AI 配置存储在 `electron-store` 的 `settings.ai` 字段中：

```typescript
{
  ai: {
    defaultProvider: "openai",
    defaultModel: "gpt-5.4",
    providers: {
      openai: {
        apiKey: "sk-...",
        baseURL: "",
        enabled: true,
        availableModels: [],
        models: []
      },
      anthropic: {
        apiKey: "sk-ant-...",
        baseURL: "",
        enabled: true,
        availableModels: [],
        models: []
      },
      gateway: {
        apiKey: "...",
        baseURL: "",
        enabled: true,
        availableModels: [],
        models: []
      },
      moonshot: {
        apiKey: "",
        baseURL: "https://api.moonshot.cn/v1",
        enabled: false,
        availableModels: [...seededFromProviderCatalog],
        models: [...seededFromProviderCatalog]
      },
      "zai-coding-plan": {
        apiKey: "",
        baseURL: "https://api.z.ai/api/coding/paas/v4",
        enabled: false,
        availableModels: [...seededFromProviderCatalog],
        models: [...seededFromProviderCatalog]
      }
    }
  }
}
```

所有字段有默认值，旧的 settings 文件升级时自动补全；`moonshot` 与 `zai-coding-plan` 的 seed 模型来自桌面端内建的 provider seed catalog。

## 架构

```text
Renderer (useChat + DefaultChatTransport)
  ↓ HTTP POST /api/chat (SSE stream)
Hono Server (127.0.0.1:<port>)
  ↓ resolveModel(modelId)
AI Provider Factory
  ↓ streamText({ model, messages })
OpenAI / Anthropic / AI Gateway / Moonshot / Z.AI
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

- `"openai/gpt-5.4"` → OpenAI Provider + gpt-5.4
- `"anthropic/claude-sonnet-4-5"` → Anthropic Provider + claude-sonnet-4-5
- `"moonshot/kimi-k2.5"` → OpenAI-compatible Moonshot Provider + kimi-k2.5
- `"zai-coding-plan/glm-5"` → OpenAI-compatible Z.AI Provider + glm-5
- `"gpt-5.4"`（无 prefix）→ 使用 settings 中的 `defaultProvider`

### OpenAI-compatible Providers

- `moonshot` 与 `zai-coding-plan` 在运行时统一复用 `createOpenAI({ apiKey, baseURL })`
- 建模前会检查：
  - `enabled === true`
  - `apiKey` 已填写
- `baseURL` 默认值来自 settings schema + provider catalog，可在 Settings 的 `Providers` tab 中覆盖

## Provider Models Fetch

Settings 页的 `Providers` tab 通过新增的 `oRPC providers.fetchModels` 在主进程抓取模型列表：

```text
Renderer (ProvidersTab draft)
  ↓ providers.fetchModels({ providerId, apiKey, baseURL })
Main Process
  ↓ GET {baseURL}/models
normalizeModelsPayload()
  ↓ merge seed capabilities from provider seed catalog
Renderer draft.availableModels / draft.models
```

- 当前首版使用真实上游请求，不直接持久化抓取结果
- 若上游返回的模型缺少 `capabilities`，会回退到内建 seed catalog 中的能力数据
- 若本地已有启用模型，抓取后只保留仍存在的已勾选模型；若此前没有勾选模型，则默认启用全部抓到的模型

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
| `apps/desktop/src/main/providers/fetch-provider-models.ts` | provider models 抓取与归一化 |
| `apps/desktop/src/shared/providers/provider-catalog.ts` | 内建 provider catalog 与 seed 挂载 |
| `apps/desktop/src/shared/providers/provider-seed-models.ts` | 内建 provider seed 模型静态定义 |
| `apps/desktop/src/renderer/lib/ai/transport.ts` | Renderer 端 Chat Transport               |
| `packages/rpc/src/schemas/settings.ts`          | AI Settings Schema（`AiSettingsSchema`） |
| `packages/rpc/src/schemas/providers.ts`         | Provider / Model 共享 schema             |
