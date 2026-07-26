# Plan: Right Panel Tab Sessions — 右侧面板动态 tab 重构（Codex 风格）

> Source: 2026-07-26 会话，用户提供 Codex 桌面端两张截图作为交互参照。指令要点：①默认无内容时不预置 tab 全量展示，空态用 launcher 触发（截图 1：右侧空区一个纵向列表 Review/Terminal/Browser/Files + 快捷键）；②打开后为动态 tab strip（截图 2：仅显示已打开的 tab + `+` 按钮下拉菜单按需再开）；③内部参考浏览器 tab session 设计——tab 是按需创建的会话实例，不是预置的固定条目。fable 设计 → opus-5 执行 → fable 验收。

## 1. 目标与范围

**In scope**

- 右侧 project-context 面板从「固定 5 tab 常显」重构为「动态 tab sessions」：默认零 tab，空态显示 launcher；打开的 surface 才出现在 tab strip；tab 可关闭；`+` 菜单补开其余 surface。
- Artifact 从「整面板替换 ProjectContextPanel」的 swap hack 升级为一等 tab session（打开 artifact = 开/聚焦一个 artifact tab）。
- 既有五种 surface 不变：Files / Changes / Commit / Terminal / Browser；各 tab 内容组件复用现实现，不动其内部。
- 折叠态浮动工具条随之重构：只反映已打开的 tabs。
- 既有入口全部适配：header Review 按钮、Mod+J、文件 reveal 流、artifact 卡片点击、agent browser 自动聚焦（initiator=agent）。

**Out of scope（§8 延伸）**

- 同 kind 多实例（多 terminal / 多 browser tab）；open tabs 持久化（跨重启/跨 session 记忆）；tab 拖拽排序；新增全局快捷键体系。

## 2. 现状与证据（evidence）

- Tab strip 是 HeroUI `<Tabs>` 固定四项 + Browser（components/chat/project-context-panel.tsx:1616-1724 一带，PR2 后为五项），`Tabs.Panel` 无 `shouldForceMount` → 非活动 panel 卸载；面板折叠只加 `hidden` class 不卸载（chat.$sessionId.tsx:851-853）。TerminalPanel/BrowserPanel 依赖此语义（main 侧状态 + 挂载时 ensure 重同步），重构必须保持「非活动 tab 卸载、折叠不卸载」不变。
- 视图状态：`projectContextView: ChatSidePanelView`（单选中值）+ `activeArtifact` + `isProjectContextOpen`，全部 route `useState`（chat.$sessionId.tsx:2827-2835），per session 重挂载即重置。
- Artifact swap：`selectedView === "artifact" && activeArtifact` 时整面板换成 `ArtifactPanel`（chat.$sessionId.tsx:863-884），`ProjectContextPanel` 完全卸载——这是重构要消灭的特例。
- 折叠态浮动工具条 `PROJECT_CONTEXT_TOOLBAR_ITEMS`（五项常显，chat.$sessionId.tsx:332-353 + :646-689），commit 项带 changes badge。
- 入口/联动：`ProjectContextTrigger`（header Review 按钮，带 diff 摘要）；Mod+J terminal 开合（:1917-1946 一带）;reveal-request 流（lib/chat/project-panel-navigation.ts → files/changes tab + revealTarget 下传）；`onBrowserState` initiator=agent → 切 browser tab（PR3，chat.$sessionId.tsx 订阅者）；session 切换清 artifact 回 files（:3179-3188 一带）。
- BrowserPanel 可见性契约：`isBrowserSurfaceVisible = isProjectContextOpen && selectedView === browser` prop 驱动 `setVisible`（plans/browser-tab.md D4）——重构后该派生必须等价迁移。
- refresh 按钮位于 tab strip 右侧，作用于 files/changes/commit 数据（project-context-panel.tsx:1651-1665）。
- i18n keys `chat.projectPanel.*` 三语齐备；`TranslationKey` 从 en-US 派生。

## 3. Design Decisions

**D1 Tab session 模型：`openTabs` 有序数组 + `activeTabId`，每 kind 至多一个实例。** `lib/chat/side-panel-tabs.ts`（新，纯逻辑）:

```ts
type PanelSurfaceKind =
  "artifact" | "browser" | "changes" | "commit" | "files" | "terminal"
interface ChatPanelTab {
  id: PanelSurfaceKind
  kind: PanelSurfaceKind
} // v1: id === kind（单实例）
interface SidePanelTabsState {
  activeTabId: PanelSurfaceKind | null
  openTabs: ChatPanelTab[]
}
```

纯函数 reducer：`openPanelTab(state, kind)`（已开则仅聚焦，未开则 append 到尾部并聚焦）、`closePanelTab(state, id)`（激活相邻：优先右侧、无则左侧、空则 null）、`focusPanelTab`。id === kind 让「browser/terminal 的 main 侧 per-chat-session 单实例」与 UI 模型一一对应；多实例只需未来把 id 变成 `kind:instanceKey`，reducer 形状不变。 `ChatSidePanelView`/`ProjectContextPanelView` union 与 `isProjectContextPanelView` 被 `PanelSurfaceKind` 取代；`ARTIFACT_PANEL_VIEW_ID` 融入 kind 集合，artifact 的 payload（`ChatArtifactRef`）仍单独存 `activeArtifact` state（tab 只记 kind，内容组件从 state 取 payload——保持现有 toolCallId remount 语义）。

**D2 空态 launcher：面板展开且 `openTabs.length === 0` 时显示。** 居中纵向列表，五项（Files/Changes/Commit/Terminal/Browser），每项：icon + Title Case label + 右对齐快捷键提示（有则显示：Terminal = Mod+J；其余暂无则留白，不造新快捷键）。Changes 项在有改动时带 count badge（复用 diffSummary）。点击 = `openPanelTab(kind)`。视觉对照截图 1：条目为全宽窄行（h-9 左右）、`bg-card/70` 圆角容器或直接透明行 hover `bg-muted`——用 DESIGN.md 语义 token，间距 4/8px 节奏，不加分隔线。Artifact 不进 launcher（入口是聊天里的 artifact 卡片）。

**D3 Tab strip（有 tab 时）：动态条目 + close + `+` 菜单。**

- 保留 HeroUI `<Tabs>` 承载内容与选中态；strip 条目动态映射 `openTabs`。每个 tab：icon + label（artifact tab 的 label = artifact 标题，截断 max-w）+ hover/active 时显示 close `×`。
- **实现注意（React Aria 限制）**：`Tabs.Tab` 内嵌 `<button>` 属交互元素嵌套，React Aria 可能拒绝或产生 a11y 告警。首选方案：close 用带 `role="presentation"` 的 `<span>` 承接 `onPointerDown`（stopPropagation 后调 close）——Codex/VS Code 同款做法；若 HeroUI 实现层面不可行，降级为自定义 strip（ToggleButton 组模拟 Tabs secondary 视觉 + 手动管理 `Tabs.Panel` 渲染），并在验收记录里注明。中键点击关 tab 一并支持（`onAuxClick`）。
- `+` 按钮固定在 strip 尾部：HeroUI Menu，列出**未打开**的 surface（icon + label + 快捷键提示），全部已开时禁用。对照截图 2 的下拉。
- refresh 按钮仅当 activeTab ∈ {files, changes, commit} 时显示（terminal/browser/artifact 各有自己的控制）。
- commit tab 的 changed-count badge 保留在其 strip 条目上。

**D4 挂载与可见性语义：逐字保持现契约。**

- 内容区仍为每个 open tab 一个 `Tabs.Panel`（同款 `mt-0 flex min-h-0 flex-1 overflow-hidden p-0 data-[inert=true]:hidden` className）；非活动卸载、折叠不卸载——不引入 force-mount。
- `TerminalPanel`/`BrowserPanel` 挂载仅当其 tab 在 `openTabs` 里（关闭 tab = 卸载组件；main 侧 pty/WebContentsView 按既有规则存活，重开 tab 走 ensure 重同步——这正是「浏览器 tab session」语义）。
- Browser 可见性派生迁移为：`isBrowserSurfaceVisible = isProjectContextOpen && activeTabId === "browser"`。关闭 browser tab 时组件卸载 cleanup `setVisible(false)` 兜底（PR2 已有）。
- Artifact tab 内容 = 现 `ArtifactPanel` 去掉整面板 swap 后的形态：保留其内部 header（republish/外开等），去掉自身 close 按钮（tab `×` 接管，`onClose` prop 改为可选并不再传）。`key={activeArtifact.toolCallId}` 保留。

**D5 状态归属与入口适配。**

- `openTabs/activeTabId/activeArtifact/isProjectContextOpen` 全部仍是 route `useState`，per session 重置（现状不变；持久化进延伸）。
- 入口映射（全部收敛到 `openPanelTab`）：
  - header Review 按钮：toggle 面板展开/折叠（不再隐含选 files）；展开时若零 tab → launcher 空态。
  - 文件 reveal 流：`openPanelTab("files"|"changes")` + 现有 revealTarget 下传不变。
  - Mod+J：terminal tab 已激活且面板展开 → 折叠面板；否则展开 + `openPanelTab("terminal")`（与现行为等价）。
  - artifact 卡片点击 / 流中 artifact part 自动打开：set `activeArtifact` + `openPanelTab("artifact")`。
  - agent browser 自动聚焦（initiator=agent）：展开 + `openPanelTab("browser")`。
  - session 切换：清 `activeArtifact`、`openTabs` 重置为空（route remount 天然完成）。
- **折叠态浮动工具条**：仅显示 `openTabs` 的 icons（顺序一致，点击 = 展开 + 聚焦该 tab；changes/commit 的 badge 逻辑跟随各自条目）。`openTabs` 为空时整条隐藏（入口回归 header Review 按钮）。`PROJECT_CONTEXT_TOOLBAR_ITEMS` 常量改为 surface 元数据表（icon/labelKey/kind），launcher、`+` 菜单、浮动条三处共用。

**D6 不动的东西（负面清单）。** main 进程零改动；`packages/rpc` 零改动；TerminalPanel/BrowserPanel/各 Project*Panel 内容组件内部零改动（仅挂载处 props 适配）；DESIGN.md tokens/间距/无分隔线原则照旧；Tabs.Panel className 与滚动模式照旧。

## 4. 交互分镜

| 场景 | 行为 |
| --- | --- |
| 新 session 首次展开面板 | 零 tab → launcher 空态（五项列表居中） |
| launcher 点 Terminal | 开 terminal tab（strip 出现首个 tab），内容挂载走 ensure |
| `+` 菜单点 Browser | strip 追加 browser tab 并聚焦；`+` 菜单里 Browser 项消失 |
| 关闭当前 tab（× / 中键） | 移除条目；聚焦右邻，无右邻聚焦左邻；关到零 tab → launcher 空态 |
| 关闭 browser tab | BrowserPanel 卸载（cleanup setVisible(false)），main 侧 view 按 LRU 规则存活；重开恢复当前页面 |
| 折叠面板（有 tabs） | 浮动条显示已开 tabs 的 icons；点击任一 → 展开并聚焦 |
| 折叠面板（零 tab） | 无浮动条；header Review 按钮是唯一入口 |
| 聊天中点文件 chip | 展开 + 开/聚焦 files（或 changes）tab + reveal 滚动定位 |
| 点 artifact 卡片 | 展开 + 开/聚焦 artifact tab（label = artifact 标题） |
| agent 导航 browser（批准后） | 展开 + 开/聚焦 browser tab（initiator=agent 流不变） |
| Mod+J | terminal tab 激活且展开 → 折叠；否则展开 + 开/聚焦 terminal |
| session 切换 | tabs 清零（route remount），回空态 |

## 5. 接线点

1. **`apps/desktop/src/renderer/lib/chat/side-panel-tabs.ts`（新）** — D1 的类型 + reducer 纯函数 + `PANEL_SURFACE_METADATA`（kind → icon/labelKey/badge 类型/快捷键提示 key 的元数据表，浮动条/launcher/`+` 菜单共用）。不 import rpc/window。单测放 apps/desktop/test/renderer/lib/chat/side-panel-tabs.test.ts（open/close/focus 全分支 + 相邻聚焦规则）。
2. **`apps/desktop/src/renderer/lib/chat/project-context-panel.ts` / `artifact-panel.ts`** — 视图 union 收敛到 `PanelSurfaceKind`：删 `ProjectContextPanelView`/`isProjectContextPanelView`/`ARTIFACT_PANEL_VIEW_ID` 的旧用法（保留 artifact srcdoc 工具函数不动），全仓引用点随迁。
3. **`apps/desktop/src/renderer/components/chat/project-context-panel.tsx`** — strip 重构（动态 tabs + close + `+` Menu + 条件 refresh）、空态 launcher 组件、`Tabs.Panel` 按 `openTabs` 动态渲染；props 从 `selectedView/onViewChange` 改为 `activeTabId/openTabs/onOpenTab/onCloseTab/onFocusTab/activeArtifact/isProjectContextOpen`。
4. **`apps/desktop/src/renderer/routes/chat.$sessionId.tsx`** — state 重构（`projectContextView/activeArtifact` → `sidePanelTabs` reducer state + `activeArtifact`）；`ChatProjectContextLayout` 删 artifact swap 分支；折叠浮动条重构（D5）；五个入口适配（Review 按钮/reveal/Mod+J/artifact 打开/agent 聚焦）；`isBrowserSurfaceVisible` 派生迁移。
5. **`apps/desktop/src/renderer/components/chat/artifact-panel.tsx`** — 去 swap 形态：`onClose` 改可选（不再渲染自身 close）,其余不动。
6. **`packages/i18n/src/locales/{en-US,zh-CN,ja-JP}/translation.json`** — 新 keys：`chat.projectPanel.launcherTitle`（如 "Open a panel"）、`chat.projectPanel.openTabMenu`（`+` aria）、`chat.projectPanel.closeTab`（含 {name} 插值）、`chat.projectPanel.artifactView`；沿用既有 `filesView/changesView/commitView/terminalView/browserView` 作 label。
7. **测试适配** — 既有引用 `ProjectContextPanelView` 的测试（browser-tool-ui/其他 renderer 测试）随迁；新增 side-panel-tabs reducer 单测。

## 6. 实施切分

**PR4 — 单 PR 完成重构** 接线点 1-7。验收：`vp check` + `vp test run` + workspace tsc 0 错；真机走查（forge dev + CDP 驱动真实 UI）：

- 空态 launcher 五项可开；`+` 菜单只列未开项、全开禁用；close/中键关 tab、相邻聚焦规则；关到零回 launcher。
- Terminal/Browser 关 tab 再开：内容经 ensure 恢复（terminal 缓冲回放、browser 当前页面保持）。
- Artifact 卡片 → artifact tab（label=标题、republish remount 正常、tab × 关闭）；不再出现整面板 swap。
- 折叠浮动条 = 已开 tabs 镜像；零 tab 无浮动条。
- Mod+J、文件 reveal、agent browser 自动聚焦（真跑一轮 agent navigate 审批）三条入口全通。
- 顺带补 PR3 遗留运行时项：bypass 模式 browser 工具直通无审批卡。
- DESIGN.md 走查：launcher/strip 无 raw hex、间距节奏、Title Case。

落地后在本文追加 `### PR4 验收记录 (YYYY-MM-DD)`；doc/ 侧在 doc/browser.md 或新 doc/side-panel.md 补动态 tab 模型一节（AGENTS.md:179）。

## 7. 风险与注意

1. **Tabs.Tab 内嵌 close 的 a11y/实现限制**（D3 已给首选与降级方案）——降级自定义 strip 时必须保持「非活动 Panel 卸载」语义（手动条件渲染内容）。
2. **动态 Tabs 的 selectedKey 失配**：关闭激活 tab 的瞬间 `selectedKey` 指向已移除 id → 先算好 next active 再一次性 set（reducer 原子完成，组件端不做两段 set）。
3. **BrowserPanel 可见性回归**：`activeTabId` 派生替换 `selectedView` 后，折叠（不卸载）与关 tab（卸载）两条路径都要重验 `setVisible(false)`（PR4 真机清单已含）。
4. **reveal 流时序**：reveal 现在假设 files/changes tab 常在——改为先 `openPanelTab` 后下传 revealTarget，注意首帧挂载后才能滚动定位（现有 revealTarget 机制本就处理挂载后消费，预期兼容，验收确认）。
5. **旧 union 类型的全仓引用**：`ChatSidePanelView` 在 PR2/PR3 里被多处引用（含测试）——tsc 是清障工具，接线点 2 必须一次清干净，禁止留兼容别名。

## 8. 延伸（不在本期）

- 同 kind 多实例（`kind:instanceKey` id + strip 去重规则）；open tabs 按 session 持久化（SQLite settings/session 表）；tab 拖拽排序；launcher/`+` 菜单项的自定义快捷键；浮动条拖拽定位。

### PR4 验收记录 (2026-07-26)

**分工**：fable 设计（本文）→ opus-5 后台实现（接线点 1-7 一次交付）→ fable 逐文件 diff review + 独立复跑检查 + CDP 真机走查。

**静态审查**：全部 diff 对照 D1-D6 逐条核对通过。reducer 与 D1 完全一致（close 的 next-active 与移除原子完成，防 `selectedKey` 悬空——风险 2 已消）；`Tabs.Panel` className 逐字保留（`PANEL_TAB_CONTENT_CLASS_NAME` 常量）；close `×` 走 D3 首选方案（`role="presentation"` span + `onPointerDown` stopPropagation，未触发降级自定义 strip；中键 `onAuxClick` 挂在 `Tabs.Tab` 上）；`+` 菜单 Dropdown 组合与仓内 `composer-plan-queue.tsx` 先例一致；旧 union（`ProjectContextPanelView`/`ChatSidePanelView`/`ARTIFACT_PANEL_VIEW_ID`/`PROJECT_CONTEXT_*_TAB_ID`/`PROJECT_CONTEXT_TOOLBAR_ITEMS`）全仓零残留、零兼容别名；`git status` 确认 `src/main/`、`src/preload/`、`packages/rpc/` 与各内容组件零改动（D6）。检查独立复跑：`vp check` 622 格式 / 501 文件 0 lint，`tsc -p tsconfig.root.json` 0 错，`vp test run` 141 文件 1145 通过（含新增 side-panel-tabs 22 条）。

**实现偏差（3 处，均接受）**：① `isProjectContextOpen` 不下传 panel——`isBrowserSurfaceVisible` 维持 PR2 的派生位置（layout 内）原样迁移，避免双 prop 冗余；② Changes 条目也带 changed-count badge（元数据表单字段统一 launcher/strip/浮动条，加法向，Commit badge 原样保留）；③ launcher 标题 "Open a Panel"（DESIGN.md Title Case）。

**真机走查**（forge dev + CDP :9230，renderer reload 后全程驱动真实 UI）：

1. 空态 launcher：五项 Files / Changes(11) / Commit(11) / Terminal(⌘J) / Browser，语义 token、无分隔线 ✓；点 Terminal 开首个 tab，xterm 挂载 ✓。
2. `+` 菜单：terminal 已开时仅列 Files/Changes/Commit/Browser ✓；点 Browser 追加聚焦，且 main 侧 view 经 ensure 恢复 `https://example.com`（PR3 遗留页面）✓。
3. 关闭规则：关激活尾部 tab → 左邻聚焦；关激活首 tab → 右邻聚焦；中键 `auxclick` 关闭；关到零回 launcher ✓。
4. Tab session 恢复：terminal 写入 `echo PR4MARKER` → 关 tab（xterm 卸载确认）→ 重开，缓冲回放含 marker（经 `terminal.ensure` snapshot 佐证 + 截图确认；注意 xterm canvas 渲染下 `.xterm-rows` 无文本，DOM 断言不可用）✓。
5. 折叠浮动条：仅镜像 openTabs（单 Terminal 图标），点击展开 + 聚焦 ✓；零 tab 折叠无浮动条，Review 按钮为唯一入口 ✓。
6. Mod+J 三态：files 激活时 → 聚焦 terminal；terminal 激活且展开 → 折叠；折叠 → 展开 + 聚焦 terminal ✓（合成 keydown 需派发到 `document.body`，`window` 上派发不触发）。
7. reveal：`requestProjectPanelReveal({path: "package.json", view: "file"})` → files tab 追加 + 聚焦，先开 tab 后消费 revealTarget 的时序成立（风险 4 消）✓。
8. **PR3 遗留补验**：Bypass 模式下 agent `browser` navigate+read 全程零审批卡直通 ✓；agent 自动聚焦：从零 tab 状态自动开 browser tab（`initiator: "agent"`），地址栏 `https://example.com/?pr4` ✓。
9. Artifact 一等 tab：agent 发布 "PR4 Demo" → artifact tab 自动打开并聚焦，label = 标题（截断），iframe 渲染 "Hello PR4"，strip 与状态条保持可见（无整面板 swap）✓；`ArtifactPanel` 头部无自身 close 按钮（`onClose` 未传）✓；tab `×` 关闭后邻位聚焦 ✓。
10. 走查产生的测试残留 `artifacts/pr4.html` 已删除；权限模式/agent 模式已还原（Default / Chat）。

**已知限缩**（实现有意为之，随代码注释记录）：close `×` 无键盘路径（presentation span 方案固有）；关闭 artifact tab 不清 `activeArtifact`（重开需再点卡片，唯一消费者是该 tab，无泄漏）；launcher 无 h-12 标题栏，包裹层补 `title-bar-drag` 保持 macOS 拖窗。启动时 `sidebarWidthPx` 校验报错为 PR1 前既有问题，与本 PR 无关。
