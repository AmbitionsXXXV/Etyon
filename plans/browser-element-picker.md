# Plan: Browser Element Picker — 网页元素选取传递给 Composer（Cursor design mode 风格）

> Source: 2026-07-26 用户指令（browser-tab 系列后续）：「参考 cursor 的 design mode 支持选择 web 中的元素，然后传递给 prompt-input」。fable 设计 → opus-5 执行 → fable 验收。分支 feat/element-picker（前置提交 117d98d 为 composer 窄宽修复，互不依赖）。

## 1. 目标与范围

**In scope**

- BrowserPanel 工具栏新增「选取元素」toggle：激活后在内嵌页面上移动高亮元素，点击捕获该元素的结构化信息（selector / outerHTML / 文本 / 样式子集 / 页面 URL）。
- 捕获结果作为**一等 mention chip** 进入 composer（新 `kind: "webElement"`），发送时服务端把它展开为模型上下文（chat 与 agent 两条路径）。
- Esc / 再点 toggle / 页面导航 / 关 browser tab 都能干净取消。

**Out of scope（§7 延伸）**

- 元素截图裁剪附件；多元素批量选取；picked element 的持久高亮/重定位；对 iframe 内部元素的选取（v1 只取主 frame）。

## 2. 现状与证据

- `persist:browser` 分区**无 preload、无 node**（plans/browser-tab.md D2，安全设计不可破）——页面与 renderer 之间没有现成消息通道。可用通道：main 的 `webContents.executeJavaScriptInIsolatedWorld(worldId, [{ code }])`，返回 Promise（脚本返回的 promise 会被 await）；隔离 world 的 JS 变量页面不可见，但 DOM 共享（overlay 页面可见）。
- mention 管线（复用而非另起炉灶）：
  - schema：`packages/rpc/src/schemas/chat-sessions.ts` `ChatMentionSchema = z.discriminatedUnion("kind", [file, folder, skill])`。
  - tiptap：`renderer/lib/chat/project-mention-extension.tsx` 单一 `projectMention` node，attrs = mention 字段 spread，chip 渲染 `span[data-type="projectMention"]`。
  - 序列化：`renderer/lib/chat/prompt-input.ts` `getMentionTextValue`（mention 在消息文本里以 textValue 内嵌，`splitPromptTextByMentions` 按文本位置回配）；`buildPromptEditorJsonFromMessage` 反向重建。
  - 服务端展开：`main/server/routes/chat.ts`（chat 路径）与 `main/agents/agent-chat-context.ts`（agent 路径）按 kind 拼上下文；file/folder 走 project-snapshot 读取，skill 走 skills 解析。
- BrowserPanel 工具栏：`BrowserToolbarButton`（icon-only ghost sm）已有后退/前进/刷新/外开按钮位（browser-panel.tsx:41 一带 + 385 起），toggle 放这一排。
- main 侧 view 生命周期：`withBrowserLease`（防 LRU 驱逐）、`disposeBrowserView`、`subscribeBrowserState` 均在 manager.ts；RPC `browser.*` 有 `assertBrowserRpcAccess`（MessagePort-only + session 校验）。

## 3. Design Decisions

**D1 交互入口。** BrowserPanel 工具栏（后退/前进/刷新一排）加 pick toggle（`CursorPointer01Icon` 或近似 hugeicons 图标，`isSelected` 高亮态）。激活 → 调 `browser.pickElement`；页面内 Esc、再点 toggle、导航、组件卸载都取消。picked 成功后 toggle 自动复位。工具栏按钮 tooltip/aria 用新 i18n key `chat.projectPanel.browserPickElement`。

**D2 页面侧注入（不加 preload）。** main 新增 `main/browser/element-picker.ts`：

- `PICKER_WORLD_ID`（固定 >0 的独立 world id，如 1013）。
- `runElementPick({ sessionId })`：`withBrowserLease` 内 `executeJavaScriptInIsolatedWorld(PICKER_WORLD_ID, [{ code: PICKER_SCRIPT }])`。脚本为 async IIFE，安装：
  - overlay：单个 `position:fixed; pointer-events:none; z-index:2147483647` 高亮框（outline + 半透明填充 + 左上角 tag 标签），`mousemove`（capture）跟随 `elementFromPoint`；`document.documentElement` 上临时 `cursor: crosshair`。
  - `click`（capture, once 语义自管理）：`preventDefault + stopImmediatePropagation`，采集 payload 后 resolve。
  - `keydown` Escape → resolve null。
  - cancel 钩子：`globalThis.__etyonCancelElementPick = () => resolve(null)`（隔离 world，页面不可见）。
  - 无论哪条路径，先移除全部 listener + overlay + cursor 再 resolve（try/finally）。
- main 侧 `Promise.race`：脚本 promise、`did-start-navigation`/`did-navigate`（主 frame）、`destroyed`、120s 超时——后三者触发时先尽力 `executeJavaScriptInIsolatedWorld` 调 cancel 钩子清理，再返回 null。
- `cancelElementPick({ sessionId })`：调 cancel 钩子（幂等，无进行中 pick 则 no-op）。同 session 重复 `runElementPick` 先取消旧的。

**D3 payload 形状**（隔离 world 内采集，全部原始值可 JSON 化）：

```ts
interface PickedWebElement {
  classes: string[] // 最多前 5 个
  id: string | null
  innerText: string // slice(0, 300)
  outerHtml: string // slice(0, 4000)
  rect: { height: number; width: number; x: number; y: number }
  selector: string // id 短路，否则 nth-of-type 路径（≤5 层）
  styles: Record<string, string> // color/backgroundColor/fontSize/fontFamily/fontWeight/display/position/padding/margin/borderRadius
  tagName: string // 小写
  title: string // document.title
  url: string // location.href
}
```

**D4 RPC。** `packages/rpc/src/schemas/browser.ts` 加 `PickedWebElementSchema` + pick 输入输出；router `browser` 组加：

- `browser.pickElement({ sessionId })` → `{ element: PickedWebElement | null }`（长挂起直至点击/取消，复用 `assertBrowserRpcAccess`）。
- `browser.cancelElementPick({ sessionId })` → `{ ok: true }`。

**D5 composer 注入 = 新 mention kind。**

- `ChatMentionSchema` 加分支：`{ kind: "webElement", label, selector, url, title, tagName, innerText, outerHtml, styles }`（label = `tag#id.firstClass` 截断 ~40 字符，renderer 生成；rect 不进 mention——只在 pick 结果里，暂无消费者）。
- tiptap 复用现 `projectMention` node（attrs 已是任意 mention spread）：chip 按 kind 分支渲染 icon（web 元素用 Globe/Cursor 图标）+ label；`getMentionTextValue` 加 `webElement → label` 分支；`splitPromptTextByMentions`/`buildPromptEditorJsonFromMessage` 因走统一 textValue 机制自然兼容（验收确认往返）。
- **BrowserPanel → composer 通路**：新 `renderer/lib/chat/web-element-capture.ts`（module-level 订阅 store，仿 project-panel-navigation.ts：`publishPickedWebElement(payload)` / `usePickedWebElement` 或 subscribe+consume）。PromptInput 侧订阅：收到 → `editor.chain().focus().insertContent([mention node attrs, 空格]).run()` + 清 store。不 import rpc/window（node 可测）。
- 服务端展开（两条路径同步加）：`chat.ts` 与 `agent-chat-context.ts` 的 mentions 处理加 `webElement` 分支，拼块：

  ```
  Selected element from <url> (<title>):
  selector: <selector>
  <outerHtml 截断块>
  innerText: <...>
  styles: <k: v 单行>
  ```

  数据自带，不需要 snapshot 读取；放在 file/folder 展开同级位置。

**D6 不动的东西（负面清单）。** preload 零改动；`persist:browser` 的权限拒绝面、URL 白名单、`HARDENED_WEB_PREFERENCES` 零改动；agent 的 `browser` 工具零改动（picker 是用户侧动作）；mention 既有三 kind 的行为与测试不回归。

## 4. 交互分镜

| 场景 | 行为 |
| --- | --- |
| 点 pick toggle | toggle 高亮；页面出现 crosshair + 悬停高亮框 |
| hover 元素 | 高亮框跟随 + tag 标签（如 `div.card`） |
| 点击元素 | 页面链接/按钮不触发；overlay 清理；composer 出现 chip（如 `h1#hero`）+ 尾随空格，输入框聚焦；toggle 复位 |
| Esc | 清理并复位，无 chip |
| pick 中导航/刷新页面 | 自动取消并复位 |
| pick 中关 browser tab / 折叠面板关闭 view | RPC 拒绝或取消路径返回 null，toggle 复位（组件卸载 cleanup 调 cancel） |
| 发送含 chip 的消息 | 消息文本含 label，mentions 携带完整 payload；模型上下文出现元素块（chat 与 agent 模式都生效） |
| 队列编辑含 chip 的消息 | chip 往返重建（buildPromptEditorJsonFromMessage 分支自然覆盖） |

## 5. 接线点

1. `apps/desktop/src/main/browser/element-picker.ts`（新）— D2/D3：PICKER_SCRIPT + runElementPick/cancelElementPick。selector/payload 采集逻辑如可抽为纯函数字符串常量则不强求单测（脚本以字符串注入）。
2. `packages/rpc/src/schemas/browser.ts` + `chat-sessions.ts` + `index.ts` — D3/D4/D5 schema。
3. `apps/desktop/src/main/rpc/router.ts` — browser.pickElement/cancelElementPick（复用 assertBrowserRpcAccess）。
4. `apps/desktop/src/renderer/components/chat/browser-panel.tsx` — pick toggle + RPC 调用 + 成功后 `publishPickedWebElement`；unmount/再点 cancel。
5. `apps/desktop/src/renderer/lib/chat/web-element-capture.ts`（新）+ 单测 — 订阅 store。
6. `apps/desktop/src/renderer/lib/chat/prompt-input.ts` / `project-mention-extension.tsx` / `components/chat/prompt-input.tsx` — mention 分支（textValue/图标/chip 渲染/编辑器订阅插入）。
7. `apps/desktop/src/main/server/routes/chat.ts` + `apps/desktop/src/main/agents/agent-chat-context.ts` — webElement 上下文展开。
8. `packages/i18n/*/translation.json` — `browserPickElement`（+ 需要的话 pick 中状态文案）。
9. 测试：schema parse（webElement 往返）、web-element-capture store、`getMentionTextValue`/`splitPromptTextByMentions` webElement 分支、agent-chat-context 展开块（有先例测试则跟随）。

## 6. 验收（单 PR）

`vp check` + `turbo run typecheck` + `vp test run` 全绿后，真机（main 改动 → 全量 relaunch + CDP）：

- example.com 上 pick `h1`：悬停高亮、点击不跳转、chip `h1` 入 composer、toggle 复位。
- 发送「这个元素的文字是什么」→ 回答引用 "Example Domain"（chat 模式）；agent 模式同问一次（上下文块两路径都生效）。
- Esc 取消、pick 中点刷新取消、关 tab 后 toggle 不残留。
- 队列编辑往返 chip 不丢。
- 安全面回归：`persist:browser` 无新增 preload/权限；页面 console 里 `window.__etyonCancelElementPick` 不可见（隔离 world）。

落地后：本文追加验收记录；doc/browser.md 补「元素选取」一节（AGENTS.md 文档规则）。

## 7. 延伸（不在本期）

- 元素区域截图（capturePage + rect 裁剪 → attachments）随 chip 附带；iframe 深选；多选集合；picked 元素在页面上的持久标记与「重新定位」；Cursor 式样式编辑回写。

### PR7 验收记录 (2026-07-27)

**分工**：fable 设计（本文）→ opus-5 后台实现（接线点 1-9）→ fable diff review + 独立复跑 + 全量 relaunch 真机走查。

**静态审查**：全部 diff 对照 D1-D6 通过。实现偏差 5 处均核实接受，其中两处修正了本文的过时证据：① `chat.ts` 不加展开分支——实测 chat.ts:208 将 mentions 交给 `prepareAgentChatContext`，chat 与 agent 两条路径共用这一个调用，单点实现即覆盖双路径（§2 证据段有误，双写会导致上下文重复）；② tiptap 会**静默丢弃未声明的 node attrs**——`ProjectMentionExtension.addAttributes` 现在全量声明所有 kind 的字段，否则 webElement payload 在编辑器往返中被剥空（关键正确性抓手）。其余：`innerText` 字段名与 `unicorn/prefer-dom-node-text-content` 冲突，用 eslint-disable 注释钉住防 `--fix` 误改；`getMentionTokenTypeLabel` 签名放宽（union `Pick` 在成员缺字段时收窄）；仅拦 `click` 不拦 `mousedown`（mousedown 驱动的页面组件仍会响应，记为已知限制）；pushState 同文档导航也会取消（`did-start-navigation` 不区分，SPA 上略激进）。加固点：`runElementPick` 返回值经 `PickedWebElementSchema.safeParse` 再交 renderer；superseded pick 有 `activePicks` 同一性守卫防止旧 pick 清理新 pick。检查复跑：`vp check` 628/506 全绿，`turbo run typecheck` 3/3，`vp test run` 143 文件 1157 通过（+10：schema 往返、capture store、mention 分支、agent-chat-context 展开块）。

**真机走查**（main 改动 → 清场全量 relaunch + CDP :9230；页面侧直连 example.com 的 CDP target 驱动）：

1. **选取主链路**：toggle 激活 → 页面 overlay + crosshair 注入；hover `h1` 高亮框跟随、badge 显示 `h1`；click `defaultPrevented`（不触发页面导航）；overlay/cursor 即时清理；composer 出现 chip（CursorPointer icon 徽章 + "h1" + 尾随空格）；toggle 自动复位 ✓。
2. **隔离性（安全面）**：pick 进行中，页面主 world `typeof window.__etyonCancelElementPick === 'undefined'` ✓；`git diff` 证实 preload / `HARDENED_WEB_PREFERENCES` / url-policy / persist:browser 权限面零改动 ✓。
3. **上下文展开**：发送「这个选中的元素的文字内容是什么？只回答文字本身。」→ 模型回答精确为 "Example Domain"（chat 模式实测；agent 模式经同一 `prepareAgentChatContext`，另有 `buildWebElementMentionSystemPrompt` 单测）✓。
4. **取消路径**：Esc → overlay 清理、toggle 复位、无多余 chip ✓；pick 中点刷新 → 自动取消复位 ✓；pick 中关 browser tab → 页面零残留（overlay/hook 均无）、重开 tab 后 toggle 不残留且页面恢复 `https://example.com` ✓。
5. **往返**：队列编辑 chip 重建由单测覆盖（`createWebElementMentionFromAttrs` 往返 + textValue 切分）；**已发送消息的 edit 是气泡内联纯文本编辑**（`handleStartEditMessage` 只取 `getMessageText`），file/skill mention 在该路径同样只剩纯文本——预先存在的设计，非本 PR 回归。

**已知限制**（随代码/文档记录）：仅拦截 `click`（mousedown 驱动的组件可能仍响应）；SPA 同文档导航取消略激进；v1 不支持 iframe 内元素与元素截图（§7 延伸）。
