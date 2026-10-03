export const DEFAULT_BEST_OF_N_LABELS = {
  applied: "已采纳",
  apply: "采纳此方案",
  cancel: "取消运行",
  cancelDiscard: "保留方案",
  confirmDiscard: "确认丢弃",
  conflicts: "主工作区已更改这些文件，请处理后重新预览。",
  discard: "丢弃候选方案",
  discardConfirmation: "将删除这些方案的隔离工作区和未采纳改动。",
  discarded: "已丢弃",
  empty: "选择 2–4 个模型，分别完成同一任务，再比较结果。",
  failed: "失败",
  files: "个文件",
  modelLimit: "请选择 2–4 个模型。",
  models: "候选模型",
  noChanges: "没有文件改动",
  pending: "等待开始",
  preview: "预览改动",
  prompt: "任务描述",
  ready: "完成",
  recommendation: "评审建议",
  recommended: "推荐",
  running: "运行中",
  start: "并行生成方案",
  title: "Best-of-N",
  view: "查看方案"
} as const

export type BestOfNPanelLabels = {
  [Key in keyof typeof DEFAULT_BEST_OF_N_LABELS]: string
}

export const DEFAULT_WORKTREE_LABELS = {
  apply: "应用到主工作区",
  confirmDiscard: "确认删除工作区",
  discard: "删除隔离工作区",
  empty: "当前会话没有保留的隔离工作区。",
  files: "个文件",
  orphaned: "运行被中断，改动已保留",
  preview: "预览改动",
  title: "隔离工作区"
} as const

export type WorktreePanelLabels = {
  [Key in keyof typeof DEFAULT_WORKTREE_LABELS]: string
}
