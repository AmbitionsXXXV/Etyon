# 后台与定时 Agent

Etyon 的后台任务在本机 main 进程运行，不依赖当前聊天页。应用开启期间，切换会话、隐藏或最小化窗口不会停止任务；退出应用或电脑关机后不会继续运行。

在设置的「后台任务」中选择已有会话、填写指令并保存。支持仅手动运行、分钟间隔和带 IANA 时区的五字段 Cron，例如 `0 9 * * 1-5` 配合 `Asia/Tokyo`。任务默认不启用定时计划，可先「立即运行」验证。模型留空沿用会话选择；显式 Agent 配置中的首选模型优先。每次运行有时限，默认 30 分钟。

权限仅支持 `default` 和 `acceptEdits`，不支持 `bypass`。后台执行复用 `/api/chat` 的工具审批、工作区围栏、调用账本、上下文预算和事件记录。审批或 `ask_user` 等问题出现时，运行保持 `suspended`，管理页提示「等待你的回应」；打开对应会话后使用现有审批或问题卡继续。没有自动批准操作。

## 持久化与并发

`automation_tasks` 保存指令、会话、模型 / 配置、权限、计划、通知选项、下次触发时间；`automation_runs` 保存每次触发及其确切 `agentRunId`、状态、结果摘要、错误和通知投递结果。同一会话最多有一个处于 `running` 或 `suspended` 的后台任务，SQLite 部分唯一索引保证这一约束。已有真人会话执行或待审批时，本次触发记录为 `skipped`。暂停或运行中的任务须先结束或取消，才能编辑或删除。

调度 cursor 在开始执行前推进到当前时间之后。睡眠唤醒最多触发一轮过期任务，不补跑每一个错过的 interval / Cron。启动时将上次未结算的后台记录标记为 `interrupted`，同一个事务内关闭这些任务的定时计划；核对聊天和工具结果后由用户重新启用，不重放指令或猜测工具已完成。其他已启用任务重新计算下一次时间。原有审批记录继续保留，通过持久 `run.superseded` 事件跟踪真人审批恢复后产生的新 Agent run。

## 后台执行入口

`createHeadlessAutomationRunner` 使用现有 `getServerUrl()` 和 `getLocalConnectionToken()` 向 `POST /api/chat` 发送认证请求，包含：

```json
{
  "agentMode": "agent",
  "automationPrompt": "检查项目状态",
  "automationRunId": "automation run id",
  "permissionMode": "default",
  "sessionId": "existing chat id"
}
```

可选 `model`、`profileId`。会话 middleware 先取得原有 session lease；route 在 lease 内读取当前消息并追加唯一的 `automation-<runId>` 用户消息，避免用一个过时快照覆盖刚完成的真人会话。`x-etyon-agent-run-id` response header 在读取流前绑定 Agent run。runner 消费完整 SSE 流，并从 Agent DB 和会话消息读回最终状态，不根据 HTTP 200 推断完成。通知或管理页无需持有流。

取消运行将 AbortSignal 传入 chat / agent loop，并等待会话 lease 释放后才更新为 `cancelled`。取消暂停任务需要同一个 session lease，在事务内只拒绝该确切 Agent run 的 pending approvals、更新它已有的 assistant tool parts 和工具状态，记录 `run.cancelled`；其他会话 / run 不受影响。取消不会回滚已经执行的工具，文件恢复使用现有 Checkpoint 功能。

## 通知与管理

创建、编辑、启停计划、立即运行、取消运行、删除及打开会话均在管理页提供。页面每 2 秒刷新状态、最近 30 条记录以及所有运行中 / 暂停记录，长列表在面板内滚动；暂停任务即使积累了更多 skipped 记录，仍能取消。桌面通知默认开启，点击后打开对应会话。Telegram 通知默认关闭；启用后只发送至「消息渠道」配置的 allowed chat IDs，没有允许的收件人会记录通知错误，不进行广播。通知说明状态及待处理入口，不发送整份任务指令或聊天内容。通知失败保留执行结果，在运行记录中单独显示，不触发任务重跑。

主进程在数据库迁移 / interrupted Agent 恢复及本机 server 启动后调用 `startAutomationService({ openSession })`；退出时先 `await stopAutomationService()`，再停止 server。RPC 挂载 `automationRouter` 到 `automation` 分面。任务默认列表为空，不修改已有会话或通知设置。

## 验证

`automation.test.ts` 使用内存 SQLite 和真实迁移覆盖权限、时区 / Cron、睡眠后调度、会话互斥、审批暂停、取消结算、重启恢复与通知错误。

`automation-runtime.test.ts` 覆盖真实请求契约、完整流消费、409 会话占用、abort 后等待 lease、按确切 run 取消审批 / canonical tool part、不触及其他 run、审批 continuation 跟踪和 fake 通知投递。所有测试只使用内存数据库、fake 通知和 fake server，不调用真人 Telegram。

`renderer/automation-tab.test.ts` 通过真实 HeroUI / React Query 渲染并点击管理页，覆盖新建任务权限与通知默认值、暂停任务的禁用编辑 / 运行、按 run ID 取消、删除确认及打开会话。
