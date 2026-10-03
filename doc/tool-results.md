# 长工具结果与模型上下文预算

父 Agent 与委派子 Agent 在每次模型调用前检查输入预算。`estimatedInputTokens` 使用 UTF-8 字节和图片成本估计，不代表 provider 的真实 token 使用；真实 usage 由完成的模型 step 单独记录。

`prepareBudgetedContext(messages, fixedCost, budget, { sessionId, storageRoot? })` 返回 `messages`、`compacted`、`estimatedInputTokens`、`limit`。首先压缩已结束的旧回合，保留当前用户输入、未完成的工具调用、审批拒绝和图片。仍超限时，把本轮已完成的大 text / JSON 工具结果保存为持久引用，在模型上下文中保留短摘要、完整结果的 hash 引用、大小、有效期和分页读取指令；工具调用 ID 与结果对应关系保持。

`read_tool_result` 仅按当前 chat 的引用读取正文，不能传文件路径或其他 session。默认返回 2,048 字符，最多 8,192 字符，使用 `nextOffset` 继续。已经读过的旧页可以在预算不足时变成原始引用和 offset；最新页保留，附加 metadata / Hook 事实保留，不把分页输出再写成递归引用。

结果存于应用配置目录的 `tool-results/<session-hash>/<result-hash>.json`。引用 hash 包含 session、结果类型和完整正文，跨 chat 的相同内容也不会共享引用。目录权限为 `0700`，文件为 `0600`；文件原子写入，读取验证类型、hash 和大小，拒绝路径逃逸和 symlink 文件。`storageRoot` 是运行时注入的内部参数，不对模型暴露。

单份结果最多 512 KiB。缓存根目录总容量最多 32 MiB，有效期为 24 小时；清理只移除已过期且不受当前上下文保护的结果，未过期的其他 chat 正文不会被容量清理驱逐。容量不足、保存失败、超限结果或无法压缩的当前用户输入都会明确失败，不截掉正文后继续调用模型。失效或不属于当前 chat 的引用有明确读取错误，应核对原 invocation 或读取原来的只读来源，不能为了补结果而盲目重跑有副作用的命令。

测试覆盖正文跨页完整重建、非 ASCII 字符、JSON、私有权限、跨 chat 隔离、路径和 symlink 防护、完整性、TTL、容量耗尽，以及预算转换后保留 user / pending / denied / image 和工具边界。RPC 和显式 Best-of-N stream 测试另验证会话租约、选择入口与持久 invocation 不重放。
