# Plan: Chat UI Motion — 动效与过渡交互统一打磨

> Source: 2026-07-27 用户指令：「优化整个 chat ui 的 animation 和过渡交互」。fable 设计 → opus-5 执行 → fable 验收。分支 feat/chat-ui-motion。

## 1. 现状与证据

- 动效基建极薄：chat 组件里只有零散 `transition-colors` 类 hover 过渡；`motion@12`（motion/react）已在依赖中，但 chat 侧仅 composer-plan-hint 与 prompt-input 两处使用。大交互时刻（面板开合、tab 切换、launcher 出现、消息/工具行进入、审批卡出现、strip 加减 tab、浮动 rail）全部瞬时跳变。
- 已有可对齐的参照：`SETTINGS_PAGE_EASE_CURVE = [0.25, 0.1, 0.25, 1]`（settings/首页在用，配 y:14 / 0.32s 的进入）；composer-plan-hint 的 `PLAN_HINT_MOTION` 模式（常量对象 + motion.div）。
- Work section（Working/Worked 折叠）与工具 trace 行都走 HeroUI `Disclosure`；面板 tab 内容是 `Tabs.Panel`（非活动卸载）；右面板宽度由 `Resizable` 管理；BrowserPanel 的页面是**原生 WebContentsView**，bounds 由 effect 同步。
- `getChatStreamdownAnimation` 已管流式文本动画（用户可配置）；First Light onboarding 有自己的 WAAPI 序列。
- DESIGN.md 无 motion 章节（仅一句「非交互内容不加 hover/transition」）。

## 2. Motion 语言（D1，本次立法）

**气质：克制、快、单向**（Linear/Codex 风格）。动效只解释「什么变了、从哪来」，不表演。三条硬规则：

1. **时长 ≤ 240ms、位移 ≤ 12px、无 bounce/overshoot**（spring 只用高阻尼）。
2. **热路径只动 transform/opacity**（流式期间的元素不做 layout 动画）。
3. **一次性进入动画只在「新出现」时播**——历史回放、session 切换重挂载、面板重开不重播（用 ref 守卫或 `initial={false}`）。

**Tokens**（新 `apps/desktop/src/renderer/lib/motion.ts`，首页/设置的既有参数向它对齐）：

```ts
export const MOTION_EASE = [0.25, 0.1, 0.25, 1] as const  // 沿用现 curve
export const MOTION_DURATION = {
  fast: 0.12,      // hover/press 色彩、图标交换
  base: 0.18,      // fade / 小位移进入
  gentle: 0.24,    // 折叠展开、面板内容编排
  entrance: 0.32   // 一次性大进入（对齐 settings/home 现值）
} as const
export const MOTION_RISE_PX = 8       // 进入位移统一 8px（大场景 12）
export const MOTION_FADE_IN = { ... } // 常用预设：fadeIn / riseIn / scaleIn(0.97→1)
```

CSS 侧同值以 Tailwind 任意值书写（`duration-[180ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]`），不引入新依赖。

**Reduced motion**：root 挂 `<MotionConfig reducedMotion="user">`（motion 路径自动降级）；CSS 路径统一带 `motion-reduce:transition-none motion-reduce:animate-none`。

## 3. 分场景处理（D2-D5）

### D2 消息时间线

| 时刻 | 处理 |
| --- | --- |
| 新消息进入（live 期间 append） | fade + rise 8px，`base`；**只对新增消息**：mount 时已有的历史消息 `initial={false}`（守卫：记录首帧已存在的 message id 集合） |
| 流式文本 | **不加新动画**（streamdown 设置已管；不双重动画，不做逐 token 位移） |
| Work section 折叠/展开 | HeroUI Disclosure：确认/补齐高度动画至 `gentle` + 内容 fade；Working→Worked 状态标签文字交换 fade `fast` |
| 工具 trace 行逐条出现 | 每行 fade + rise 4px，`base`；行内状态徽标（running→done/failed）只做颜色过渡 `fast`，不闪不跳 |
| 审批卡出现 | 重点时刻：fade + rise 8px + scale 0.97→1，`gentle`（时间线里唯一允许 scale 的进入） |
| 审批卡被批准/拒绝后 | 卡片内容切换 fade `base`，无高度弹跳（外层高度变化交给布局自然过渡，不做动画） |
| 消息 actions 行 | 现 hover 显隐补 `fast` opacity 过渡（高度已预留，无 layout 动） |
| scroll-to-bottom 按钮 | AnimatePresence：fade + scale 0.9→1 进入、反向退出，`base`；点击后的滚动保持现 smooth |
| artifact / browser 截图卡片 | 图片加载完成 fade-in `base`（避免突然撑开：容器已有固定比例的不动，无比例的不做） |

### D3 右侧面板

| 时刻 | 处理 |
| --- | --- |
| 面板展开/收起 | **宽度不做动画**（Resizable 布局 + WebContentsView bounds 同步，动画会让原生页面撕裂/漂移——硬约束）；用内容编排掩护：展开时面板内容整体 fade + 从右 slide 12px，`gentle`；收起瞬时 |
| Launcher 空态 | 标题 + 五项 stagger 进入（每项延迟 30ms，fade + rise 8px，`base`）；仅首次出现播（面板保持开着切 session 不重播可接受，守卫从简） |
| Tab 切换（Tabs.Panel） | 新面板内容 fade-in `base`（纯 opacity；terminal/browser 挂载即开始，不等 ready） |
| Strip 加 tab | 新 chip fade + scale 0.9→1，`base`（CSS animate-in 即可，Tabs.Tab 不包 motion） |
| Strip 关 tab | v1 不做退出编排（兄弟 chip 瞬时补位，Chrome 同款可接受）；记入已知取舍 |
| 浮动 rail（折叠态） | 整条 fade + 从右 slide 8px 进入/退出，`base`；badge 数字变化 scale 脉冲一次（0.9→1，`fast`） |
| refresh/折叠钮 hover | 既有 `transition-colors` 统一到 `fast` |

### D4 Composer

| 时刻 | 处理 |
| --- | --- |
| 队列项添加/移除 | motion list + AnimatePresence：进入 fade+rise 4px、移除 fade+collapse（高度 `gentle`，队列不在流式热路径，可做高度） |
| 附件 chip | 进入 fade + scale 0.9→1 `base`；移除 fade `fast` |
| 模式 pill（Chat/Agent/Plan）与权限 pill | 文字/图标交换：旧出新进 crossfade `fast`（保持现有 pulse 反馈，不叠加位移） |
| Send ↔ Stop 按钮 | 图标 crossfade + scale 0.92→1，`fast` |
| webElement/mention chip 插入 | 进入 fade + scale 0.95→1，`base` |
| 工具栏换行（窄宽） | 不做动画（罕见路径，动画反而暴露 reflow） |

### D5 全局细节

- Sidebar 会话行：新会话进入 fade + rise；置顶/重排**不做** FLIP（v1 取舍，避免列表大范围 layout 动画）。
- HeroUI Dialog/Popover/Menu/Tooltip：保留内建动画，不另加。
- Home 页与 First Light：**零改动**（已有自己的语言/序列）。
- 所有新动画必须可被打断（motion 默认可中断；CSS 只用短时长）。

## 4. 不动的东西（负面清单）

`streamdown-settings` 语义与实现；First Light WAAPI；xterm/terminal 内部；WebContentsView bounds 与 Resizable 拖拽；HeroUI 内建 overlay 动画；`src/main//preload/packages/rpc` 零改动（纯 renderer PR）。

## 5. 接线点

1. `apps/desktop/src/renderer/lib/motion.ts`（新）— tokens + 常用 motion 预设 + `useOnceGuard`（一次性进入守卫，node 可测的纯逻辑部分拆出）；首页/设置的 `SETTINGS_PAGE_EASE_CURVE` 引用迁到此（保留旧常量 re-export 或全仓改引用，选其一并一致）。
2. `assistant-message-timeline.tsx`（+ `work-entries.tsx`、`message-tool-trace.tsx`）— D2 全部时刻。
3. `chat.$sessionId.tsx` — scroll-to-bottom 按钮、浮动 rail、面板内容编排的 isOpen 接线。
4. `project-context-panel.tsx` — launcher stagger、tab 内容 fade、chip 进入。
5. `prompt-input.tsx`（+ composer 相关子组件）— D4 全部时刻。
6. `app-sidebar.tsx` — 新会话行进入。
7. `DESIGN.md` — 新增「Motion」章节（气质三硬规则 + tokens 表 + 何时不动画）。
8. 测试：`lib/motion` 纯逻辑（tokens 形状、once-guard）单测；组件动画不做快照测试（脆），行为由真机验收。

## 6. 验收（单 PR）

`vp check` + `turbo run typecheck` + `vp test run` 全绿后，真机（纯 renderer → reload 即可）：

- 逐场景走查 D2-D5 表格（发消息看新消息/工具行/审批卡进入；开合面板看内容编排与 rail；launcher stagger；tab 增删；队列/附件/模式 pill；scroll 按钮）。
- **不重播守卫**：刷新页面/切 session 后历史消息与已有 UI 不播进入动画。
- **流式性能**：长回复流式期间无逐 token 布局抖动（肉眼 + 若可行 CDP tracing 抽查主线程）。
- **Reduced motion**：CDP `Emulation.setEmulatedMedia` 模拟 `prefers-reduced-motion: reduce` → 全部动画降级为瞬时。
- DESIGN.md Motion 章节落地；手感终验由用户确认（动效是主观件，预留一轮微调）。

## 7. 延伸（不在本期）

Strip 关 tab 的兄弟补位 FLIP；sidebar 重排 FLIP；面板宽度弹性动画（需先解决原生 view bounds 同步节流）；tool trace 行的骨架 shimmer；成功/失败时刻的触觉级微反馈（图标 draw-on 等）。

### PR9 验收记录 (2026-07-27)

**分工**：fable 设计 → opus-5 实现（接线点 1-8）→ fable diff review + 机械验证；**手感终验留给用户**（见文末）。

**静态审查**：diff 对照 D2-D5 表逐格通过。两处未按字面实现均核实正确：① 截图卡片 fade-in——表格自带的限定词「无固定比例的不做」命中（两处容器都无比例，加淡入会与撑开同帧）；② 队列项移除动画——HeroUI `Queue.Item` 自持 `<li>` 且 reorder 态下换成 `Reorder.Item` 并丢弃未知 props，`AnimatePresence` 无法接管卸载（进入动画落在内层包裹上，退出记入取舍）。约束执行到位：browser tab 激活时面板编排自动换纯 fade 变体（不给原生 view 祖先加 transform），`Tabs.Panel` fade 也排除 browser；`MOTION_DURATION.entrance`(0.32) 只作为 Home/Settings 既有值的文档化存在，chat 预算内未使用；diff 内自查无 >240ms、无 >12px、无 spring。`useEntranceGuard` 的实现细节值得记录：render 期收集 entering ids（首帧即带动画）、StrictMode 双渲染去重、240ms 遗忘窗口（防 CSS 进入类在 `display:none` 祖先复显时重播）。检查复跑：`vp check` 639/514 全绿，`turbo run typecheck` 3/3，`vp test run` 147 文件 1197 通过（+10 motion 单测）。

**机械验证**（真机 CDP，renderer reload）：

1. **不重播守卫**：reload 后历史消息 computed opacity 全 1、全文档零 `animate-in` 节点 ✓；文档中 opacity 0 的元素全部为合法隐藏态（hover 隐藏的 actions 行、折叠的 disclosure）✓。
2. **进入动画装弹**：新开 tab 的 chip 带 CSS 进入类 ✓；launcher/motion 元素挂载即写入 initial 内联样式 ✓。
3. **Reduced motion**：CDP `Emulation.setEmulatedMedia` 模拟 reduce → CSS 进入类 `animation-name: none` ✓；motion 路径按 `reducedMotion="user"` 的**设计行为**只禁 transform（rise/slide/scale 全灭）、保留 opacity 淡入——与本文 §6「全部瞬时」的措辞有出入，但这是 motion 的无障碍安全语义（前庭触发源是位移/缩放而非淡入），**接受为有意行为**。
4. **验证环境限制（如实记录）**：走查期间应用窗口处于隐藏态（`visibilityState: hidden`），Electron 冻结 rAF → motion 动画停在首帧——这是 runbook 已知行为（First Light 同款，窗口可见即自愈），导致**动画完成轨迹无法 headless 断言**（早期一次「launcher 卡 opacity 0」的误报即此假象）。不抢占用户屏幕焦点，完成度与手感交给用户真机确认。

**留给用户的手感清单**：发消息看新消息/工具行/审批卡进入节奏；开合面板看内容编排与 rail；launcher stagger；tab 增开；队列/附件/模式 pill/Send↔Stop；scroll-to-bottom 按钮。任何一处觉得「慢/抢戏/多余」直接点名，微调只动 tokens 或单场景一行。
