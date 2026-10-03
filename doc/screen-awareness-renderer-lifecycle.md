# 屏幕捕获暂存与恢复

Renderer 的捕获暂存按会话隔离；只有首次捕获尚未分配会话时，才按当前会话 / 最近会话规则选择目的地。已分配的捕获在恢复时找不到原会话，说明会话已删除或归档，此时通过主进程 `dismissScreenAwarenessCapture` 删除源记录并移除暂存，不把原内容迁移到其他会话。

`useScreenAwareness` 的启用条件包含主窗口身份及 `settings.screenAwareness.enabled`。禁用会清空全局捕获列表和会话快照。会话列表、创建会话、分配捕获、恢复列表及刷新查询每次异步完成后，都检查本次 effect 是否已销毁及捕获是否仍在有效期；已禁用的 delivery 不会继续暂存或导航。

`isFreshScreenAwarenessCapture` 同时校验内容类型、来源 / ID、正文边界和捕获时间。非法、空内容、已过期及未来时间均拒绝。暂存和读取都进行校验，读取过期内容不依赖周期计时器；有效的会话快照保持引用稳定，避免 `useSyncExternalStore` 重复渲染。读取时触发的过期通知延后至 microtask，避免在一个组件渲染中同步更新另一组件。

分配会话后的暂存来源为主进程重新读取的 canonical payload。`revision` 缺失按 `0` 处理；同一个捕获 ID 的旧 revision 不能覆盖新版，独立移除图像 / 文本会推进本地 revision，防止延迟恢复或旧 IPC 快照把已移除内容重新加入。

验证文件：

- `screen-awareness-routing.test.ts`：当前 / 最近会话路由及已归档会话恢复的丢弃规则。
- `screen-awareness-capture-store.test.ts`：会话隔离、容量、去重、独立删除、非法时间、读取时过期、禁用清理。
- `use-screen-awareness.test.ts`：每个异步边界上的禁用竞态、恢复列表延迟、过期复查、正常新捕获交付和 orphan 删除。

Main 与 native helper 的启停、队列文件删除及控制命令权限，由主进程和 helper 的生命周期共同保证；renderer 的禁用检查是会话与发送前暂存的防线。

`screen-awareness-helper.test.ts` 和 `screen-awareness-ipc.test.ts` 使用隔离临时 home、fake LaunchServices / `--status-json` 查询与假时钟验证控制队列、权限专用模式、心跳边界、实例参数、禁用 IPC 及退出确认后的文件清理；不启动真实 native 捕获。停止超时保留待核对的 private records，确认退出后可显式清理。
