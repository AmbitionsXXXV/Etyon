# 网页抓取与搜索

设置中的“网页工具”开关控制 Agent 的 `web_fetch` 和 `web_search`。启用后即可抓取公开的文本网页；搜索需要先选择 Brave Search 或 Tavily 并保存对应的 API Key。

设置页提供“测试网页抓取”和“测试搜索”，展示正文预览、来源标题、URL 与搜索摘要。来源按钮经 `open-external-url` IPC 打开系统浏览器。测试和 Agent 使用相同的网络实现，错误会直接显示。测试使用已保存的配置；修改搜索服务或 Key 后请先保存。

## 抓取

`web_fetch` 接受一个公开 HTTP(S) URL，返回最终 URL、页面标题、正文与 `truncated`。HTML 解析不会运行脚本，提取 `main` / `article` 正文，删除脚本、样式、模板和隐藏节点；纯文本与 JSON 文档也可读取。页面内容仅作为外部来源数据，不能当作指令。下载内容按响应声明的 charset 解码，未知编码回退到 UTF-8。

每次请求和重定向都检查协议、内嵌认证、目标 hostname 与全部 DNS 答案。只要有私网或保留地址就拒绝访问，随后将已核验的 IP 固定为连接目标，同时保留原 Host 和 TLS SNI。IPv4 非标准写法由 URL 解析器规范化后检查；IPv6 mapped、NAT64、6to4、本地、组播和保留范围均不允许。

单次读取最多 4 次重定向、30 秒、1 MiB 解压后的正文。正文最多返回 24,000 个字符，长文明确标记截断。错误响应、二进制文档、无效重定向和超量内容返回明确错误。下载完成、失败或取消后会销毁该次请求的连接资源。

## 搜索

Brave 使用官方 `/res/v1/web/search` 端点与 `X-Subscription-Token`；Tavily 使用 `/search` 与 Bearer 认证。Tavily 固定使用 basic search，关闭自动参数、自动回答与原始正文。每次最多返回 5 个去重后的来源，标题最多 300 字符，摘要最多 2,000 字符。

查询最多 600 字符和 75 个由空白分隔的词，提交前校验。响应与抓取共用 30 秒 / 1 MiB 下载上限。带 Key 的搜索请求拒绝重定向，避免凭据跨来源转发。无效、内嵌认证、本地、私网 literal 和非 HTTP(S) 的来源 URL 被过滤；真正读取来源时仍会重新验证全部 DNS。

API Key 通过 Electron `safeStorage` 加密，设置只返回密文元数据，表单不会显示已保存 Key。空输入保留同一服务的 Key；切换服务会清除原服务 Key，避免把 Brave 的 Key 发给 Tavily，或反向发送。系统安全存储不可用时拒绝保存。

官方接口参考：[Brave Search](https://api-dashboard.search.brave.com/api-reference/web/search/get)、[Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)。

## 代理与权限

网页请求遵循应用的 HTTP / HTTPS 代理，包括代理认证。代理 CONNECT 的目标使用核验后的 IP，Host / TLS 仍使用来源 hostname。SOCKS5 当前返回明确的“不支持”错误，不回退到直连。

网页工具按应用的逐调用审批策略执行。关闭开关后，已有工具闭包也拒绝新的执行。Agent 的 abort signal 会取消 DNS 等待、连接和正文读取。

## 验证与边界

测试覆盖地址范围、URL 规范化、混合 DNS 答案、DNS 取消、逐跳重定向、DNS rebinding、Host / TLS SNI、HTTP(S) 代理配置、正文 / 字符预算、charset、搜索认证 / 返回来源 / 查询限制、安全存储和 provider 切换。真实 HTTP CONNECT fixture 验证固定 IP、Host、代理认证与重定向。

这些是静态文本工具。需要登录、运行 JavaScript、点击或填写表单的页面应使用嵌入式浏览器。实际 Brave / Tavily 账户的 Key、额度与权限需要配置后实测；mock API 验证不代表供应商账户已验收。
