# Telegram Bridge

桌面端 Telegram bridge 是当前 OpenClaw-like 外部消息入口的第一版实现：Etyon 主进程基于 Chat SDK 的 Telegram adapter 运行 `polling` 模式，复用现有 AI SDK provider 工厂生成回复，再通过 Chat SDK `thread.post()` 发回原 chat。

## 数据流

```text
@chat-adapter/telegram
  ↓ mode: "polling"
apps/desktop/src/main/telegram/bridge.ts
  ↓ Chat handlers + toAiMessages() + long-term memory + resolveModel() + streamText()
apps/desktop/src/main/server/lib/providers.ts
  ↓ provider SDK
Chat SDK thread.post(result.textStream)
  ↓ Telegram post/edit fallback
```

## Settings

配置位于 `settings.telegram`：

- `enabled`：保存后启动 / 停止 bridge
- `botToken`：Telegram Bot API token
- `botUsername`：`Test Connection` 成功后从 `getMe.username` 写入 draft，保存后用于 Chat SDK / Telegram adapter 的 mention detection
- `defaultModel`：Telegram 渠道自己的默认模型；为空时继承 `settings.ai.defaultModel`
- `allowedUserIds`：可选用户 allowlist，支持逗号、空格、换行，以及 `telegram:` / `tg:` 前缀
- `allowedChatIds`：可选 chat allowlist，支持私聊、群聊和 supergroup 的数字 ID
- `requireMentionInGroups`：群聊中默认要求包含 bot username

`Test Connection` 只调用 `getMe` 验证当前草稿 token，并把返回的 username 展示为 `@bot_username`。polling runtime 只跟随保存后的 settings，避免用户编辑草稿时启动或重启 bot。

Telegram 客户端里的 `@` 提示由 Telegram 控制，不由 Etyon 控制。群聊或 supergroup 中如果 `@` 列表不出现 bot，需要先把该 bot 加入目标 chat；私聊 bot 时不需要 `@bot_username`。

## Runtime Rules

- 只处理文本消息。
- 忽略 bot 自己发送的消息。
- allowlist 为空时对应维度不限制；生产使用建议至少填写 `allowedUserIds`。
- 群聊和 supergroup 默认需要 `@bot_username`，私聊不需要。
- bridge 启动时由 Telegram adapter `deleteWebhook(drop_pending_updates=true)` 清理 pending update。
- 每个 Telegram chat / topic 由 Chat SDK thread history 保存最近 20 条消息；当前使用 `@chat-adapter/state-memory`，应用重启后历史清空。
- `settings.memory.includeChatbot` 开启时，bridge 会从 `memory_entries` 检索 shared long-term memory，并在回复成功后把当前 Telegram chat 的消息 upsert 回同一套 memory。
- 回复优先使用 `settings.telegram.defaultModel`；为空时回退到当前 AI settings 的默认模型。provider 凭据仍走 Settings `Providers` tab。

## Files

| 文件 | 说明 |
| --- | --- |
| `packages/rpc/src/schemas/settings.ts` | `TelegramSettingsSchema` |
| `packages/rpc/src/schemas/telegram.ts` | Telegram RPC 测试 schema |
| `apps/desktop/src/main/memory.ts` | Shared long-term memory |
| `apps/desktop/src/main/telegram/client.ts` | `getMe` 连接测试 client |
| `apps/desktop/src/main/telegram/bridge.ts` | Chat SDK Telegram bridge |
| `apps/desktop/src/main/telegram/test-connection.ts` | `getMe` 连接测试 |
| `apps/desktop/src/renderer/components/settings/channels-tab.tsx` | Settings `Channels` tab |
