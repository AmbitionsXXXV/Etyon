# PR 合并卡片

agent 调用 `pull_request` 工具后，聊天时间线在正文下方内联渲染一张 PR 合并卡片：提交图、与 base 分支的冲突、检查结果，以及 解决冲突 → 跑测试 → 合并 的流程。交互参照 pitus_ 的录屏（2026-10），设计稿在 Seedance 画布的 "PR merge flow" 行。

## 第一版范围

只有 UI 和样例数据。工具返回 `PULL_REQUEST_SAMPLE`（`src/shared/chat/pull-request.ts`），不读 git，也不调 GitHub。卡片里的 Resolve conflicts 与 Merge 按钮只在本地推进状态，计时写在组件常量里。正因为数据是假的，`agent-toolset.ts` 只在 `!app.isPackaged` 时注册这个工具，发布版不会出现。

阶段依次为 `checking → conflicts → resolving → testing → ready → merging → merged`。没有冲突的 PR 从 checking 直接到 ready。实时运行中出现的卡片先播 checking；从历史记录重新打开时直接停在检查结论上（`getInitialPullRequestStage`），刷新页面后状态不保留。

## 代码位置

- `src/shared/chat/pull-request.ts`：工具名、卡片 Zod schema、样例数据
- `src/main/agents/minimal/pull-request-tool.ts`：工具定义，可选 `title` 覆盖样例标题
- `src/renderer/lib/chat/pull-request-card.ts`：阶段规则、提交图连线几何（每行 30px，三条泳道 base/head/side）、冲突逐个清除的阈值
- `src/renderer/components/chat/pull-request-card.tsx`：卡片组件，冲突详情和测试摘要用 HeroUI `Tooltip`
- 时间线接入：`assistant-message-timeline.ts` 把它排除出工具链折叠区，`.tsx` 在正文后渲染
- 文案：`chat.pullRequest.*`，三种语言

## 接真实数据时要补的

提交图来自 `git log --graph`；冲突用 `git merge-tree --write-tree` 检出，不改工作区；PR 状态和检查结果读 `gh pr view --json` / `gh pr checks`；Merge 调 `gh pr merge`。解决冲突交给当前 agent 处理，再用真实阶段替换组件里的计时器，并把阶段持久化，重开会话后能看到真实结果。设计稿里 composer 上方的 `#128 3 conflicts` 状态 chip 也留到这一步，它需要跨组件共享 PR 状态。
