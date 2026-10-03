# Workspace Checkpoints

## 当前能力

父 / 子 agent 的 write、edit、bash 在执行前保存 checkpoint。聊天工具记录提供恢复入口；Bash / Git 恢复先展示涉及文件、diff 和 fingerprint，再由用户确认。恢复与该聊天的模型执行共用 session lease；重复或并发应用不能绕过这一互斥。

## 保存与恢复

- 文件正文按 SHA-256 寻址、gzip 保存，manifest 在 SQLite agent_checkpoints；默认保留 14 天、每项目 512 MB。
- write / edit 保存目标文件的 pre-image；大于 5 MB 的文件保留 hash / mode 与 overCap，缺失 blob 会在恢复反馈中显示。
- Git 项目 bash 使用不改变工作树、索引或 refs 的快照。干净工作树使用当前 HEAD，因而第一次命令前也能恢复。非 Git shell 没有可应用的 Git 快照，不展示可恢复承诺。
- Bash preview 读取实际变化路径与二进制 diff，并把当前状态纳入 fingerprint。确认时主进程重新核对，预览之后的手工改动会拒绝这次恢复。
- 恢复前必须成功保存当前状态的安全快照。备份失败时禁止继续覆盖；失败反馈包含恢复 / 跳过 / 缺失内容，不能把部分恢复报告为全部成功。
- 文件恢复保留已有文本工具的内容版本保护边界；任意外部 shell / 进程并不受进程内锁控制，不能承诺跨进程 exactly-once 或文件事务。

## 用户入口与保留

消息中的对应 write / edit / bash 工具记录可打开恢复确认。Bash 未能取得 Git snapshot、内容已过期或没有可预览改动时禁用恢复，并给出说明。Agent 设置中的 Checkpoints 控件保存 maxAgeDays（1–365）和 maxTotalMb（16–8192）；启动与设置更新均应用保留策略。成功捕获后后台清理超龄 / 超容量 manifests，再删除无引用 blob。

存储位置为 app-config/checkpoints/<projectHash>/objects。未发布版本包含 0015 invocation 和 0016 automation 的 schema migration；checkpoint 仍复用原有表。

## 验证

临时 Git / 文件回归覆盖干净 HEAD、Bash 导致的 tracked / untracked 改动、恢复 preview 后的手工修改、保存安全快照失败、遗漏 blob、回退路径以及原有文件版本检查。真实 Electron 中的审批、Bash 变更、预览与确认恢复记录见 feature 完成验收文档。测试不以真实用户项目作恢复对象。
