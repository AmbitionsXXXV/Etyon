# 预置工具：按需 Skills 与共享 Tasks

本次迭代参考 [Why Claude Code Dropped Todos and Slash Commands](https://tonylee.im/en/blog/why-claude-code-dropped-todos-slash-commands/) 的设计方向：简单工作直接执行，复杂工作才使用持久状态和协作工具。结合 [Claude 官方 Skills 文档](https://code.claude.com/docs/en/skills)，斜杠入口继续作为用户快捷方式，技能正文按需加载。

## 模型可见接口

默认 toolset 移除 `todo_write`，增加 `task_create`、`task_get`、`task_update`、`task_list` 和 `skill`。旧聊天的 `todo_write` 记录仍可回放。取消“约三步必须先写 TODO”“只能一个任务进行中”“批准计划后的第一步必须转 TODO”等提示。依赖、并行负责人或跨轮次进度值得记录时，模型才使用 Tasks。

| Tool | 行为 |
| --- | --- |
| `task_create` | 提供 `subject`，可附 `description`、`activeForm`、`owner`、`blockedBy`。返回稳定 ID、版本及当前任务。 |
| `task_get` | 按 ID 读取任务和最新 `revision`。 |
| `task_update` | 提供 ID、当前 `revision` 及变更字段。状态为 `pending` / `in_progress` / `completed`，依赖数组只替换当前任务的依赖；`owner: null` 可清除负责人。`status: deleted` 删除没有被其他任务依赖的任务记录。 |
| `task_list` | 读取当前聊天的任务、负责人、依赖和版本。 |
| `skill` | `action: list` 按名称和描述发现技能；`action: load` 按目录中的确切 `SKILL.md` 路径加载正文，`reference` 可读取该技能目录内的引用文件。支持分页。 |

## 共享与持久化边界

任务按绝对 project path + chat session ID 隔离，存入 Etyon 配置目录的 `agent-tasks/<scope-hash>.json`。同一聊天的新轮次、标准 `delegate` 子 agent 和应用重启后均读取同一状态。不同聊天不共享任务，`workflow` 的只读调查子 agent 保留原有独立工具集。

每次修改重新读取文件，再用同步读改写及临时文件 rename 原子提交，适用于单个 Electron main process 内的并发调用；不支持多个应用进程同时修改同一任务文件。`revision` 校验防止父子 agent 使用旧快照覆盖任务。未知依赖、循环依赖，以及依赖未完成时开始或完成任务均被拒绝，失败不会保存。多个独立任务可以同时进行。每个聊天最多保留 100 个任务。

任务负责人只是协调信息，不自动调度 agent，不代替文件写入冲突检查或审批。状态变化也不执行对应的工作；只有实际验证后才能标记完成。任务删除只清理协调记录，不删除项目文件；被依赖的任务必须先移除依赖引用才能删除。

## Skills 上下文与权限

Agents 启用时，自动匹配只注入技能名称、描述和路径，正文由模型按需加载；用户明确选择的技能仍直接注入现有指令上下文。普通聊天继续使用原有 Skills 注入方式。`maxContextSkills` 限制初始推荐目录，模型可以通过 `skill` 发现更多条目。

工具遵守 Skills 开关、project/global 范围和 `modelVisible`。`disable-model-invocation` 作为 `model-disabled` 的兼容别名，保持 Etyon 既有的正文隐藏语义；`user-invocable` 对应 picker 的 `visible`，不改变模型可见性。工具仅接受发现目录中的技能路径，引用文件必须在该技能的真实目录内；路径越界、symlink 越界、secret-like 文件、二进制和超过 1 MB 的文件均拒绝。引用文件按字符分页，读取脚本不会执行脚本。

加载 Skills 不会注册扩展、不扩大 toolset、不自动批准 shell/network/写入动作。现有 profile、plan mode 和审批规则继续生效。

## 展示与验证

任务变化继续通过 `data-todo` 更新当前进度，界面显示负责人和未完成的前置任务名称。新记录从工具输出中的快照回放；旧 TODO 从输入回放。失败的任务更新保留为工具错误，不覆盖最后成功的快照。展示快照不会重复发送给模型：本轮使用 `toModelOutput` 去掉 `todos`，后续轮次在历史转换前也去掉，仍保留任务详情和计数。

定向测试覆盖持久化恢复、聊天/项目隔离、父子共享、并行更新、版本冲突、依赖阻塞/解锁/环路、失败不落盘、Skills 按需加载、引用文件分页与安全边界、进度快照回放和旧记录兼容。

2026-09-30 本地验证：13 个相关测试文件、132 项测试通过；全项目 `vp run typecheck`、`vp check` 和差异空白检查通过。未进行运行中桌面界面的实机验收。

PR 提交前，在仅包含本次暂存内容的临时目录中复验：132 项测试、全项目类型检查、本次改动范围的 `vp check` 和差异检查通过。临时目录的全项目 `vp check` 仍报告 `main` 已有的两处屏幕感知 `utf8` 写法（`helper.ts` 的第 88、224 行）；这些基线问题未纳入本次提交。
