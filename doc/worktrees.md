# Worktree 隔离与 Best-of-N

隔离任务从所选项目仓库的**当前 HEAD** 创建 detached Git Worktree。未提交的主工作区改动不复制给候选任务。项目为仓库内子目录时，子 Agent 的工作目录对应隔离树内同一个子目录；没有 HEAD 的非 Git 项目会明确拒绝隔离执行。

隔离树存于应用配置目录的 `worktrees/<uuid>/`，所有权记录存于 `.records/`。记录包含原项目、仓库根、基础 commit、会话和 run。读、预览、应用及清理入口需要核对会话所有权。清理还核对 Git 注册路径与共同 Git 目录，不对任意输入路径运行递归删除。

任务结束后没有改动的隔离树自动移除；有改动的树保留为 `ready`，在隔离工作区面板查看 Diff。运行中的树不能被 UI 或 RPC 清理；完成后无法预览的变更保留为 `orphaned`，可以由用户明确确认丢弃。预览使用私有 Git index，不改动主工作区或候选 index，并同时包含候选内的新提交、暂存、未暂存及未忽略新文件；支持二进制文件。最多 100 个改动路径、单文件 5 MiB，Git 输出最多 8 MiB。跨项目目录、符号链接、目录目标及 submodule 变更需要人工处理，不自动应用。

## 应用

用户先预览，再显式选择应用。预览 fingerprint 覆盖候选 patch、主工作区 HEAD、被触碰文件的内容 hash、mode、mtime 和隔离树状态。应用时重新生成 fingerprint；主工作区这些路径的既有修改、暂存修改、新文件碰撞，以及预览后的变化都会阻止应用。无关路径的用户修改和 index 保留。

应用先执行 `git apply --check`，把原文件内容和权限写入 `.snapshots/<uuid>/`，再重新核对预览，并执行不修改 index 的 `git apply`。失败时仅恢复可证明由当前 patch 写入的内容；不能证明来源的并发内容保留并列为冲突。返回值包含恢复快照位置。

该步骤不构成跨外部进程的操作系统文件事务。编辑器或任意 shell 可以在最后一次核对之后修改文件；应用失败时保留快照和冲突信息，不对无法确认来源的内容强制回滚。需要处理本地并发时，应先停止写同一文件的任务，再刷新预览。

启动恢复检查未完成的隔离任务：确认无改动后清理；有改动或无法确认状态时保留，不重启候选模型。创建前即保存所有权记录，避免 checkout 后、模型启动前的崩溃产生无法归属的树。缺失目录只清理对应记录和确切的 Git 注册，不全局 prune 用户的其他 Worktree。

## Best-of-N

用户入口选择 2–4 个模型和同一任务。`best_of_n` 工具在独立 Worktree 中并行执行各候选，子工具继续遵循现有权限与审批。候选不继承完整父会话历史；只使用任务与显式上下文。候选摘要、状态和 Worktree ID 持久保存，失败候选的部分改动也保留供核对。

候选结束后，当前会话模型以只读评审身份比较任务、摘要与实际 Diff。完整证据在 512 KiB 内时保存为本 chat 的引用，由 `read_tool_result` 分页读取，避免把多份 Diff 直接塞进当前用户消息；完整摘要也在证据中。超过该限额时保留明确标记的 32,000 字符 patch 样本、原始大小和人工复核要求，不声称分页能读取未保存的剩余 Diff。评审只能推荐现有候选 ID 或不推荐。候选内容作为不可信证据，不作为指令。评审失败不会伪造推荐，用户仍可比较实际 Diff。

Best-of-N 面板展示并排摘要、真实 Diff 统计、状态和推荐理由。聊天时间线把 `best_of_n` 作为独立的多子任务入口，显示所有真实 child run 的 live 行与审批按钮；历史严格按 `parentToolCallId` 读取，不把比较结果当作单个 delegate 的 `childRunId`。只有成功候选且已预览无冲突的 Diff 可以采纳。选择先持久保存 `applying` 状态和 `selectedCandidateId`，再应用文件；同一运行的采纳与丢弃串行互斥，不能因连续点击而应用多个独立方案。采纳成功后删除其余候选的隔离树，并保留历史摘要；清理失败保留路径与错误。用户主动丢弃有确认入口，运行中必须先取消并等待子任务结算。

重启不会自动重放应用。遇到中断的 `applying` 状态，提示核对主文件和恢复快照。取消控制器按存储根共享，聊天工具与 UI RPC 使用不同 Service 实例时也可取消同一活跃任务。

集成 API：`createWorktreeManager` 的 `create/list/get/finish/preview/apply/prune/recover`，以及 `createBestOfNService` 的 `start/list/get/preview/apply/cancel/discard/recover`。`worktree-runtime.ts` 将模型和评审绑定真实 `runDelegatedAgent`、child run 持久化和审批 stream；`buildRuntimeBestOfNTool` 在执行时绑定真实 `parentToolCallId`。候选必须属于父 profile 允许的可写 delegate；General Purpose 默认只允许 Explore，所以需要使用具有可写委派权限的 Coder profile，不能隐式扩大父权限。评审只能选择父 profile 允许的只读 delegate；没有合适的评审时保留人工比较。

实际 child 共用现有并发 slot，候选 claim 的 scope 为独立 child ID，Hook 配置指向原项目，模型使用用户选择的 ID。每个 child 有 10 分钟执行上限和取消信号；退出时请求取消并等待最多 5 秒结算，未确认完成的运行留待启动恢复。状态持久保存后广播 `best-of-n:updated`，追加审计只含 ID、状态和候选状态，不复制 prompt 或 patch。核心和运行时绑定测试在 `/private/tmp/` 的独立仓库内验证，不对 Etyon 工作树做回滚或清理。
