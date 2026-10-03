# Patch 验收与发布

本轮继续验收 `852b3ef` 的完整功能范围，完成后发布下一个 patch。本轮开始时根包与桌面端版本为 `0.1.8`；首次计划为 `0.1.9`，CI 兼容性修复后的最终目标为 `0.1.10`。原工作区已有的依赖升级、编辑器配置、旧 changelog 和素材改动保持独立；发布代码使用 `/private/tmp/etyon-patch-acceptance-20261003/` 的干净副本。

## 实机环境

复用 `/private/tmp/etyon-feature-qa-20261003/` 内的独立 home、Electron 数据目录、SQLite 和 Git 项目。模型只使用本机 Chat Completions fixture 与 dummy key；工具执行、审批、页面、文件、数据库和 Electron renderer 均为实际链路。未导入真人浏览器 cookie，未连接真人搜索账户或发送 Telegram。

## 本轮发现与修复

实际批准 Bash 改写 `checkpoint-qa.txt` 后，SQLite 已保存带 Git snapshot 的 checkpoint，命令卡片却未出现恢复入口。原因是命令专用卡片没有传递恢复按钮，聊天结束也未使 checkpoint 查询失效。

修复命令卡片 footer 接线，并在聊天流结束时刷新 checkpoint 列表（包括工具审批造成的流分段）。新增真实 DOM 回归验证从空快照列表到新增 Bash 快照的按钮出现与恢复请求，修复前失败，修复后相关 3 个文件 / 23 项测试通过。修复已在独立副本重新打包。

Best-of-N 两个候选初次运行均被私有路径保护拒绝，因为受管 Worktree 位于 app-config 内。受管运行时现在为每个候选创建独立、只覆盖自身 canonical 项目根的文件工具权限；普通项目、其他 Worktree、管理记录、设置及跳出项目的符号链接继续受保护。新增临时文件系统回归在修复前失败，修复后相关 4 个文件 / 49 项通过。实际两个候选的读取、审批、写入、预览与单方案采纳已复验。

网页设置页原先把可预期的私网 / DNS 拒绝与缺少搜索凭据隐藏成 `Internal server error`。抓取与搜索 RPC 现在保留具体失败原因，以可序列化的 `BAD_REQUEST` 返回。新增真实 MessagePort 回归在原实现中失败，修复后相关 5 个文件 / 76 项通过；实际设置页已读回两种拒绝原因。网络地址、重定向、Host / SNI 和请求预算策略未改动。

## 验收进度

| 项目 | 当前结果 |
| --- | --- |
| 主窗口与设置窗口 | 实际显示、聊天加载、设置导航通过；上轮 Provider 初始化空白未重现 |
| 未知结果核对 | 人工选择未完成后提示消失；原记录落库为 failed，核对时 fixture 模型请求为 0，不重放原操作 |
| 浏览器 | 完成 8 次逐次审批；Selenium 官方表单实际导航、读取、输入、复选框切换、滚动、Tab 和最终读取通过；表单未提交 |
| Bash 快照恢复 | 审批后实际写入；预览只列出 checkpoint-qa.txt；恢复 1 个文件至原内容，SQLite 新增恢复前安全快照，未跟踪文件保留 |
| 屏幕感知 | 用户确认两项系统权限并完成 Touch ID；设置页及活跃 helper 均为 granted。受控 TextEdit 的截图、选中文本、可访问文本同时成功；截图 / 文本分别部分成功反馈、多份暂存、独立移除、revision 递增、会话归属及真实发送通过；实体左右 Command 检查依用户决定暂缓（用户报告与 Codex 快捷键冲突），不作为本次发布阻断项 |
| Worktree / Best-of-N | 两个模型分别完成隔离读取与写入审批；采纳前主文件保持 baseline；预览唯一目标文件后采纳 A，主文件实际为 candidate A QA change，无关文件保留 |
| 后台任务 | UI 新建手动任务、保存、运行成功、完整流结果读回；第二次运行 suspended 时禁用编辑 / 重跑，取消后 automation 为 cancelled、确切工具审批为 denied、目标文件未写入；两种通知及定时计划均关闭 |
| MCP | UI 创建本机 stdio 测试服务，真实连接、发现 add 工具、断开与停用通过；调用 / 预算 / 凭据边界由本轮真实 wire 回归覆盖 |
| 网页工具 | 实际 UI / RPC / HTTPS / 解析返回公共 IP 文本端点结果与来源；私网与保留 DNS 目标拒绝通过，缺少搜索 Key 时入口禁用。真实搜索账户未验证 |
| 长任务 / Hooks | 本轮全量包含实际子进程、故障注入、执行账本、防重放、隔离 worker、预算 / 分页及退出生命周期回归；不据此声称付费模型或真人外部服务已验收 |
| Native helper | 独立副本 10 项 Swift 测试通过 |
| 打包 | 干净 lockfile 安装成功；三处修复均已在 release 配置 make 中成功构建，验收时版本仍为 0.1.8 |

## 最终门禁

干净发布副本的全量 typecheck、格式 / lint 检查均通过；186 个测试文件 / 1,552 项测试全部通过。原生 helper 10 项通过；三处新增回归均先在原实现中失败，再在修复后通过。

产品版本同步目标为 `0.1.10`，发布记录见 [v0.1.10](https://github.com/AmbitionsXXXV/Etyon/releases/tag/v0.1.10)。

## CI 入口兼容性修复

`v0.1.9` 的首轮 CI 在原生 prePackage 阶段失败：Swift 将名为 `main.swift` 的文件按顶层入口处理，与同文件的 `@main` 声明冲突。该 tag 已推送，保留为失败发布尝试，未生成 GitHub Release。

入口文件改名为 `screen-awareness-main.swift`，文件内容及运行行为不变。全新 scratch 目录的 release 冷构建成功（8.41 秒），另一个全新目录的 10 项原生测试通过。本地编译器为 Swift 6.4；CI runner 为 macos-26-arm64，发布仍需以 CI 结果和 Release assets 读回作为最终证据。

## 最终发布确认

`v0.1.10` 已于 2026-10-04 00:15:55（JST）发布，非 draft / prerelease；GitHub 的 latest 端点已返回该版本。发布提交为 `a4a509ef7d9878c2b904ac4811851b146fc3ceeb`；[发布 CI](https://github.com/AmbitionsXXXV/Etyon/actions/runs/37132398540) 全部成功。Release 说明已补齐自上一正式版本 `v0.1.8` 以来的完整功能与修复，包含原生冷构建兼容性修复。

| 线上文件 | 字节数 | GitHub SHA-256 |
| --- | --: | --- |
| Etyon-0.1.10-arm64.dmg | 140724288 | aca6be2c7a7b4f352c9378d074fd101361d3d5dd8158cdf65f18571c2bc947e3 |
| Etyon-darwin-arm64-0.1.10.zip | 140371181 | c458dfc9c63b6a834806f04a738354b2eec632664d6667fce513c3ee888134a5 |

实际下载线上 ZIP，SHA-256 与 GitHub 摘要一致，ZIP 完整性与 deep / strict codesign 检查通过。解包读回版本 `0.1.10`、arm64 主程序、生产 app / helper identity，以及 ASAR 中的主入口、preload、独立 workflow worker、0015 / 0016 migrations 均通过。本地最终 DMG 的只读镜像校验通过。

原工作区已同步到最终发布代码与 `0.1.10` 产品版本；原有依赖升级、编辑器设置、未发布 changelog 草稿与素材等 11 个无关文件的改动已保留。

## 发布边界

当前系统将普通域名解析为 `198.18.0.0/15` 的 Fake IP 保留地址。网页工具保持拒绝这类地址，不绕过私网保护；实际正常请求使用 `https://8.8.8.8/resolve?name=example.com&type=A` 验证。未修改用户的代理或 DNS 设置。

运行时补充的 Automation QA 空会话属于测试 fixture；主窗口刷新会话列表后已正常打开。电脑操作工具出现缓存 / 点击无响应后，经用户明确选择改用 Electron renderer 调试接口，系统自动化只用于激活受控 TextEdit 窗口。一次来源不匹配的未发送捕获已立即清理，没有发送给模型；此后先核对来源再发送。

验收完成后按 `doc/release.md` 的版本同步、typecheck / check / Vitest、changelog、commit 和 annotated tag 流程发布。需要读回 GitHub Actions 成功与 Release 的 DMG / ZIP assets，不能把本地打包作为已发布。

现有打包流程使用 ad-hoc 签名。Developer ID、notarization / Gatekeeper 与正式签名 helper 的授权升级不在已验证范围；真实付费模型和搜索账户、Telegram 投递也需单独验证。
