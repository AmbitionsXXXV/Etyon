# Etyon Plugins

Etyon 先采用内置插件模型，再逐步开放外部插件安装。当前目标是把 provider 认证、模型发现、工具权限这类横切能力从普通 settings 页面中拆出来，避免每个 provider 都在 UI、RPC 和主进程里做一次性硬编码。

## 第一阶段：内置插件

内置插件由主进程注册，renderer 只通过 RPC 读取插件清单和执行受控 action。

- `apps/desktop/src/main/plugins/registry.ts` 定义内置插件元数据：`id`、`name`、`capabilities`、`permissions`。
- `packages/rpc/src/schemas/plugins.ts` 定义插件清单的跨进程 contract。
- 插件自身的敏感逻辑放在主进程 feature 目录，例如 `apps/desktop/src/main/cursor-auth/`。
- renderer 不直接读取 token、文件系统凭据或 provider secret，只读取状态和非敏感摘要。

## Cursor Auth

`cursor-auth` 参考 `yetone/alma-plugins/plugins/cursor-auth` 的方向，但先内置为主进程服务：

- OAuth/PKCE 登录参数由主进程生成。
- 登录页通过系统浏览器打开，renderer 只拿 `requestId` 轮询状态。
- Cursor `accessToken` / `refreshToken` 存在独立 `electron-store` 文件中；系统支持时用 `safeStorage` 加密，否则明确标记为明文回退。
- access token 过期时用 refresh token 刷新，并去重并发刷新。
- 模型列表通过 Cursor `GetUsableModels` HTTP/2 Connect/protobuf 接口动态拉取；失败时回退到内置 seed models。
- Plugins 页只负责启用/禁用插件；Cursor 登录与退出在 Providers 页的 Cursor provider 中完成。

## 后续外部插件边界

外部插件不应直接复用 Electron 主进程对象，而是通过受控 host API 访问能力：

- `storage:secrets`：读写插件 scoped secret。
- `network:<domain>`：声明可访问的上游域名。
- `providers:register`：注册 provider runtime 和模型发现器。
- `tools:register`：注册模型可调用工具，并接入 allow/ask/deny 权限策略。
- `os:open-external-url`：请求 host 打开外部认证 URL。

Cursor runtime proxy 是下一步 provider 插件能力的验证点：它需要把 OpenAI-compatible chat completions 转成 Cursor 的 HTTP/2 Connect/protobuf 流，同时把 Cursor native filesystem/shell tools 收敛到 Etyon 的工具权限面。
