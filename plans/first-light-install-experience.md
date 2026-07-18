# First Light — 安装与首启体验设计稿

对标 Arc（无向导安装）与 Dia（首启动画）。Etyon 的现有条件已经很好：Squirrel 本身无向导、mac 窗口 transparent + liquid glass、`motion` v12 已在依赖、且品牌里已有 LED 点阵语言。本稿定义首启动画「First Light」的完整分镜与接线，附安装资产（loadingGif / DMG）规格。

## 0. 视觉母题：LED 点阵（复用现有资产）

已存在：`apps/desktop/src/renderer/components/chat/dot-matrix-placeholder.tsx`（LED 点阵 canvas，颜色跟随 `color`，reduced-motion 出静帧）与 `apps/desktop/src/renderer/lib/chat/dot-matrix.ts`（`DOT_MATRIX_SPACING_PX` / `DOT_MATRIX_RADIUS_PX` / `getDotMatrixAlpha` 波纹算法）。

First Light 全程使用同一点阵语言，形成闭环叙事：**安装动画里点阵在波动 → 首启时第一颗灯点亮 → 波纹扩散、UI 从点阵中显影 → 之后每个空聊天态里，同一套点阵仍在呼吸**。安装 gif 和 DMG 背景共用此母题。

## 1. 分镜（总长 ~4s，任意输入可跳过）

| Phase | 时间 | 画面 | 动效参数 |
| --- | --- | --- | --- |
| P0 定场 | 0–350ms | Overlay 全屏；下层 App 同步正常挂载但不可见（opacity 0 + inert） | 背景：非 mac 用 `bg-background`；mac liquid glass 激活时（`html[data-liquid-glass]`）用深色玻璃罩（background token @ ~65% alpha），让桌面微透 |
| P1 第一颗灯 | 350–1500ms | 视觉中心 (50%, 42%) 一颗 LED 点亮，带 24px 柔光 | 半径 = 2× `DOT_MATRIX_RADIUS_PX`，颜色 primary/accent token；呼吸两拍：scale 1→1.4→1、alpha 0.5→1→0.65，每拍 550ms，easeInOutSine |
| P2 问候与涟漪 | 1500–2600ms | 以灯为中心，稀疏点阵（2× spacing）波纹式亮起又熄灭；问候语在灯下方 32px 逐字显现 | 波纹 900ms（复用 `getDotMatrixAlpha` 思路）；逐字 stagger 30ms，每字 blur 6→0 / y 4→0 / alpha 0→1，220ms easeOut；问候停留 ~600ms |
| P3 落入 composer | 2600–3200ms | 问候淡出；光点坠向 composer 实际位置，触地泛起两圈涟漪，composer 边框 pulse 一次 | 问候 250ms alpha→0 / y −8px；坠落 450ms cubic-bezier(0.5,0,0.9,0.2)，落点 scale 1→0.8 微收；圆环两圈间隔 90ms 扩至 min(40vw, 480px)，alpha 0.5→0 expo-out；border pulse 300ms |
| P4 显影 | 3200–4000ms | Overlay 溶解，App 显影；光点最后一帧与 composer 内闪烁的文本光标重合——"光点变成了你的光标"，composer 自动 focus | 溶解 400ms（alpha→0 + backdrop-blur 8→0）；显影两档见下 |

P4 显影分两档：

- **v1 简化档**：App 容器整体一次 reveal（alpha 0→1 / scale 0.985→1 / blur 6→0，350ms expo-out）。先跑通。
- **v1.5 打磨档**：按「距落点距离」stagger——composer → 消息区 → sidebar → title bar，每块 350ms、stagger 70ms，不侵入各组件（对少数几个顶层区块容器做 transform）。

问候文案（i18n key `firstLight.greeting`）：zh「你好，我是 Etyon」/ en "Hi, I'm Etyon." / ja「こんにちは、Etyon です」。字体跟 `settings.fontFamily`，text-2xl，`text-foreground`。

## 2. 跳过 · 降级 · 重放

- **跳过**：任意 keydown / pointerdown → 直接进入 P4 的 250ms 压缩版（全部同时 fade in），同样回写 onboardedAt。
- **reduced-motion**：不播分镜，300ms 全 UI fade in + composer focus（镜像 `DotMatrixPlaceholder` 的静帧策略）。
- **重放**：query param 两种取值——`firstRun=1` 正式（播 + 回写）、`firstRun=preview` 预览（播、不回写，供 dev/验收：dev server URL 手动加参数即可）。设置页放「重看开场动画」入口属 v2，本期不做。

## 3. 接线点（真实文件）

1. `packages/rpc/src/schemas/settings.ts`
   - `AppSettingsSchema` 增加 `onboardedAt: z.string().nullable().default(null)`（按字母序插在 `minimizeToTray` 与 `proxy` 之间）；`UpdateSettingsSchema` 增加同名 `.nullable().optional()`。zod default 让存量 settings 文件自动迁移，老用户首次升级后会看到一次动画——可接受且合意（相当于 relaunch 彩蛋）。若不想给老用户播，改为在 main 首次读取时若 store 文件已存在则直接补写 onboardedAt（实现者二选一，默认选"播"）。
2. `apps/desktop/src/main/window.ts` — `createWindow()` 内：`getSettings()` 已可用，`onboardedAt` 为空时 `loadRenderer(window, { firstRun: "1" })`，否则维持现状。仅 main window；settings window 不传。
3. `apps/desktop/src/renderer/index.tsx` — 已有 `params` 解析（`window=settings` 同通道），读 `firstRun` → `"off" | "play" | "preview"`，传入 `RendererRoot`；非 settings 窗口时以 `<FirstLightGate mode={…}><App /></FirstLightGate>` 包裹 content。
4. 新文件（遵循 renderer 模块组织约定）：
   - `apps/desktop/src/renderer/components/first-light/first-light-overlay.tsx` — 组件与编排（motion v12）。
   - `apps/desktop/src/renderer/lib/first-light/timeline.ts` — 时序常量、每 phase 的参数表、距离排序等纯函数（node-testable，不 import rpc/window 全局）。
   - 点阵波纹若需泛化，把纯函数提升为共享 lib，不改 `lib/chat/dot-matrix.ts` 的现有 API。
5. 回写：P4 开始时 fire-and-forget 调用 `rpcClient.settings.update({ onboardedAt: new Date().toISOString() })`（`settings.update` rpc 已存在，`src/main/rpc/router.ts:555`）。播到一半退出 → 下次仍会看到；完整看过或跳过 → 不再出现。preview 模式不调用。
6. `apps/desktop/src/renderer/components/chat/prompt-input.tsx` — composer 根容器加 `data-first-light-anchor` 属性（零逻辑）。overlay 运行时 `getBoundingClientRect` 取落点，取不到 fallback (50%, 78%)。
7. `packages/i18n/locales/*` — `firstLight.greeting` 三语言。

## 4. 配套安装资产（同一母题）

- **Windows loadingGif**：640×360，深底 + 点阵波纹 + wordmark，~2.2s 无缝循环。gif 只有 256 色，深底能压住色带；素材可直接从 First Light P1–P2 录屏转制。配置：`forge.config.ts` → `new MakerSquirrel({ loadingGif: "resources/install-loading.gif", setupIcon: "resources/icon.ico" })`。体感链路变成：双击 Setup → 品牌点阵动画数秒 → 应用自启（带 `--squirrel-firstrun`）→ First Light。零向导，即 Arc 体感。
- **macOS DMG 背景**：660×420 提供 @1x/@2x，左侧 wordmark + 点阵，右侧指向 Applications 的视觉引导。`MakerDMG` 增加 `background`、`contents`（app 图标 ~(180,220)，`/Applications` link ~(480,220)）、`additionalDMGOptions.window.size`。
- **Linux**（deb/rpm）无安装 UI，First Light 即全部体验。

## 5. 实施切分

- **PR1（核心）**：schema 字段 + window.ts 传参 + FirstLightGate/overlay（P4 用简化档）+ i18n + composer anchor。验收：`firstRun=preview` 播放全片；跳过、reduced-motion、二次启动不播、settings 窗口不受影响；liquid glass 激活/未激活两种状态各验一次。
- **PR2（打磨）**：分区 stagger 显影、光标重合帧、涟漪细节。
- **PR3（资产）**：loadingGif + DMG 背景 + forge 配置（需先产出静态设计稿）。
- 每个 PR：`vp check` + `vp test`；真机验收按 dev-driving 流程启动（forge binary + CDP）。

## 6. 风险与注意

- mac transparent 窗口上，玻璃罩在 liquid glass 激活/未激活两种状态下观感差异大，两种都要调。
- App 在下层挂载期间的数据加载（sessions 等）正好被动画遮蔽冷启动——加分项；但需确认没有弹窗类 UI（更新提示等）能顶穿 overlay（overlay z-index 置顶 + 下层 inert）。
- Windows `titleBarOverlay` 的系统按钮不受 overlay 遮盖，属可接受（Arc 的安装窗口同样保留系统关闭钮）。

## PR2 细化（2026-07-18 PR1 验收后补充）

1. **首页锚点**：首页（index route）的 New Chat 主按钮加 `data-first-light-anchor`——真实新用户首启落在首页，PR1 里光点只能落 fallback (50%, 78%)。落点是按钮时沿用 border pulse，不做光标帧。
2. **分区显影（v1.5 档）**：给少数顶层区块容器加 `data-first-light-region`（sidebar / header / 主内容或 composer），reveal 时 overlay 查询这些元素，按「区块中心到落点距离」排序，用 WAAPI（`element.animate`）逐块 350ms、stagger 70ms 显影；查询不到任何 region 时回退 PR1 的整体 reveal。动画结束必须清掉 inline transform/filter（同 PR1 的 containing-block 顾虑）。
3. **光标重合帧**：落点元素是 composer（存在 `[contenteditable]` 子元素）时，光点触地后原地渐隐，同一坐标浮现一条 caret 形细线闪烁一拍（~500ms），随 focus 交接消失；落点是按钮/fallback 时跳过此帧。
4. **liquid-glass 改为订阅**：用 MutationObserver 监听 `documentElement` 的 `data-liquid-glass` 属性变化来切换 scrim——PR1 的一次性检测在 dev 里恒为 false（IPC 晚于 overlay 挂载）。
5. **清理**：reveal 开始后即移除 skip 的 keydown/pointerdown 监听（PR1 挂到组件卸载，而 Gate 永不卸载）；border pulse 的圆角改读锚点元素的 computed border-radius（PR1 硬编码 16）。

### PR2 验收记录（2026-07-18）

五项全部落地并真机验证。两个现场发现（均为可接受行为，非缺陷）：

- **窗口被遮挡时 reveal 半冻结、可视即自愈**：遮挡状态下 rAF/WAAPI 时间线冻结而 setTimeout 照走，区域会短暂停在预隐藏态（inline `opacity: 0` + 1 个存活动画）；窗口一到前台，动画在 ~420ms 内完成并清空 inline 样式（实测两次自愈）。真实首启由安装器前台拉起，影响可忽略；"遮挡时整体暂停时间线"列入延伸。
- **冷加载的 chat 路由上 caret 帧可能静默降级**：descent（t≈2.6s）时 tiptap 若尚未挂载 contenteditable，`isComposerAnchor` 为 false，落点效果回退为 border pulse——符合设计的优雅降级；编辑器就绪后的检测已实测为 true。
- liquid-glass scrim 分支在 dev 里仍无法触发（`data-liquid-glass` 始终未置位），MutationObserver 订阅已就位，留待打包版验证（并入 PR3 验收清单）。

### PR3 验收记录（2026-07-18）

- **资产**：两件均为程序化生成（HTML/canvas 渲染 + 截图管线），复用 `dot-matrix.ts` 的常量与波纹公式、品牌色取自真机像素采样（背景 `#25283a`、primary `#81a1f2`、wordmark `#c2caf2`）、wordmark 用首页同款 Iowan Old Style 栈。
  - `resources/install-loading.gif`：640×360、28 帧 × 50ms、无限循环、630KB。波纹速度改为 2π/1400 使周期恰为 28 帧——循环缝合处帧间差（0.445）与普通相邻帧（~0.45）一致，数学无缝；shimmer 只保留空间项（其时间项公共周期 ~21s 会破坏循环）。
  - `resources/dmg-background.tiff`：660×420 @1x/@2x 双分辨率（`tiffutil -cathidpicheck` 合成，appdmg 的 retina 正规路径）；点阵场 + 图标位光环（圆心即 contents 坐标 (180,220)/(480,220)）+ 点阵语言的引导箭头。
- **验证**：真实 `electron-forge make` 产出的 DMG 挂载后确认 `.background/dmg-background.tiff` 原样进包、app + /Applications 链接就位；probe 直调 `createDMG` 打印的 spec 确认 window 660×420 / icon-size 100 / contents 坐标全部生效。
- **坑（记录）**：`make --targets @electron-forge/maker-dmg` 会因 forge 按 `maker.name === target` 匹配（MakerDMG 的 name 是 `"dmg"`）而**静默 fallback 到空配置默认 maker**（exit 0、默认背景）。要么不传 `--targets`，要么用短名 `--targets dmg`。
- **待办**：Windows Squirrel 的 loadingGif 真实安装体验需在 Windows 构建机上验证；liquid-glass scrim 分支同样待打包版。

## 延伸（不在本期）

每次冷启动的 400ms 微版本（光点一闪落入 composer 光标），做成可关的设置项——形成品牌记忆，待 First Light 上线后按反馈决定。
