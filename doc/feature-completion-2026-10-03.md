# 未完成功能补齐与验收

范围：用户确认全部未完成项，优先屏幕感知，并授权并行子 agent。保持本次前已有的无关 dirty 工作；按后续追加要求本地提交 feature 相关改动，尚未推送 / 打 tag / 发布。

| 功能 | 已接入实现 | 验收记录 |
| --- | --- | --- |
| 屏幕感知 | 焦点锁定、AX / 选区、窗口截图、partial、四份暂存、TTL、canonical revision、会话路由、隐私开关与退出确认 | 原生 10 项；helper / IPC / renderer 重点回归；实际 UI / 权限待补 |
| 浏览器 | 七种有界动作、refs、字段 / 状态读回、焦点 / 遮挡 / 只读检查、真实 owner、审批 | 48 项；实际页面链路待补 |
| Bash / Git 回退 | snapshot、预览 / fingerprint、确认 / 安全备份、会话 lease、保留设置 | 临时 Git 回归；实际 UI 回退待补 |
| 长任务 | 持久 invocation、未知结果核对、防重放、worker 隔离、父 / 子每次调用预算与长结果分页 | 故障注入、死循环 / 洪泛 / 超时、预算 / 分页回归 |
| MCP / Web | stdio / HTTP、加密配置、连接与工具预算、网页抓取 / 搜索、DNS / 私网 / Host / SNI / 压缩约束 | 10 文件 / 88 项实际 wire；公共网页与账户待补 |
| Hooks | Pre / Post / Stop、审批后执行、阻断理由、超时 / 全局关闭 / audit | 实际子进程和退出生命周期回归通过 |
| Worktree / Best-of-N | HEAD 隔离、持久 child、真实审批 UI、并排 diff 统计、证据 refs、预览、单候选采纳与清理 | 临时 Git / SQLite / SDK stream / renderer 回归；实际 UI 待补 |
| 后台 / 定时任务 | 持久计划、headless chat、人工审批、取消、重启暂停、桌面 / 可选 Telegram 通知、管理页 | 31 项；实际 UI 待补，未发送真实 Telegram |

文件工具的额外私有路径边界保护 development / release app-config；模型不可通过 read / ls / grep 读取其他聊天未发送的捕获、配置或旧 result refs。Bash 的权限由其独立审批负责。

## 整体门禁

- 实现前基线：155 文件 / 1,268 项、typecheck、vp check 通过。
- 第一轮整合：184 文件 / 1,537 项，23 项失败；修复旧 mock / settings defaults / 导航图标与新增作用域接线。失败的七套已重跑 70 项通过。
- 启动和恢复修复后的全量回归：186 个文件 / 1,549 项测试通过；全量 typecheck 通过。新增 bootstrap 回归的 6 处 lint 写法修正后，3 项启动测试重跑通过；`vp check` 的 790 个格式检查文件 / 642 个 lint 文件全部通过，无 warning。
- Swift 原生 10 项测试通过；release 配置本地 `make` 成功，最新重打包用时 22.55 秒，生成 0.1.8 的 DMG / ZIP。版本未递增、未发布。
- 最新产物（JST 03:47）的 DMG / ZIP 完整性、ASAR header integrity、独立 worker / migration / native / helper 内容检查及 deep / strict codesign 均通过，均为 ad-hoc 签名。`.app` / DMG / ZIP 的 ASAR 一致，production helper ID 正确且没有混入 QA identity；只读挂载已卸载并清理。正式 Developer ID 与 notarization 未验收。

| 最新本地产物 | 字节数 | SHA-256 |
| --- | --: | --- |
| `apps/desktop/out/release/make/Etyon-0.1.8-arm64.dmg` | 140,677,812 | `84f1c7d530cd9bccfd4118046fb35b124907765b4cc51847d51a1b67a5132c9b` |
| `apps/desktop/out/release/make/zip/darwin/arm64/Etyon-darwin-arm64-0.1.8.zip` | 140,333,363 | `1d6629ed8c3d0d1355126e45659494733bd1c3f07d1fbd89a5866eacc3963fe3` |

ASAR SHA-256：`adc1e9f23b3a56998c1191e0467251721038f08c9513070956ecf22ad95804ee`。

- 实际启动发现 `useScreenAwareness` 在 `I18nProvider` 外调用，导致主窗口空白。已把两个运行时 listener 放到 Provider 内，并新增 3 项真实 bootstrap 回归；重新启动的日志中已不再出现 missing-instance / TypeError。实际窗口内容仍需在解锁后读回。
- 恢复流程补齐两处缺口：未知结果查询在服务端过滤，旧 unknown 不再被后续成功记录挤掉；子任务审批 RPC 失败显示错误并恢复按钮，重试成功后保持提交态。新增 3 项回归，含真实 DOM 的失败 / 重试流程。

## 受控 Electron 验收

使用临时 home / app-data / session-data、独立 Git fixture、本地模拟 OpenAI Chat Completions（dummy key）。实际审批、工具、DB、文件与 renderer 不使用模拟替代；模型响应使用可重复 fixture，并明确区别于真实付费账户验证。

公共 browser 页面仅测试 Selenium 官方 web-form 的文本 / checkbox / scroll / Tab，不提交表单。macOS 捕获仅用自建受控窗口，不读取任意用户前台内容。

实际各层 readback 和剩余系统授权 / Developer ID / notarization / 搜索账户边界将在本段补充。

原生模板的只读 `--status-json` 当前回读 `accessibility=not-granted`、`screenRecording=not-granted`。测试 helper 使用临时配置路径和独立 QA bundle identity；在用户确认前不授予系统权限。

第二次实际启动已成功建立本地服务并加载 renderer；UI 工具随后返回 Mac 已锁定、自动解锁失败，需要用户手动解锁。已向用户提交解锁请求及两项原生权限确认。以下实机操作尚未验收，不作为通过：主窗口 / 设置页真实显示、原生捕获、browser 交互、checkpoint UI 恢复、Best-of-N 选择与应用、automation 管理页。受控测试数据和本地 fixture 已就绪。

等待解锁期间，已结束本次自建 Electron 和两个本地模型 fixture 进程，移除临时 workspace bootstrap，并恢复 generated helper 的 production identity。临时配置、数据库、Git fixture 和诊断日志保留在 `/private/tmp/etyon-feature-qa-20261003/`，可用于后续验收；没有授予测试 helper 两项系统权限。

本地模型使用 dummy key；未验证真实搜索付费账户、Telegram 通知或正式签名下的 TCC 授权升级。正式 Developer ID、notarization / Gatekeeper 仍未验收。
