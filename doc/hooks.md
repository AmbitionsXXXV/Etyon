# Hooks

Hooks 在已通过当前权限模式与用户审批的工具执行边界运行。三个事件为 `PreToolUse`、`PostToolUse`、`Stop`。在 Agents 设置内启用 Hooks 后，读取项目的 `.etyon/hooks.json` 和应用配置目录的 `hooks.json`；开发版使用 `~/.config/etyon-dev/`，正式版使用 `~/.config/etyon/`。全局配置先执行，项目配置随后执行。

```json
{
  "hooks": [
    {
      "command": "./scripts/check-tool.sh",
      "event": "PreToolUse",
      "matcher": "^(write|edit)$",
      "timeoutMs": 10000
    },
    {
      "command": "./scripts/report-result.sh",
      "event": "PostToolUse",
      "matcher": ".*",
      "timeoutMs": 10000
    }
  ]
}
```

`matcher` 是工具名的正则表达式，省略时匹配所有工具；`Stop` 不使用工具匹配。为避免主进程被灾难性回溯阻塞，匹配规则不能重复整个分组、使用 backreference 或包含超过两个量词；工具名按最多 128 字符匹配。通常使用 `^(read|write|edit)$` 或 `^web_.*$`。每份配置最多 32 条 Hook、256 KiB，超时范围为 10–120,000 ms。非法 JSON、非法正则或 schema 错误产生审计警告并跳过该份配置。

脚本通过 stdin 收到 JSON：`event`、`toolName`、`input`、`result`、`toolCallId`、`sessionId`、`runId`。`PostToolUse` 在工具成功或抛出错误后运行，错误表示为 `result: { status: "failed", error }`。超过 256 KiB 的输入只发送元数据和 `inputTruncated: true`，不发送截断后无效的 JSON。

- `PreToolUse` 退出码为 `0` 时放行，`2` 时阻断工具，stderr 进入工具错误。其他退出码和超时产生警告并放行。
- `PostToolUse` 成功退出后的 stdout 追加到字符串结果，或作为对象结果的 `hookContext` 字段；原对象字段保留。结果附加内容最多 16 KiB。
- stdout / stderr 各最多保留 8,192 字符，附加结果最多 16,384 字符。取消会终止执行；macOS / Linux 通过进程组终止整个脚本进程树，脚本退出时也清理遗留子进程。
- 审计保存事件、阶段、配置路径、命令 hash、退出码、执行时间和截断状态，不持久保存命令原文或工具输入。

这些脚本与用户的本地 shell 有同样的权限。开启总开关不批准待审批的工具，也不改写工具参数或权限模式。Agent 修改项目 Hook 配置必须走敏感文件审批。隔离 Worktree 的脚本工作目录是候选工作区，配置可由 `configProjectPath` 指向原项目，从而保留未跟踪的用户 Hook 配置。

主工具的 SDK 审批先完成，再由持久 invocation 账本记录执行，然后进入 `runner.invoke`。委派子工具在自己的审批 gate 成功后调用相同 runner；不能把可写子工具整个包在该 gate 外面。`Stop` 由回合收尾接线调用，输入需要审批而暂停的回合不代表工具已执行。

实现：`agents/hooks/config.ts`、`runner.ts`、`tool-wrapper.ts`。测试使用临时目录与实际 shell，覆盖阻断、全局和项目组合、匹配、取消、超时进程树清理、输出限额、工具错误和对象结果兼容。
