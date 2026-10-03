# MCP 服务器与外部工具

MCP 设置页支持 stdio 本地进程与 Streamable HTTP 服务器。服务器默认停用；启用后连接、发现工具，并把工具放入 Agent 的可用工具集合。状态、错误与可用工具可以直接查看，也可以手动重连或断开。

## 配置

在设置的 MCP 页面选择“添加 stdio”或“添加 HTTP”，修改 JSON 后保存。每个服务器使用固定且唯一的 `id`，最多保存 8 个服务器。编辑现有服务器时不能改变 `id`。

stdio 示例：

```json
{
  "args": ["/absolute/path/server.mjs"],
  "command": "node",
  "enabled": false,
  "env": {},
  "id": "local-tools",
  "name": "Local tools",
  "protocol": "legacy",
  "transport": "stdio"
}
```

`command` 直接启动程序，不经 shell 展开。`args` 是参数数组。启动时保留 SDK 的安全基础环境，并补足 Homebrew 的 `PATH`；其他应用环境变量不会自动传入。需要的服务器凭据必须显式填写到 `env`。服务器 stderr 不写入应用日志。

HTTP 示例：

```json
{
  "enabled": false,
  "headers": {
    "Authorization": "Bearer your-server-token"
  },
  "id": "remote-tools",
  "name": "Remote tools",
  "protocol": "legacy",
  "transport": "http",
  "url": "https://example.com/mcp"
}
```

HTTP 请求遵循应用的 HTTP(S) 代理。启用了 SOCKS5 时返回明确错误，不改用直连。HTTP 服务器可以是用户显式配置的本地 MCP 服务；这与只能抓取公网的网页工具是独立的入口。URL 不接受内嵌用户名、密码或片段，请使用 `headers` 提供认证。认证请求拒绝重定向，避免把请求头发给其他来源。

`protocol` 可选 `legacy`、`auto`、`modern`。默认 `legacy` 使用 2025 系列的 initialize 握手；`auto` 由 SDK 探测并回退；`modern` 固定 2026-07-28 协议。stdio 的 `auto` 探测会由 SDK 启动一次短暂的同参数探测进程，具有启动副作用的服务器应保留 `legacy`。

## 凭据与权限

`env` 与 `headers` 整组通过 Electron `safeStorage` 加密保存，保存后的设置和编辑器不返回明文。系统密钥存储不可用，或 Linux 使用 `basic_text` 时拒绝保存凭据。编辑时保持空对象会保留原凭据；填写新对象会替换整组，删除请点击“清除凭据”。不应把秘密放在命令、参数或 URL 中。

工具使用 `mcp__` 命名空间和服务器 / 工具名的稳定 hash，避免命名冲突。所有调用按应用的 MCP 审批策略执行；只读 profile 不暴露 MCP 工具，因为远程工具的声明不能证明没有副作用。服务器名称、工具描述和输出都是外部数据，不能改变 Agent 的权限。

重新配置、停用、删除或关闭应用会取消仍在连接的服务器并关闭现有连接。手动断开的启用服务器保持断开，直到再次连接或配置变更。旧模型工具闭包在连接或配置变化后拒绝执行，需要重新发现和批准。连接失败不会无限重试；设置页保留错误并允许手动重连。

## 预算

- 握手、发现与单次工具调用上限 30 秒，Agent 取消信号传递到 SDK。
- 工具发现最多 4 页；单服务器最多提供 40 个工具。
- 单工具 JSON Schema 上限 16 KiB，描述最多 1,000 个字符，单服务器的目录预算 64 KiB。
- 多服务器合计最多提供 80 个 MCP 工具，模型工具目录总预算 64 KiB；服务器在设置中的次序决定优先顺序，状态页展示实际暴露的工具集合。
- stdio 消息缓冲和 HTTP 单响应下载上限 1 MiB；单次工具输入 / 输出上限 128 KiB。
- 超出目录预算的工具不暴露，设置页展示工具发现数量和截断说明。返回的已配置凭据会脱敏。

## 验证与边界

自动测试覆盖真实 stdio 进程握手、调用、并发复用、断开 / 退出取消、配置切换、工具分页 / 限长、父进程环境过滤、凭据脱敏与调用取消；真实 HTTP fixture 覆盖认证请求与调用，另有下载 / 重定向 / 来源限制测试。

OAuth 登录、旧 HTTP+SSE transport、远程服务器的商业权限与具体工具业务结果不属于这版的保证。HTTP header 认证已支持；真实服务器需要用户配置后验收。协议行为按 [官方 MCP v2 客户端文档](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect) 与 [协议版本说明](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions) 实现。
