# Codex 授权交互研究：Etyon Screen Awareness 复刻基线

**检索日期：** 2026-08-31（Asia/Tokyo）

## 结论

Etyon 要做的功能并不是抽象意义上的“像 Codex 的屏幕感知”，而是与 OpenAI 现有 **Appshots** 功能几乎同构：官方文档明确写明它在 macOS 上通过同时按下两个 Command 键触发，捕获前台窗口的画面与可访问文本，并作为附件加入会话。[OpenAI Appshots 文档](https://learn.chatgpt.com/docs/appshots)

授权体验应复刻 Codex 的三个核心原则，而不是复制它的品牌或 CSS：

1. 先解释为什么需要权限，再把用户送到 macOS System Settings。
2. 把系统权限、应用级审批和本次用户操作区分为不同层级。
3. UI 只根据实时权限回读显示成功；点击“前往系统设置”不等于已经授权。

对 Screen Awareness 而言，左右 Command 同按本身就是一次明确的用户手势。因此首版不应在每次捕获前再弹一个 `Allow once` 对话框；完成系统授权后，应直接捕获并把可移除的上下文附件放入输入框，让用户在发送前做最终确认。

## 可信度分级

| 等级 | 来源 | 可以作为依据的内容 | 不能据此断言的内容 |
| --- | --- | --- | --- |
| S | OpenAI 官方文档与 `openai/codex` | 产品语义、权限分层、App Server 状态机、TUI 选择项 | Codex Desktop 闭源渲染层的精确像素与内部组件名 |
| A | 直接连接真实 `codex app-server` 的开源客户端 | 请求绑定、审批队列、按钮层级、失败恢复 | 与官方桌面端完全一致的视觉细节 |
| B | 对特定 Codex Desktop 版本的逆向分析 | 文案线索、原生 helper 与权限窗口的大致结构 | 当前版本一定仍使用相同实现或文案 |
| C | 静态克隆、截图复刻或重新打包官方 bundle | 视觉方向参考 | 安全语义、协议正确性、可直接复用的授权实现 |

## 官方语义

### Appshots 与 Etyon 目标一致

[OpenAI Appshots 文档](https://learn.chatgpt.com/docs/appshots) 确认了以下行为：

- 仅捕获前台窗口，而不是整个桌面。
- 可包含可见窗口截图，以及应用通过 Accessibility 暴露的可用文本；文本可能包含当前视口之外的内容。
- 触发键是左右两个 Command 键同时按下，也允许自定义热键。
- 捕获结果作为聊天附件处理；连续捕获会进入同一最近会话。
- Screen & System Audio Recording 用于窗口画面，Accessibility 用于读取窗口文本。
- 故障排查要求检查 **Codex Computer Use** 在两项系统权限中的实际状态，并在需要时重启应用。

这说明 Etyon 的产品合同应写成“当前窗口的截图 + 可访问文本”，不能把 OCR 当成 Accessibility 的同义词，也不能把权限按钮点击当成捕获成功。

### 系统授权与应用审批是两层

[OpenAI Computer Use 文档](https://learn.chatgpt.com/docs/computer-use) 明确区分：

- macOS 系统权限决定应用能否看见并操作其他 App。
- ChatGPT 内部的 App approval 决定用户允许它使用哪些 App。
- Shell、文件和网络操作继续服从各自的 sandbox / approval 设置。

官方的应用级卡片示例使用简短标题“Allow Codex to use Calculator?”，操作层级为 `Allow`、`Always allow` 和 `Cancel`；永久允许的 App 可在 Settings > Computer Use 中撤销。这个语义适合有主动控制能力的 Computer Use，不应原样套到只读、用户手势触发的 Screen Awareness。

### Sandbox 与 approval 也不是同一个概念

[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security) 把安全控制拆成两层：sandbox mode 决定技术上允许做什么，approval policy 决定何时必须停下来询问。默认 `Auto` 可以在 workspace 内自动读写和运行受限命令，离开边界或使用网络时才询问。

映射到 Etyon：

- macOS TCC 权限相当于不可绕过的技术边界。
- 左右 Command 用户手势相当于本次 capture 的意图授权。
- 输入框中的 Screen Awareness 附件相当于发送前的可见、可撤销确认。

## `openai/codex` 源码中的 approval 体验

### TUI 呈现层

官方开源的 [`approval_overlay.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/approval_overlay.rs) 提供了最可靠的交互参考：

- 请求按类型显示专属问题，不使用一个万能“需要权限”标题。命令、网络、文件编辑、额外权限和 MCP elicitation 各自有不同标题。
- 标题之后先展示 `Reason`、目标环境、权限规则、命令或 diff，再展示选择项。
- 选项由服务端的 `availableDecisions` 决定，客户端不会展示协议未提供的权限范围。
- 一次允许、session 允许和持久规则是三个不同决策，不用模糊的单一“记住选择”复选框。
- 命令审批的关键文案层级是 `Yes, proceed`、session 级允许、`No, continue without running it` 与 `No, and tell Codex what to do differently`。
- 当前请求解决后自动推进队列；外部 `serverRequest/resolved` 也能关闭已经失效的卡片。
- `Esc` / Ctrl+C 有明确的 cancel 语义，不会把关闭弹层误当成继续执行。

该文件还把审批历史写回会话，例如 `ApprovedForSession`、`Denied`、`Abort`。因此成功反馈不是只消失弹窗，而是形成可审计的结果状态。

### App Server 协议状态机

[Codex App Server 文档](https://learn.chatgpt.com/docs/app-server) 与其 [开源 README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) 定义了如下生命周期：

```text
item/started
    ↓
item/.../requestApproval
    ↓
客户端提交 decision
    ↓
serverRequest/resolved
    ↓
item/completed（completed / failed / declined）
```

关键合同：

- 请求携带 `threadId`、`turnId` 与 `itemId`，UI 必须绑定到正确会话，不能用单个全局布尔值。
- command 决策包括 `accept`、`acceptForSession`、`decline`、`cancel`，以及协议明确提供时的规则 amendment。
- `serverRequest/resolved` 既覆盖用户回答，也覆盖 turn 开始、完成或中断导致的清理。
- `item/completed` 才是最终结果；点击按钮或发送 RPC 不是最终成功。
- 多个请求可能排队或并发，客户端必须保证过期按钮不能回答新的请求。

这些规则可以直接迁移到 Etyon 的权限状态管理：权限读取结果、打开设置动作和实际 capture 结果必须使用独立状态，所有异步结果都要带 request / capture ID 防止串台。

## 可复用的公开项目

### A 级：`lezi-fun/codex-webui`

[`lezi-fun/codex-webui`](https://github.com/lezi-fun/codex-webui) 直接连接真实 `codex app-server`，不是静态演示；仓库说明还包含真实 approval E2E：触发无害命令、等待真实请求、点击一次允许、验证结果并清理临时文件。

最值得复用的是：

- [`public/codex-surfaces.js`](https://github.com/lezi-fun/codex-webui/blob/main/public/codex-surfaces.js#L10-L98) 把协议 payload 转成独立 view model，区分 command、network、patch 与 permission。
- 它使用 `Allow once` 作为主操作，把 `Allow this conversation` 收在主按钮的下拉菜单中，并仅在 amendment 存在时展示 `Allow similar commands`。
- [`public/app.js`](https://github.com/lezi-fun/codex-webui/blob/main/public/app.js#L332-L335) 把卡片插在对应 activity 后面，显示身份、标题、副标题、原因与原始内容，并在 activity 上显示 waiting-for-approval 状态。
- [`public/style.css`](https://github.com/lezi-fun/codex-webui/blob/main/public/style.css#L1708-L1717) 可以作为卡片信息密度与主次按钮布局的参考：内容、原始命令和操作区明确分段，较宽授权进入 split-button 菜单；不要直接复制它的 Codex 视觉 token。
- 它的 README 明确提醒不要把 approval 端口暴露到公网，并限制浏览器可调用的 App Server RPC。

可借鉴：**view model 与协议分离、一次允许为默认主操作、较宽授权放入次级菜单、审批内容与正在等待的 activity 放在一起。**

需要改进后再用：当前浏览器实现提交响应后立即移除卡片，Etyon 应等待主进程确认 / readback，失败时保留可重试状态。

### A 级：`pingdotgg/t3code`

[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) 不是视觉复刻，而是支持 Codex 等多个 provider 的真实客户端。它更适合参考“协议适配层”和“窄空间内如何展示待审批状态”。

- [`CodexAdapter.ts`](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/CodexAdapter.ts) 把 Codex 的 command / file-change approval 规范化成跨 provider 的 `request.opened` / `request.resolved` 生命周期。
- [`ComposerPendingApprovalPanel.tsx`](https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx#L9-L55) 在 composer 中内联显示完整、可滚动、可聚焦的原始 detail，并在多个待办时展示 `1/n`。
- [Permission Modes 文档](https://github.com/pingdotgg/t3code/blob/main/docs/user/permission-modes.md) 把 Supervised、Auto-accept edits、Auto 与 Full access 的差异写成用户可理解的行为，而不是暴露底层 flags。

可借鉴：**权限状态贴近输入区、原始内容始终可检查、多个请求有计数、provider 差异收敛到稳定的产品语义。**

### B 级：`huyansheng3/codex-analysis`

[`codex-computer-use-implementation.md`](https://github.com/huyansheng3/codex-analysis/blob/main/docs/codex-computer-use-implementation.md#L642-L691) 是对 Codex Desktop `26.506.31421` 的逆向研究，不是 OpenAI 官方源码。它记录的 native permission window 结构与公开 issue 中的 helper / TCC 行为相互吻合：

- 独立 `Codex Computer Use.app` helper 持有 Accessibility 与 Screen Recording 权限。
- 权限模型至少有未授权、请求中、已授权三种状态。
- 窗口标题为 “Enable Codex Computer Use”，有两条权限说明和 “Complete in System Settings” 主操作。
- 应用级审批另有独立的 allow-once / persistent / deny 流程。

这份资料可以帮助 Etyon 复刻信息架构，但它只有特定版本、反编译与 strings 证据，不能作为当前 Codex UI 精确像素或实现细节的唯一来源。

### 不应作为实现基线的项目

- [`Yrd980/codex-web-ui-clone`](https://github.com/Yrd980/codex-web-ui-clone) 明确说明数据和 tool surfaces 大多是 mocked，只是 screenshot-backed 的视觉 / 交互原型。它可以看布局，不能证明 approval 状态机正确。
- [`Haleclipse/CodexDesktop-Rebuild`](https://github.com/Haleclipse/CodexDesktop-Rebuild) 面向跨平台重新打包 Codex Desktop，仓库结构包含同步来的 webview / main bundle。它看起来最接近官方，但不是 clean-room UI 实现，不能把其中的闭源资产、bundle 或品牌内容复制进 Etyon。
- [`friuns2/codex-mobile`](https://github.com/friuns2/codex-mobile) 通过桥接 Codex App Server 提供浏览器 UI，适合研究远程 transport，不适合作为 macOS TCC onboarding 的原生实现参考。
- [`dfones288/codex-desktop`](https://github.com/dfones288/codex-desktop) 主要包装 `codex exec --json`，README 未给出 App Server approval request 的完整处理链，不能作为 approval 协议实现依据。

## 推荐给 Etyon 的 macOS 授权交互

### 1. 首次触发才进入 onboarding

用户第一次同时按下左右 Command 时：

1. 立即锁定原前台窗口元数据，但不尝试静默循环请求权限。
2. 如果两项权限都已授权，直接 capture。
3. 如果任一权限缺失，显示一个独立的 Etyon 权限窗口；不要先让 macOS 弹出缺少上下文的系统提示。
4. 用户选择前往设置后，打开对应 Privacy & Security 页面；Etyon 保持 waiting 状态。
5. Etyon 重新激活或系统权限变化时实时回读；只有 API 回读为 granted 才显示完成。
6. 两项都完成后，显示一次“同时按下左右 Command 试一下”，不自动捕获用户当前已切换到的 System Settings 窗口。

### 2. 推荐文案

```text
启用屏幕感知

Etyon 需要以下权限来理解你主动分享的当前窗口。
只有在你同时按下左右 Command 时才会读取或截图。

屏幕与系统音频录制
用于获取当前窗口画面；Etyon 不会持续录屏或录制音频。

辅助功能
用于读取当前窗口提供的可访问文本；Screen Awareness 不会控制鼠标或键盘。

[稍后]  [前往系统设置]
```

状态文案应明确区分：

- `未授权`
- `等待在系统设置中开启`
- `已授权`
- `需要重新打开 Etyon`
- `权限已撤销`
- `无法读取状态 · 重试`

macOS 的权限名称包含“系统音频”，但 Screen Awareness 不需要音频。必须明确写“不录制音频”，并确保实现确实没有创建音频 capture path。

### 3. 权限窗口布局

```text
┌──────────────────────────────────────────────┐
│                 Screen Awareness             │
│  仅在你同时按下左右 Command 时读取当前窗口    │
│                                              │
│  [窗口图标] 屏幕与系统音频录制        已授权  │
│             获取当前窗口画面                 │
│                                              │
│  [文本图标] 辅助功能                  待开启  │
│             读取当前窗口可访问文本           │
│                                              │
│  捕获内容会在发送前显示，可随时移除。         │
│                         [稍后] [前往系统设置] │
└──────────────────────────────────────────────┘
```

保留一个主 CTA，权限行负责解释与显示状态，不要同时放两个抢焦点的“授权”按钮。若系统 API 必须分别触发，则主 CTA 按当前缺失项推进，并在返回后更新到下一项。

### 4. 完成授权后的每次捕获

捕获成功后不要立刻发送，先在 composer 中 stage：

```text
[Safari · Gmail]
截图 · 可访问文本                         ×
```

- chip 显示来源 App、窗口标题和实际获得的内容类型。
- 用户能预览截图、移除整个 capture，或只移除截图 / 文本。
- 只有截图成功时显示“截图”；只有 Accessibility 文本成功时显示“可访问文本”。
- 部分成功可以继续，但要明确提示缺失项；两项都失败才算 capture 失败。
- 捕获失败时保留目标 App 信息与重试入口，不能只显示“授权失败”。

### 5. 推荐状态机

```text
idle
  └─ 双 Command → preflight
       ├─ 全部 granted → capturing
       │                    ├─ success → staged
       │                    ├─ partial → staged_with_warning
       │                    └─ failed  → retryable_error
       └─ 有缺失 → onboarding
                      ├─ open_system_settings
                      ├─ waiting_for_readback
                      ├─ needs_restart
                      └─ granted → ready_to_try
```

实现约束：

- 所有状态都绑定一个 `captureRequestId`，旧的权限回调或截图结果不能覆盖新请求。
- `open_system_settings` 只是动作结果，不是权限结果。
- 应用重新激活、系统唤醒、helper 重启和每次 capture 前都重新 preflight。
- 如果采用独立 helper，授权 UI 必须告诉用户 System Settings 中应开启的**准确显示名称**，并用签名稳定的 bundle identity 做正式包验收。
- 窗口被关闭、turn 被取消或请求被替换时，必须清理 pending 状态；过期按钮只能显示“请求已失效”。

## 不能照搬的部分

1. **不要给 TCC 授权造“一次 / 本次会话 / 永久”三个按钮。** macOS 系统权限本身是持久授权，Etyon 无法诚实提供一次性 TCC grant。左右 Command 手势才是一次性使用授权。
2. **不要复制 Computer Use 的 `Always allow App`。** Screen Awareness 是只读、用户主动触发，不需要再维护一套 App allowlist；敏感 App 应由 denylist / secure-field 策略直接拒绝或降级。
3. **不要把 `Cancel` 与 `Decline` 强行塞进简单 onboarding。** Codex command approval 中二者分别表示继续但跳过动作、或中止 / 让用户改方向；系统权限页只需要“稍后”和“前往系统设置”。
4. **不要照抄 Codex 品牌资产、反编译 bundle、helper 名称或闭源样式。** 复刻交互语义即可，Etyon 使用自己的 HeroUI 设计系统。
5. **不要承诺读取所有文本。** 官方 Appshots 文档也说明部分 App / 网站只能得到可见截图，无法得到完整或视口外文本。
6. **不要在权限未齐时假装完整成功。** 截图-only、文本-only、两者都有必须是三个可观察结果。
7. **不要自动操作 System Settings。** Etyon 可以打开设置页面和检测结果，但不能代用户开启开关、输入密码或批准隐私权限。

## 验收要求

- 首次双 Command、设置页入口与菜单入口都复用同一个权限状态机。
- Accessibility 和 Screen Recording 分别拒绝、单独允许、撤销、重新允许后，UI 与实际 capture readback 一致。
- 正式签名 `.app` 与开发包分别验证，不能复用另一个 bundle identity 的 TCC 结果。
- 重新打开 Etyon 或 helper 后仍能正确识别权限；需要重启时给出明确动作。
- 权限窗口打开期间再次双 Command 不创建重复 onboarding。
- 完成授权后不会误捕获 System Settings；必须等用户再次触发。
- 密码输入框、密码管理器、安全系统页面和 Etyon 自身窗口有明确拒绝 / 脱敏行为。
- 每次 capture 的截图、可访问文本、来源 App 与最终模型输入均可在调试日志中按 ID 对账，但日志不得记录正文与截图内容。
- staged attachment 被移除后不会进入持久化消息或模型请求。

## 建议采用的实现基线

优先级从高到低：

1. 产品合同与权限说明以 [OpenAI Appshots](https://learn.chatgpt.com/docs/appshots) 为准。
2. 系统权限与应用审批分层以 [OpenAI Computer Use](https://learn.chatgpt.com/docs/computer-use) 为准。
3. 异步请求、resolved 与 completed 生命周期以 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 为准。
4. 选择项生成、队列与 cancel 语义参考 [`approval_overlay.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/approval_overlay.rs)。
5. Web / Electron 呈现参考 [`lezi-fun/codex-webui`](https://github.com/lezi-fun/codex-webui) 与 [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code)，但使用 Etyon 自有组件重建。
6. Codex 原生权限窗口文案只能把 [`huyansheng3/codex-analysis`](https://github.com/huyansheng3/codex-analysis) 当作需要实机复核的补充线索。
