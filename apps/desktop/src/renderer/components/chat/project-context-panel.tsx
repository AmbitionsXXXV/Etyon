import { useI18n } from "@etyon/i18n/react"
import type {
  GitProjectDiffOutput,
  ChatSessionSummary,
  GitStatusFile,
  ProjectSnapshotItem
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Chip, Tabs, TextArea } from "@heroui/react"
import { ArrowReloadHorizontalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { FileDiffMetadata } from "@pierre/diffs"
import { FileDiff, Virtualizer } from "@pierre/diffs/react"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { CSSProperties, Key, ReactNode } from "react"

import {
  buildProjectGitStatusSummary,
  buildProjectTreeGitStatusEntries,
  buildProjectTreePaths,
  formatProjectDiffCount,
  getProjectDiffFileStats,
  getProjectDiffSummary,
  parseProjectDiffFiles
} from "@/renderer/lib/chat/project-context-panel"

const PROJECT_DIFF_UNSAFE_CSS = `
  [data-line-type='change-addition'] {
    background-color: color-mix(in oklch, var(--success) 14%, transparent);
  }

  [data-line-type='change-deletion'] {
    background-color: color-mix(in oklch, var(--danger) 14%, transparent);
  }

  [data-gutter] [data-line-type='change-addition'] {
    color: var(--success);
  }

  [data-gutter] [data-line-type='change-deletion'] {
    color: var(--danger);
  }
`
const DIFF_RENDER_OPTIONS = {
  collapsedContextThreshold: 4,
  diffStyle: "unified",
  hunkSeparators: "line-info-basic",
  lineDiffType: "word",
  overflow: "wrap",
  theme: {
    dark: "pierre-dark",
    light: "pierre-light"
  },
  themeType: "system",
  unsafeCSS: PROJECT_DIFF_UNSAFE_CSS
} as const
const PROJECT_TREE_UNSAFE_CSS = `
  :host {
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 12px;
  }

  button[data-type='item'] {
    border-radius: 8px;
  }

  button[data-type='item'][data-item-contains-git-change='true'] {
    color: var(--project-tree-modified-color);
  }

  button[data-type='item'][data-item-git-status='added'] {
    background: color-mix(in oklch, var(--project-tree-added-color) 12%, transparent);
    color: var(--project-tree-added-color);
  }

  button[data-type='item'][data-item-git-status='deleted'] {
    background: color-mix(in oklch, var(--project-tree-deleted-color) 12%, transparent);
    color: var(--project-tree-deleted-color);
  }

  button[data-type='item'][data-item-git-status='modified'],
  button[data-type='item'][data-item-git-status='renamed'] {
    color: var(--project-tree-modified-color);
  }

  button[data-type='item'][data-item-git-status='untracked'] {
    color: var(--project-tree-untracked-color);
  }
`
const PROJECT_TREE_STYLE = {
  "--project-tree-added-color": "var(--success)",
  "--project-tree-deleted-color": "var(--danger)",
  "--project-tree-modified-color": "var(--warning)",
  "--project-tree-untracked-color": "var(--muted-foreground)",
  "--trees-bg-override": "transparent",
  "--trees-border-color-override": "transparent",
  "--trees-fg-override": "currentColor",
  height: "100%"
} as CSSProperties
export const PROJECT_CONTEXT_FILES_TAB_ID = "files"
export const PROJECT_CONTEXT_CHANGES_TAB_ID = "changes"
export const PROJECT_CONTEXT_COMMIT_TAB_ID = "commit"
export type ProjectContextPanelView =
  | typeof PROJECT_CONTEXT_FILES_TAB_ID
  | typeof PROJECT_CONTEXT_CHANGES_TAB_ID
  | typeof PROJECT_CONTEXT_COMMIT_TAB_ID
const COMMIT_MESSAGE_MAX_LENGTH = 500
const PROJECT_STATUS_CHIP_COLORS = {
  added: "success",
  deleted: "danger",
  modified: "warning",
  renamed: "accent",
  untracked: "default"
} as const
const PROJECT_STATUS_TEXT_CLASS_NAMES = {
  added: "text-success",
  deleted: "text-danger",
  modified: "text-warning",
  renamed: "text-accent",
  untracked: "text-muted-foreground"
} as const
const PROJECT_STATUS_LABEL_KEYS = {
  added: "chat.projectPanel.statusAdded",
  deleted: "chat.projectPanel.statusDeleted",
  modified: "chat.projectPanel.statusModified",
  renamed: "chat.projectPanel.statusRenamed",
  untracked: "chat.projectPanel.statusUntracked"
} as const
type ProjectVisibleGitStatusFile = Omit<GitStatusFile, "status"> & {
  status: Exclude<GitStatusFile["status"], "ignored">
}

const isVisibleGitStatusFile = (
  file: GitStatusFile
): file is ProjectVisibleGitStatusFile => file.status !== "ignored"

const isProjectContextPanelView = (
  view: Key
): view is ProjectContextPanelView =>
  view === PROJECT_CONTEXT_FILES_TAB_ID ||
  view === PROJECT_CONTEXT_CHANGES_TAB_ID ||
  view === PROJECT_CONTEXT_COMMIT_TAB_ID

const ProjectFileTree = ({
  gitStatusFiles,
  label,
  paths
}: {
  gitStatusFiles: NonNullable<ChatSessionSummary["gitStatus"]>["files"]
  label: string
  paths: string[]
}) => {
  const gitStatusEntries = useMemo(
    () => buildProjectTreeGitStatusEntries(gitStatusFiles),
    [gitStatusFiles]
  )
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    gitStatus: gitStatusEntries,
    initialExpansion: 1,
    paths,
    search: true,
    unsafeCSS: PROJECT_TREE_UNSAFE_CSS
  })

  useEffect(() => {
    model.resetPaths(paths)
  }, [model, paths])

  useEffect(() => {
    model.setGitStatus(gitStatusEntries)
  }, [gitStatusEntries, model])

  return (
    <FileTree
      aria-label={label}
      className="block h-full min-h-0 text-muted-foreground"
      model={model}
      style={PROJECT_TREE_STYLE}
    />
  )
}

const ProjectPanelStatusStrip = ({
  diffSummary,
  gitStatusSummaryItems,
  selectedModelValue,
  snapshotId
}: {
  diffSummary: ReturnType<typeof getProjectDiffSummary>
  gitStatusSummaryItems: ReturnType<typeof buildProjectGitStatusSummary>
  selectedModelValue: string
  snapshotId?: string
}) => {
  const { t } = useI18n()

  return (
    <div className="shrink-0 border-b border-border px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip size="sm" variant="soft">
          <Chip.Label>
            {selectedModelValue || t("chat.model.emptyDescription")}
          </Chip.Label>
        </Chip>
        {snapshotId ? (
          <Chip size="sm" variant="soft">
            <Chip.Label>
              {t("chat.snapshot.ready", {
                snapshotId
              })}
            </Chip.Label>
          </Chip>
        ) : null}
        {gitStatusSummaryItems.map((item) => (
          <Chip
            color={PROJECT_STATUS_CHIP_COLORS[item.status]}
            key={item.status}
            size="sm"
            title={`${t(PROJECT_STATUS_LABEL_KEYS[item.status])}: ${item.count}`}
            variant="soft"
          >
            <Chip.Label className="tabular-nums">
              {item.prefix}
              {item.count}
            </Chip.Label>
          </Chip>
        ))}
      </div>

      {diffSummary.changedFileCount > 0 ? (
        <div className="mt-3 flex min-w-0 items-center gap-2 text-sm font-semibold tabular-nums">
          <span className="truncate text-muted-foreground">
            {t("chat.projectPanel.filesChanged", {
              count: formatProjectDiffCount(diffSummary.changedFileCount)
            })}
          </span>
          <span className="text-success">
            +{formatProjectDiffCount(diffSummary.additions)}
          </span>
          <span className="text-danger">
            -{formatProjectDiffCount(diffSummary.deletions)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

const ProjectFilesPanel = ({
  gitStatusFiles,
  isTreeLoading,
  label,
  paths
}: {
  gitStatusFiles: NonNullable<ChatSessionSummary["gitStatus"]>["files"]
  isTreeLoading: boolean
  label: string
  paths: string[]
}) => {
  const { t } = useI18n()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        {paths.length > 0 ? (
          <ProjectFileTree
            gitStatusFiles={gitStatusFiles}
            label={label}
            paths={paths}
          />
        ) : (
          <div className="flex h-full min-h-48 items-center justify-center px-4 text-center text-xs leading-5 text-muted-foreground">
            {isTreeLoading
              ? t("chat.projectPanel.loading")
              : t("chat.projectPanel.emptyFiles")}
          </div>
        )}
      </div>
    </div>
  )
}

const ProjectChangesPanel = ({
  diffFiles,
  emptyDiffMessage,
  gitDiff,
  isDiffLoading,
  renderDiffHeaderMetadata
}: {
  diffFiles: FileDiffMetadata[]
  emptyDiffMessage: string
  gitDiff?: GitProjectDiffOutput
  isDiffLoading: boolean
  renderDiffHeaderMetadata: (fileDiff: FileDiffMetadata) => ReactNode
}) => {
  const { t } = useI18n()

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {t("chat.projectPanel.diffTitle")}
        </span>
        {gitDiff?.truncated ? (
          <span className="text-[11px] text-warning">
            {t("chat.projectPanel.truncated")}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {diffFiles.length > 0 ? (
          <Virtualizer className="h-full" contentClassName="space-y-3 p-3">
            {diffFiles.map((fileDiff, index) => (
              <FileDiff
                className="overflow-hidden rounded-xl border border-border/70 text-[11px]"
                fileDiff={fileDiff}
                key={`${fileDiff.name}-${fileDiff.prevName ?? ""}-${index}`}
                options={DIFF_RENDER_OPTIONS}
                renderHeaderMetadata={renderDiffHeaderMetadata}
              />
            ))}
          </Virtualizer>
        ) : (
          <div
            className={cn(
              "flex h-full min-h-36 items-center justify-center px-4 text-center text-xs leading-5 text-muted-foreground",
              isDiffLoading && "animate-pulse"
            )}
          >
            {emptyDiffMessage}
          </div>
        )}
      </div>
    </div>
  )
}

const ProjectCommitPanel = ({
  changedFiles,
  commitMessage,
  diffSummary,
  onCommitMessageChange
}: {
  changedFiles: ProjectVisibleGitStatusFile[]
  commitMessage: string
  diffSummary: ReturnType<typeof getProjectDiffSummary>
  onCommitMessageChange: (value: string) => void
}) => {
  const { t } = useI18n()
  const hasChangedFiles = changedFiles.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {t("chat.projectPanel.commitTitle")}
        </span>
        {diffSummary.changedFileCount > 0 ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold tabular-nums">
            <span className="truncate text-muted-foreground">
              {t("chat.projectPanel.filesChanged", {
                count: formatProjectDiffCount(diffSummary.changedFileCount)
              })}
            </span>
            <span className="text-success">
              +{formatProjectDiffCount(diffSummary.additions)}
            </span>
            <span className="text-danger">
              -{formatProjectDiffCount(diffSummary.deletions)}
            </span>
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-border px-3 py-3">
          <p className="text-xs font-semibold text-muted-foreground">
            {t("chat.projectPanel.commitFilesTitle")}
          </p>
          {hasChangedFiles ? (
            <ul className="mt-2 divide-y divide-border/70">
              {changedFiles.map((file) => (
                <li
                  className="flex min-h-9 items-center justify-between gap-3 py-2 text-xs"
                  key={`${file.status}-${file.path}`}
                >
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      PROJECT_STATUS_TEXT_CLASS_NAMES[file.status]
                    )}
                  >
                    {file.path}
                  </span>
                  <Chip
                    color={PROJECT_STATUS_CHIP_COLORS[file.status]}
                    size="sm"
                    variant="soft"
                  >
                    <Chip.Label>
                      {t(PROJECT_STATUS_LABEL_KEYS[file.status])}
                    </Chip.Label>
                  </Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("chat.projectPanel.commitNoChanges")}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <label
          className="mb-2 block text-xs font-semibold text-muted-foreground"
          htmlFor="project-commit-message"
        >
          {t("chat.projectPanel.commitMessageLabel")}
        </label>
        <TextArea
          aria-label={t("chat.projectPanel.commitMessageLabel")}
          className="min-h-28 text-sm"
          fullWidth
          id="project-commit-message"
          maxLength={COMMIT_MESSAGE_MAX_LENGTH}
          onChange={(event) => onCommitMessageChange(event.target.value)}
          placeholder={t("chat.projectPanel.commitMessagePlaceholder")}
          rows={5}
          value={commitMessage}
          variant="secondary"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {commitMessage.length} / {COMMIT_MESSAGE_MAX_LENGTH}
          </span>
          <Button isDisabled size="sm" type="button">
            {t("chat.projectPanel.commitAction")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export const ProjectContextPanel = ({
  gitDiff,
  isDiffLoading,
  isTreeLoading,
  onRefresh,
  onViewChange,
  projectItems,
  selectedModelValue,
  selectedSession,
  selectedView,
  snapshotId
}: {
  gitDiff?: GitProjectDiffOutput
  isDiffLoading: boolean
  isTreeLoading: boolean
  onRefresh: () => void
  onViewChange: (view: ProjectContextPanelView) => void
  projectItems: ProjectSnapshotItem[]
  selectedModelValue: string
  selectedSession: ChatSessionSummary
  selectedView: ProjectContextPanelView
  snapshotId?: string
}) => {
  const { t } = useI18n()
  const { gitStatus } = selectedSession
  const gitStatusSummaryItems = useMemo(
    () => buildProjectGitStatusSummary(gitStatus),
    [gitStatus]
  )
  const paths = useMemo(
    () => buildProjectTreePaths(projectItems),
    [projectItems]
  )
  const diffFiles = useMemo(
    () => parseProjectDiffFiles(gitDiff?.patch ?? ""),
    [gitDiff?.patch]
  )
  const diffSummary = useMemo(
    () =>
      getProjectDiffSummary({
        diffFiles,
        fallbackChangedFileCount: gitStatus?.changedFileCount ?? 0
      }),
    [diffFiles, gitStatus?.changedFileCount]
  )
  const [commitMessage, setCommitMessage] = useState("")
  const changedFiles = useMemo(
    () =>
      (gitStatus?.files ?? [])
        .filter(isVisibleGitStatusFile)
        .toSorted((left, right) => left.path.localeCompare(right.path)),
    [gitStatus?.files]
  )
  const hasGitChanges = Boolean(gitStatus?.changedFileCount)
  const emptyDiffMessage = (() => {
    if (isDiffLoading) {
      return t("chat.projectPanel.loading")
    }

    if (hasGitChanges) {
      return t("chat.projectPanel.emptyTrackedDiff")
    }

    return t("chat.projectPanel.emptyDiff")
  })()
  const renderDiffHeaderMetadata = useCallback((fileDiff: FileDiffMetadata) => {
    const stats = getProjectDiffFileStats(fileDiff)

    return (
      <span className="flex items-center gap-2 text-[11px] leading-none font-semibold tabular-nums">
        <span className="text-success">
          +{formatProjectDiffCount(stats.additions)}
        </span>
        <span className="text-danger">
          -{formatProjectDiffCount(stats.deletions)}
        </span>
      </span>
    )
  }, [])
  const handleViewChange = useCallback(
    (view: Key) => {
      if (isProjectContextPanelView(view)) {
        onViewChange(view)
      }
    },
    [onViewChange]
  )

  return (
    <aside className="flex h-full min-h-0 min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <Tabs
        className="flex h-full min-h-0 w-full flex-col"
        onSelectionChange={handleViewChange}
        selectedKey={selectedView}
        variant="secondary"
      >
        <div className="title-bar-drag flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <Tabs.ListContainer className="title-bar-no-drag min-w-0 flex-1">
            <Tabs.List
              aria-label={t("chat.projectPanel.viewsLabel")}
              className="w-full justify-start gap-1 *:h-8 *:min-w-0 *:px-2 *:text-xs *:text-foreground *:hover:text-foreground *:data-[selected=true]:text-accent *:data-[selected=true]:hover:text-accent"
            >
              <Tabs.Tab id={PROJECT_CONTEXT_FILES_TAB_ID}>
                {t("chat.projectPanel.filesView")}
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id={PROJECT_CONTEXT_CHANGES_TAB_ID}>
                {t("chat.projectPanel.changesView")}
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id={PROJECT_CONTEXT_COMMIT_TAB_ID}>
                {t("chat.projectPanel.commitView")}
                {diffSummary.changedFileCount > 0 ? (
                  <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground tabular-nums">
                    {formatProjectDiffCount(diffSummary.changedFileCount)}
                  </span>
                ) : null}
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Button
            aria-label={t("chat.projectPanel.refresh")}
            className="title-bar-no-drag"
            isIconOnly
            onPress={onRefresh}
            size="sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon
              icon={ArrowReloadHorizontalIcon}
              size={15}
              strokeWidth={2}
            />
          </Button>
        </div>

        <ProjectPanelStatusStrip
          diffSummary={diffSummary}
          gitStatusSummaryItems={gitStatusSummaryItems}
          selectedModelValue={selectedModelValue}
          snapshotId={snapshotId}
        />

        <Tabs.Panel
          className="min-h-0 flex-1 overflow-hidden"
          id={PROJECT_CONTEXT_FILES_TAB_ID}
        >
          <ProjectFilesPanel
            gitStatusFiles={gitStatus?.files ?? []}
            isTreeLoading={isTreeLoading}
            label={t("chat.projectPanel.filesTitle")}
            paths={paths}
          />
        </Tabs.Panel>

        <Tabs.Panel
          className="min-h-0 flex-1 overflow-hidden"
          id={PROJECT_CONTEXT_CHANGES_TAB_ID}
        >
          <ProjectChangesPanel
            diffFiles={diffFiles}
            emptyDiffMessage={emptyDiffMessage}
            gitDiff={gitDiff}
            isDiffLoading={isDiffLoading}
            renderDiffHeaderMetadata={renderDiffHeaderMetadata}
          />
        </Tabs.Panel>

        <Tabs.Panel
          className="min-h-0 flex-1 overflow-hidden"
          id={PROJECT_CONTEXT_COMMIT_TAB_ID}
        >
          <ProjectCommitPanel
            changedFiles={changedFiles}
            commitMessage={commitMessage}
            diffSummary={diffSummary}
            onCommitMessageChange={setCommitMessage}
          />
        </Tabs.Panel>
      </Tabs>
    </aside>
  )
}
