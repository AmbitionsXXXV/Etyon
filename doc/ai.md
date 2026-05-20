# AI SDK 集成

## 概述

基于 [Vercel AI SDK](https://ai-sdk.dev/) v6 的流式对话系统。当前支持 OpenAI、Anthropic、Vercel AI Gateway、Moonshot 与 Z.AI Coding Plan，通过 Hono 本地 HTTP 服务向 Renderer 提供 SSE 流式响应。

## Provider 支持

| Provider         | 包                  | Model ID 格式                         | 认证方式           |
| ---------------- | ------------------- | ------------------------------------- | ------------------ |
| OpenAI           | `@ai-sdk/openai`    | `openai/gpt-5.4`                      | API Key            |
| Anthropic        | `@ai-sdk/anthropic` | `anthropic/claude-sonnet-4-5`         | API Key            |
| AI Gateway       | `ai`（内置）        | `gateway/anthropic/claude-sonnet-4-5` | AI Gateway API Key |
| Moonshot         | `@ai-sdk/openai`    | `moonshot/kimi-k2.5`                  | API Key            |
| Z.AI Coding Plan | `@ai-sdk/openai`    | `zai-coding-plan/glm-5`               | API Key            |

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
        region: "china",
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
  ↓ load session memory + long-term memory + project mention context
  ↓ resolveModel(modelId)
AI Provider Factory
  ↓ streamText({ model, messages })
  ↓ onFinish -> persist UIMessage history + rolling session memory + long-term memory
OpenAI / Anthropic / AI Gateway / Moonshot / Z.AI

Telegram Bridge (main process)
  ↓ @chat-adapter/telegram polling
  ↓ toAiMessages() + shared long-term memory
  ↓ streamText({ model: resolveModel(settings.telegram.defaultModel || undefined), messages })
  ↓ Chat SDK thread.post(result.textStream)
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

## Chat Session 持久化

桌面端 chat session 的消息历史由主进程 SQLite 持久化：

- renderer 进入 `/chat/$sessionId` 后，通过 `chatSessions.listMessages` 拉取该 session 的 `UIMessage[]`
- `ChatRuntime` 把这些消息作为 `useChat({ id, messages })` 的初始状态
- 每次 `/api/chat` 的 UI stream 完成后，server 端 `onFinish` 调用 `replaceChatMessages()`，整体替换当前 session 的消息快照
- 持久化消息时会同步更新 session `updatedAt`；如果 title 为空，会从第一条 user 文本生成 session 标题
- renderer 的 `onFinish` 只负责失效 `chatSessions.list` 与 `chatSessions.listMessages` 缓存，让 sidebar title 与下次进入页面的历史保持一致

## Chat Message Actions

assistant 消息下方固定展示一组本地 action，顺序为复制、好评、差评、重新生成：

- 复制：使用 `navigator.clipboard.writeText()` 复制当前 assistant 文本，并展示短暂的已复制反馈
- 好评 / 差评：当前仅保存 renderer 本地的单条消息反馈状态，不写入 SQLite 或发送到后端
- 重新生成：调用当前 `useChat()` 实例的 `regenerate()`，并沿用最近一条 user 消息的 mentions、当前模型与 session id

## Session Memory

当前 session memory 是本地确定性 rolling memory，不额外调用模型：

- `chat_session_memories` 以 `session_id` 为主键保存当前 session 的 memory 文本
- memory 取最近 `16` 条有文本内容的 `UIMessage`，并限制在 `6000` 字符以内
- `/api/chat` 会读取已有 session memory，并与 `@` 项目引用生成的 snapshot context 一起组成 system prompt
- 该模块边界在 [`chat-session-memory.ts`](/Users/jiantianjianghui/Web_Project/Etyon/apps/desktop/src/main/chat-session-memory.ts)，后续可替换为模型总结或 embedding 检索，但不要把总结逻辑散落在 route 组件里

## Long-Term Memory

长期 memory 用于跨 session、跨 project，并可联通 Telegram chatbot。实现参考 [Awesome-AI-Memory](https://github.com/IAAR-Shanghai/Awesome-AI-Memory) 对外部显式记忆、短期 / 长期记忆、检索、压缩、生命周期与共享范围的分类，但当前不引入外部向量数据库，先落成本地 SQLite 可验证版本。

### Memory Enhancement Pipeline

目标架构是 `Capture -> Summarize -> Embed -> Retrieve -> Inject -> Maintain`：

- `Capture`：chat session 与 Telegram chatbot 在 main process 捕获可持久化的文本上下文
- `Summarize`：`settings.memory.autoSummarize` 开启后，使用 `settings.memory.memoryToolModel` 抽取长期有效的 summary、decision、fact 与 procedure；模型失败时回退到当前确定性压缩
- `Embed`：`settings.memory.embeddingModel` 控制 semantic search 使用的 embedding model；空字符串表示默认 `text-embedding-3-small`，`local:*` 表示本地 embedding catalog
- `Retrieve`：`settings.memory.autoRetrieve` 控制是否自动检索；`queryRewriting` 使用同一个 Memory Tool Model 改写用户消息；`maxRetrievedMemories` 与 `similarityThreshold` 控制注入预算和匹配严格度
- `Inject`：chat route 与 Telegram bridge 在构造 system prompt 时注入 long-term memory；位置保持在 session memory 之后、project snapshot / skills 之前
- `Maintain`：后续 runtime 会补 dedupe、decay、archive、stale embedding rebuild 与 diagnostics

当前阶段已经落地 settings schema、Settings `Memory` tab 控件、`maxRetrievedMemories` 检索预算，以及 `autoRetrieve=false` 时跳过检索；模型总结、embedding 生成、query rewriting、hybrid scoring 与 lifecycle maintenance 仍是后续 main process runtime 模块。

当前实现：

- 存储层：`memory_entries` 保存压缩后的长期 memory 条目
- 写入层：`replaceChatMessages()` 在长期 memory 开启时，把当前 chat session 的最近文本消息 upsert 为 `source=chat-session`、`scope=project`
- chatbot 写入：Telegram bridge 在 `settings.memory.includeChatbot` 开启时，把每个 Telegram chat 的最近消息 upsert 为 `source=chatbot`、`scope=chatbot`
- 检索层：`buildMemorySystemPrompt()` 根据当前请求文本做关键词 overlap 排序，并按 `settings.memory.maxRetrievedMemories` 控制注入条数
- 控制层：`settings.memory.enabled` 关闭长期 memory；`autoRetrieve` 控制是否自动检索与注入；`shareAcrossProjects` 控制 project memory 是否跨 project；`includeChatbot` 控制 chatbot memory 是否读写同一套存储
- 注入层：`/api/chat` 会把 long-term memory 放在 session memory 与 project snapshot context 之间；Telegram bridge 会把 long-term memory 追加到 Telegram system prompt 后

模块边界：

| 文件                                                           | 职责                                      |
| -------------------------------------------------------------- | ----------------------------------------- |
| `apps/desktop/src/main/memory.ts`                              | 长期 memory 写入、检索、prompt 构建、统计 |
| `packages/rpc/src/schemas/memory.ts`                           | memory settings / entry / stats schema    |
| `apps/desktop/src/renderer/components/settings/memory-tab.tsx` | Settings `Memory` panel                   |

## Provider 工厂

`resolveModel(modelId)` 解析 model ID 字符串：

- `"openai/gpt-5.4"` → OpenAI Provider + gpt-5.4
- `"anthropic/claude-sonnet-4-5"` → Anthropic Provider + claude-sonnet-4-5
- `"moonshot/kimi-k2.5"` → OpenAI-compatible Moonshot Provider + kimi-k2.5
- `"zai-coding-plan/glm-5"` → OpenAI-compatible Z.AI Provider + glm-5
- `"gpt-5.4"`（无 prefix）→ 使用 settings 中的 `defaultProvider`

### OpenAI-compatible Providers

- `moonshot` 与 `zai-coding-plan` 在运行时复用 `createOpenAI({ apiKey, baseURL }).chat(model)`，请求会落到 OpenAI-compatible 的 `/chat/completions`
- `openai` 官方 provider 继续使用 `createOpenAI({ apiKey, baseURL })(model)`，保持 AI SDK v6 默认的 Responses API 行为
- 建模前会检查：
  - `enabled === true`
  - `apiKey` 已填写
- `moonshot.region` 支持 `china` / `international`，会驱动官方默认域名在 `api.moonshot.cn` 与 `api.moonshot.ai` 之间切换
- `baseURL` 默认值来自 settings schema + provider catalog，可在 Settings 的 `Providers` tab 中覆盖；若仍使用 Moonshot 官方域名，切换 `region` 会同步替换域名

## Provider Models Fetch

Settings 页的 `Providers` tab 通过新增的 `oRPC providers.fetchModels` 在主进程抓取模型列表：

```text
Renderer (ProvidersTab draft)
  ↓ providers.fetchModels({ providerId, apiKey, baseURL, region? })
Main Process
  ↓ resolve region-aware baseURL
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
- Telegram bot token 存储在 `settings.telegram.botToken`，`getMe.username` 存储在 `settings.telegram.botUsername` 用于 mention detection；日志不记录 token，可用 `allowedUserIds` / `allowedChatIds` 限制入口
- 后续可引入 `electron.safeStorage` 加密 API Key

## 涉及文件

| 文件                                                        | 说明                                     |
| ----------------------------------------------------------- | ---------------------------------------- |
| `apps/desktop/src/main/chat-messages.ts`                    | Chat UIMessage 持久化                    |
| `apps/desktop/src/main/chat-session-memory.ts`              | Session memory 构建、读取与 prompt 注入  |
| `apps/desktop/src/main/server/routes/chat.ts`               | Chat 流式对话端点                        |
| `apps/desktop/src/main/server/lib/providers.ts`             | AI Provider 工厂                         |
| `apps/desktop/src/main/telegram/bridge.ts`                  | Chat SDK Telegram adapter 与 AI 回复桥接 |
| `apps/desktop/src/main/telegram/client.ts`                  | Telegram `getMe` 连接测试 client         |
| `apps/desktop/src/main/providers/fetch-provider-models.ts`  | provider models 抓取与归一化             |
| `apps/desktop/src/shared/providers/provider-catalog.ts`     | 内建 provider catalog 与 seed 挂载       |
| `apps/desktop/src/shared/providers/provider-seed-models.ts` | 内建 provider seed 模型静态定义          |
| `apps/desktop/src/renderer/lib/ai/transport.ts`             | Renderer 端 Chat Transport               |
| `packages/rpc/src/schemas/settings.ts`                      | AI Settings Schema（`AiSettingsSchema`） |
| `packages/rpc/src/schemas/providers.ts`                     | Provider / Model 共享 schema             |
