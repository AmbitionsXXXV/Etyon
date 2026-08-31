# Screen Awareness 能力扩展

## 状态

本文定义 Etyon 在 macOS 上的 Screen Awareness 产品合同、授权体验、module interface、原生 helper、Chat 接入与发布验收。

当前状态是设计已收敛，macOS Phase 1 可运行切片已经开始落地。授权交互研究与来源分级见 [`codex-approval-ux-research.md`](./codex-approval-ux-research.md)。

已实现的首个切片包括：

- `Etyon Screen Awareness.app` Swift helper、稳定 dev / release bundle ID 与 Application Support 稳定安装路径。
- 首次触发权限窗口、左右 Command 教学、`0 / 2` 实时状态与三语文案。
- Accessibility / Screen Recording 的系统 preflight 和 typed System Settings deep link。
- 跟随 System Settings 的 Etyon 自有悬浮授权面板、拖拽 App 图标与步骤进度。
- 双 Command latch 与原生 `CGEventTap` 监听。
- helper 实时状态文件和 Electron 主进程 readback。
- Electron 启停生命周期、原生菜单入口、Forge 自动构建和资源打包。

尚未完成窗口截图、AX 文本提取、Chat mention / composer staged context 与正式 Developer ID / notarization readback。

## 目标

用户在任意前台 Mac App 中同时按下左右 Command 后，Etyon：

1. 在 Etyon 获得焦点前锁定当前前台窗口。
2. 捕获该窗口的可见画面与 Accessibility 可访问文本。
3. 打开或复用一个 Chat，并把捕获结果暂存为可预览、可移除的上下文。
4. 只有用户发送消息后，才把上下文交给模型。

OpenAI 官方把同构能力称为 [Appshots](https://learn.chatgpt.com/docs/appshots)：macOS 上可同时按下两个 Command 键触发，只捕获前台窗口，可包含窗口图像与可访问文本，并作为会话附件处理。

## macOS 首版范围

- 平台：macOS 14+。
- 架构：Apple Silicon 首发，与当前 release workflow 保持一致。
- 固定触发：左右 Command 同时按下；首版不提供自定义热键。
- 捕获范围：前台窗口，不捕获整个桌面，不录制音频。
- 上下文：窗口截图、可访问文本、选中文本、App / 窗口元数据。
- 入口：全局双 Command、`@ Screen Awareness`、原生菜单 `Send Focused Window to AI`。
- 结果：先进入 composer 暂存区，不自动发送。
- 权限：Screen & System Audio Recording、Accessibility。
- 降级：截图和文本允许部分成功；两者都失败才判定 capture 失败。
- 安全：密码控件、Etyon 自身和受保护系统表面拒绝或脱敏。

Windows 与 Linux 不进入首版关键路径，也不为它们提前暴露公共平台 interface。等第二个真实平台 adapter 开始实现时，再将 macOS 内部 seam 提升为跨平台 seam。

## 参考实现决策

### 产品合同：OpenAI Appshots

[OpenAI Appshots](https://learn.chatgpt.com/docs/appshots) 是最高优先级依据：

- 同时按下左右 Command。
- 捕获前台窗口图像与可访问文本。
- Screen Recording 用于图像，Accessibility 用于文本。
- 捕获结果按附件处理。
- 部分 App 或网站只能得到可见截图，不能承诺完整、视口外文本。

Etyon 复刻产品语义，不复制 Codex 品牌、闭源资产或像素级样式。

### 原生架构与 onboarding：`open-codex-computer-use`

[`iFurySt/open-codex-computer-use`](https://github.com/iFurySt/open-codex-computer-use) 是 macOS 实现基线。它是 MIT License、macOS 14+、Swift 为主，并在首次运行时要求 Accessibility 与 Screen Recording。

重点参考 [`PermissionOnboardingApp.swift`](https://github.com/iFurySt/open-codex-computer-use/blob/main/apps/OpenComputerUse/Sources/OpenComputerUse/PermissionOnboardingApp.swift)：

- `PermissionWindowController` 管理独立权限窗口。
- `PermissionAccessoryPanelController` 管理跟随 System Settings 的悬浮引导面板。
- Accessibility 请求先触发系统 prompt，再打开对应 System Settings 页面。
- 权限状态实时回读，全部授权后完成；需要时提供 relaunch。
- `CGWindowListCopyWindowInfo` 定位 System Settings 窗口，并跟随窗口位置更新辅助面板。

Etyon 不整体复制该文件。可复用其公开、MIT 授权的状态机与窗口跟随思路，并用 Etyon 自有视觉和文案重建。

### 权限 UI：`PermissionFlow` / `SystemSettingsKit`

[`jaywcjlove/PermissionFlow`](https://github.com/jaywcjlove/PermissionFlow) 是采用的 Swift Package 来源：

- MIT License。
- macOS 13+，覆盖 Accessibility 与 Screen Recording。
- 打开正确的 System Settings pane。
- 悬浮面板从点击位置动画到 System Settings。
- 面板跟随 System Settings 窗口移动。
- 把当前 `.app` 作为原生拖拽源，允许用户拖入 TCC App 列表。
- 使用 `AXIsProcessTrusted`、`CGPreflightScreenCaptureAccess` 等官方 API 回读状态。

当前实现固定依赖 `1.0.0`，复用其 `SystemSettingsKit` typed deeplink，并已在 `THIRD_PARTY_NOTICES.md` 登记。完整 `PermissionFlow` 的 stock panel 信息密度不足以还原已确认的 `1 / 2`、下一步与实时状态，因此悬浮 companion panel 由 Etyon 自有 SwiftUI / AppKit 实现；没有复制 Codex 或 `open-codex-computer-use` 的品牌与闭源资产。

拖拽不能只使用 SwiftUI `.onDrag` 的通用 `NSItemProvider`。System Settings 对 Finder 风格文件载荷的兼容性更稳定，因此 Etyon 使用 AppKit `NSDraggingSource`，同时发布 `public.file-url`、`public.url`、`NSFilenamesPboardType`、promised file URL 和路径文本。拖拽开始后悬浮面板临时进入 mouse passthrough，让底层 System Settings 列表实际接收 drop；结束后恢复交互。

## 体系结构

```text
┌─────────────────────────────────────────────────────────────┐
│ Etyon Electron                                              │
│                                                             │
│  Main process                                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ScreenAwareness module                                │  │
│  │ lifecycle · helper bridge · capture store · routing   │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ authenticated local IPC           │
│  Renderer                │                                   │
│  composer chip ← capture │ → chat request → model context    │
└──────────────────────────┼───────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Etyon Screen Awareness.app                                 │
│ signed Swift helper · stable bundle identity + install path│
│                                                            │
│ dual-Command monitor · foreground tracker · AX extraction  │
│ ScreenCaptureKit · PermissionFlow onboarding               │
└────────────────────────────────────────────────────────────┘
```

### 为什么使用独立 helper `.app`

- System Settings 中出现稳定、明确的授权主体。
- helper 可作为拖拽源加入 Accessibility / Screen Recording 列表。
- 双 Command 监听、AX 读取和截图使用同一个 TCC 身份。
- Electron renderer 不获得系统能力，也不直接接触原始 native handle。
- 主 App 更新 UI 时不会把权限实现散落到 preload、renderer 与 route。

Forge 产物中的 helper 只是签名模板，不直接作为 TCC 运行主体。Electron 启动时按 executable SHA-256 比较模板与已安装副本，并把 helper 原子更新到以下稳定顶层路径：

```text
dev:     ~/.config/etyon-dev/screen-awareness/Etyon Screen Awareness.app
release: ~/.config/etyon/screen-awareness/Etyon Screen Awareness.app
```

所有权限请求、全局快捷键监听和状态 readback 都只运行该安装副本。这样避免源码资源、Forge 嵌套资源和已安装 App 使用同一 bundle ID 时被 LaunchServices / TCC 绑定到不同路径；Screen Recording 不直接授权 `Contents/Resources` 内的模板副本。

正式 bundle identity 建议：

```text
release: com.etcetera.etyon.screen-awareness
dev:     com.etcetera.etyon.dev.screen-awareness
```

开发版与正式版权限分别验收，不复用彼此的 TCC 结果。

### 开发签名与“开关已开但仍等待授权”

本地没有 Apple code-signing identity 时，build script 会对 helper 使用 ad-hoc 签名。ad-hoc helper 的 designated requirement 绑定当前 `CDHash`；重新编译后哈希变化，即使 System Settings 仍保留同名且显示为开启的旧行，新进程也可能被 `AXIsProcessTrusted()` 或 `CGPreflightScreenCaptureAccess()` 判定为未授权。

诊断和验收规则：

- 以 helper 进程内的实时 preflight readback 为准，不以 System Settings 的视觉开关为准。
- 先确认授权列表里确实存在 `Etyon Screen Awareness.app`；不存在表示拖拽或添加没有成功。
- ad-hoc 开发构建变化后，需要对当前构建重新关闭并打开授权开关。
- Screen Recording 在当前进程内可能继续返回未授权；第 `2 / 2` 步提供“重启并检查”，helper 使用 `NSWorkspace` 以原参数创建新实例，再退出旧进程。若 macOS 显示原生 `Quit & Reopen`，以系统动作完成权限提交。
- Electron 必须通过 LaunchServices `open -na <helper.app> --args ...` 启动稳定 helper，不能直接 `spawn` 内部 Mach-O；直接子进程启动会让 TCC 把权限归属到外层 `Etyon.app`。生命周期结束通过本地 control file 通知 helper 自行退出。
- macOS 27 将 Accessibility 更名为 `Device Control and Data Access`，但 `Privacy_Accessibility` anchor 保持不变；Etyon 继续使用精确 anchor，只根据系统版本切换显示名称。授权页打开时应避免把用户仍按住的键盘输入误判为 deeplink 失败。
- 正式发布必须使用稳定 Developer ID 身份签署外层 Etyon 和嵌套 helper，并在 notarized artifact 上完成一次授权、升级和撤销回读。

## Module interface

`apps/desktop/src/main/screen-awareness/` 是调用方与实现之间的 seam。菜单、快捷键入口、RPC 和 Chat 只依赖这一个 interface：

```ts
interface ScreenAwarenessModule {
  capture(
    source: ScreenAwarenessCaptureSource
  ): Promise<ScreenAwarenessCaptureResult>
  dispose(): Promise<void>
  getStatus(): Promise<ScreenAwarenessStatus>
  showPermissionOnboarding(): Promise<void>
  start(): Promise<void>
}
```

interface 约束：

- `start()` 幂等；负责 helper 启动、协议握手、事件订阅和恢复。
- `capture()` 只返回已经持久化并可供 composer 使用的结果。
- `showPermissionOnboarding()` 只负责展示，不把“窗口打开成功”当作“授权成功”。
- `getStatus()` 返回当前实时权限与 helper 状态，不返回 settings 中的缓存假象。
- `dispose()` 必须注销 Command 监听并终止 helper / IPC。

helper、IPC、TCC 与 ScreenCaptureKit 都是 module 的 implementation，不暴露给 Chat route。

## Helper 协议

helper 通过仅本机、带启动期随机 token 的 IPC 与 Etyon 主进程通信。协议事件至少包含：

```ts
type ScreenAwarenessHelperEvent =
  | {
      requestId: string
      type: "shortcut-triggered"
      window: FocusedWindowIdentity
    }
  | {
      requestId: string
      status: ScreenAwarenessPermissionStatus
      type: "permission-required"
    }
  | {
      capture: NativeScreenCapture
      requestId: string
      type: "capture-completed"
    }
  | { error: ScreenAwarenessError; requestId: string; type: "capture-failed" }
  | {
      status: ScreenAwarenessPermissionStatus
      type: "permission-status-changed"
    }
```

约束：

- 所有异步捕获都带 `requestId`，旧结果不能覆盖新请求。
- helper 在双 Command 事件发生时先锁定窗口 identity，再通知 Etyon。
- Etyon 只有在 native capture 已锁定后才能获得焦点。
- helper 异常退出后由 main process 有界重启；连续失败后显示可诊断错误，不无限循环。
- IPC 日志只记录 request ID、状态、耗时和 App bundle ID，不记录截图或正文。

## 双 Command 状态机

```text
idle
  ├─ left down  → left_only
  └─ right down → right_only

left_only + right down → chord_latched → capture
right_only + left down → chord_latched → capture

chord_latched
  ├─ 任意重复 flagsChanged → ignore
  └─ 两侧全部松开 → idle
```

实现要求：

- 通过原生 `CGEventTap` 监听 modifier 事件。
- 使用每侧 Command 的实际 key state，不只读取聚合 modifier flags。
- 一次按住只触发一次。
- 第二个 Command 按下时锁定前台窗口。
- 等修饰键松开后再聚焦 composer，避免残留 Command 触发菜单。
- Accessibility 被撤销、系统睡眠唤醒或 event tap 被系统停用时重新 preflight。

## 权限 onboarding

### 已确认的视觉方向

权限体验采用已经确认的 `System Settings 伴随式 + 双 Command 试用式` 合并方向：

1. 首次触发先展示独立权限窗口。左侧建立“左右 Command 同时按下”的操作记忆，右侧显示 `0 / 2` 权限进度与两项权限状态。
2. 主窗口只保留一个主操作 `设置权限` 和一个弱操作 `稍后`。
3. 进入授权后打开对应的 System Settings pane，同时显示 `Etyon Screen Awareness.app` 的原生悬浮引导面板。
4. 悬浮面板提供可拖拽的 helper App 图标、当前步骤、下一步和实时授权状态，不遮挡 System Settings 的列表或开关。
5. 两阶段使用相同的 Etyon 图标、字号、圆角、间距和黑白语义层级，避免像两个独立产品。

视觉规格：

- 首次窗口目标尺寸约 `880 × 648`，单窗口、无 sidebar、无 tabs。
- 标题使用清晰的两行内层级，正文保持 `14–16 px` 可读尺寸。
- 权限列表是一个 grouped surface，以细分隔线组织两行，不使用嵌套卡片。
- 主按钮使用高对比 primary；`稍后` 使用 tertiary / outline。
- System Settings 悬浮面板宽度约 `480–530 px`，只承载当前授权动作。
- 所有状态变化由实时 readback 驱动；按钮点击不直接切换为成功状态。

### 产品原则

macOS TCC 权限与 Etyon 的单次 capture 意图不是同一件事：

- TCC 决定 helper 技术上能否截图或读取 AX 文本。
- 左右 Command 手势是本次 capture 的明确用户授权。
- composer 中的 staged context 是发送给模型前的最终确认。

因此不为 TCC 伪造 `Allow once / this session / always`。系统权限一旦授予就是持久授权；用户可以在 System Settings 中撤销。

### 首次流程

```text
首次双 Command
  ↓
helper 锁定原窗口 identity
  ↓
permission preflight
  ├─ 全部 granted → capture
  └─ 有缺失 → Etyon 权限窗口
                   ↓
              打开对应 System Settings
                   ↓
              显示跟随窗口的悬浮引导
                   ↓
              实时 readback / relaunch
                   ↓
              ready_to_try
                   ↓
              用户再次双 Command
```

授权完成后不自动捕获 System Settings；必须等待用户再次触发。

### 权限窗口

```text
┌────────────────────────────────────────────────────────┐
│                    Screen Awareness                    │
│  仅在同时按下左右 Command 时读取当前窗口               │
│                                                        │
│  [窗口] 屏幕与系统音频录制                    已授权   │
│         获取当前窗口画面；Etyon 不会录制音频            │
│                                                        │
│  [文本] 辅助功能                              待开启   │
│         读取当前窗口提供的可访问文本                    │
│                                                        │
│  捕获内容会在发送前显示，可预览或移除。                  │
│                              [稍后] [前往系统设置]       │
└────────────────────────────────────────────────────────┘
```

主 CTA 按当前缺失权限推进，权限行负责说明和实时状态。不要同时放两个争抢焦点的主按钮。

### System Settings 悬浮引导

使用 Etyon 自有 companion panel，并复用 `SystemSettingsKit`：

- 打开精确的 Accessibility / Screen Recording pane。
- 悬浮面板跟随 System Settings 主窗口。
- 展示签名后的 `Etyon Screen Awareness.app` 图标作为拖拽源。
- 说明“拖入列表后仍需打开开关”。
- 实时显示当前 permission 是否已回读为 granted。
- System Settings 关闭时自动关闭引导面板。
- 多显示器、窗口移动和 pane 切换时更新位置；定位失败时退化到当前屏幕底部，不阻塞授权。

### 权限状态

```ts
type PermissionState =
  | "not-granted"
  | "waiting-in-system-settings"
  | "granted"
  | "restart-required"
  | "revoked"
  | "unavailable"
  | "error"
```

`openSystemSettings()` 成功不改变权限状态。只有系统 API readback 才能进入 `granted`。

## Native capture

每次 capture 产生：

```ts
interface NativeScreenCapture {
  accessibleText: string | null
  appBundleId: string
  appName: string
  capturedAt: string
  selectedText: string | null
  screenshotPng: Uint8Array | null
  windowBounds: { height: number; width: number; x: number; y: number }
  windowId: string
  windowTitle: string
}
```

实现顺序：

1. `NSWorkspace.frontmostApplication` 锁定前台 PID / bundle ID。
2. Accessibility 获取 focused window、focused element 与 selected text。
3. 有界遍历 AX tree，收集 title、description、value 与文本节点。
4. ScreenCaptureKit 对目标窗口截图。
5. 主进程把 PNG 写入现有 attachment store，把文本写入 capture record。

约束：

- AX traversal 有节点数、深度、字符数和时间预算。
- `AXSecureTextField`、密码属性和已知敏感控件不读取 value。
- Screenshot 不创建 audio capture path。
- 窗口关闭、PID 变化或 capture target 失效时返回结构化错误。
- Screenshot-only 与 text-only 是合法 partial 结果。
- 对不支持 AX 完整文本的网页和文档，不声称已获取整个文档。

## 数据合同与持久化

`ChatMentionSchema` 增加轻量引用，不把正文或 Base64 图片放入 TipTap attrs：

```ts
interface ChatScreenAwarenessMention {
  appName: string
  captureId: string
  capturedAt: string
  kind: "screenAwareness"
  windowTitle: string
}
```

主进程 capture record：

```ts
interface ScreenAwarenessCaptureRecord {
  accessibleText: string | null
  appBundleId: string
  appName: string
  captureId: string
  capturedAt: string
  screenshotUrl: string | null
  selectedText: string | null
  windowTitle: string
}
```

- PNG 复用 `apps/desktop/src/main/attachments.ts` 的内容寻址存储。
- capture record 位于 Etyon app config 目录，不写入用户项目。
- message metadata 只保存 capture ID 与展示信息。
- 未发送 capture 有 TTL；发送后随会话保留。
- 删除 / 归档会话时由引用扫描清理无主 capture 与附件。

## Chat 接入

### Composer

捕获完成后插入：

```text
[Safari · Gmail]
截图 · 可访问文本                                  ×
```

- 显示真实获得的内容类型，不预先宣称成功。
- 可预览截图、文本摘要和来源窗口。
- 可移除整个 capture，或分别移除 screenshot / text。
- 多次双 Command 可以暂存多个 capture。
- partial 结果显示非阻塞警告和修复入口。

### Session routing

参考 Appshots，但服从 Etyon 已有 session / project 模型：

- 当前正在 Chat 页面时复用当前 session。
- 主窗口隐藏且最近 60 秒使用过某个 session 时复用该 session。
- 否则创建新 session，并沿用最近 session 的 project path。
- 连续捕获进入同一个目标 session。
- 请求处理中新增 capture 进入现有 queued message 机制，不插入正在生成的 user message。

### 模型上下文

- 视觉模型：用户文本 + accessible text + screenshot。
- 非视觉模型：用户文本 + accessible text；无文本时提示切换视觉模型。
- 屏幕内容作为 latest user message 的不可信数据注入，不提升为 system instruction。
- 发送前按 capture ID readback；缺失或过期的 record 不静默变成空上下文。
- 编辑、重新生成与 reload 必须保留 capture 引用和 screenshot file part。

## 代码落点

```text
apps/desktop/src/main/screen-awareness/
  capture-store.ts
  context-injection.ts
  helper-bridge.ts
  index.ts
  lifecycle.ts
  routing.ts

apps/desktop/src/renderer/lib/chat/
  screen-awareness-capture.ts
  screen-awareness-store.ts

apps/desktop/src/renderer/components/chat/
  screen-awareness-chip.tsx
  screen-awareness-preview.tsx

packages/rpc/src/schemas/
  screen-awareness.ts

native/screen-awareness-macos/
  Package.swift
  Sources/EtyonScreenAwareness/
  Sources/EtyonScreenAwarenessApp/
```

现有修改点：

- `packages/rpc/src/schemas/chat-sessions.ts`：新增 mention kind。
- `packages/rpc/src/schemas/settings.ts`：新增 Screen Awareness 设置与 onboarding 状态；权限状态不持久化为真值。
- `apps/desktop/src/main/agents/agent-chat-context.ts`：解析 capture record 并注入用户级上下文。
- `apps/desktop/src/renderer/components/chat/prompt-input.tsx`：暂存和移除 capture。
- `apps/desktop/src/renderer/routes/chat.$sessionId.tsx`：发送、排队、编辑、重新生成和 session routing。
- `apps/desktop/src/main/menu.ts`：原生菜单入口。
- `apps/desktop/src/main/window.ts`：capture 完成后再聚焦主窗口。
- `apps/desktop/forge.config.ts`：嵌入、签名并打包 helper `.app`。

## 设置

建议 settings shape：

```ts
interface ScreenAwarenessSettings {
  enabled: boolean
  onboardingCompletedAt: string | null
}
```

不保存 `accessibilityGranted` 或 `screenRecordingGranted`；这两项每次从系统回读。

设置页展示：

- Screen Awareness 开关。
- 固定快捷键：左右 Command。
- Accessibility 实时状态与 `Open Settings`。
- Screen Recording 实时状态与 `Open Settings`。
- `Run permission setup again`。
- 本地隐私说明和清理未发送 capture 的入口。

## 安全与隐私

- 只有用户双 Command、`@` action 或菜单命令才触发 capture。
- 不做后台连续截图或录屏。
- 不采集系统音频。
- 不自动操作 System Settings 或代用户打开开关。
- 不记录 screenshot 或 accessible text 到日志。
- prompt injection 防护：捕获内容始终是用户级不可信数据。
- 默认拒绝 Etyon、密码管理器、登录 / 支付 / 系统安全表面；后续以可审计策略扩展。
- capture preview 明确展示将发送的来源和内容类型。
- 用户移除 staged capture 后，它不得进入模型请求或持久化消息。

## 打包与发布

Screen Awareness 的完成条件包含正式包，不以开发态运行成功代替：

- helper `.app` 使用稳定 bundle ID。
- 主 App 与 helper 使用同一 Developer ID team 签名。
- helper 嵌入最终 `.app` 后完成 nested code signing。
- 主 App 完成 notarization。
- 权限窗口展示的授权主体名称与 System Settings 列表一致。
- 开发包、未签名包和正式包的 TCC 结果分别验证。
- helper 更新后权限仍保持；签名或 bundle identity 变化时明确提示重新授权。

当前 `doc/packaging.md` 记录 release 产物未签名，因此 code signing / notarization 是本能力的发布 gate，而不是可延期优化。

## 实施阶段

### Phase 1：签名 helper 与权限闭环

- Swift helper `.app` 骨架与 IPC 握手。
- PermissionFlow 接入。
- 两项权限实时 readback。
- 主权限窗口、System Settings 悬浮引导、drag-to-authorize、relaunch。
- Forge 嵌入与签名配置。

验收：正式签名 helper 能被两项 TCC 正确识别，撤销 / 重授 / 重启状态一致。

### Phase 2：双 Command 与 native capture

- 左右 Command 状态机。
- 前台窗口锁定。
- AX selected / accessible text。
- ScreenCaptureKit 单窗口截图。
- partial / failure 结构化结果。

验收：Etyon 在后台时触发，捕获目标始终是触发前窗口，且一次按住只触发一次。

### Phase 3：Chat 垂直闭环

- capture store 与 attachment 持久化。
- `screenAwareness` mention。
- composer chip / preview / remove。
- session routing、queue、edit、regenerate、reload。
- 用户级不可信上下文注入。

验收：模型实际收到的 screenshot / text 与 preview 一致；移除后完全不发送。

### Phase 4：发布硬化

- orphan capture 回收。
- 多屏、Spaces、睡眠唤醒、event tap 恢复。
- helper 崩溃与 IPC 重连。
- 敏感 App / secure field 策略。
- signed DMG / ZIP、notarization 与正式 bundle readback。

## 验收矩阵

- App：Safari、Mail、Slack、Notes、VS Code、Terminal、Preview PDF。
- 内容：选中文本、无选区、长页面、图片、Canvas、密码输入框。
- 窗口：遮挡、全屏、多显示器、不同 Space、窗口在触发后立即关闭。
- Etyon：前台、后台、隐藏、最小化、未启动、请求处理中。
- 权限：全部缺失、单项允许、全部允许、撤销、重新允许、需要重启。
- 生命周期：睡眠唤醒、helper 崩溃、helper 更新、主 App 更新。
- Chat：新 session、最近 session、连续 capture、queued capture、编辑、重新生成、重启恢复。
- 模型：视觉、非视觉、provider 失败、attachment 缺失。
- 隐私：日志无正文 / 图片、secure field 脱敏、staged remove 后无模型输入。

## 完成定义

只有同时满足以下条件，才可以称为 Etyon 已具备 Screen Awareness：

1. 正式签名 macOS 包能稳定获得并回读两项权限。
2. Etyon 在后台时，左右 Command 能可靠锁定并捕获原前台窗口。
3. 截图与可访问文本按真实结果暂存到 composer。
4. 用户发送前可预览和移除，移除后模型与持久化都读不到该 capture。
5. 视觉 / 非视觉模型按能力获得正确上下文。
6. 权限撤销、helper 重启、睡眠唤醒和正式包升级都有可验证降级与恢复。
7. `vp check`、相关单元 / 集成测试、原生 helper 测试和签名产物实机 E2E 均通过。
