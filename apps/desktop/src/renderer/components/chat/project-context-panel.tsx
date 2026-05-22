import { useI18n } from "@etyon/i18n/react"
import type {
  ChatSessionSummary,
  GitProjectDiffOutput,
  ProjectSnapshotItem,
  ReadProjectFileOutput
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Resizable } from "@heroui-pro/react"
import { Button, Chip, Spinner, Tabs, TextArea, Tooltip } from "@heroui/react"
import {
  ArrowReloadHorizontalIcon,
  FolderMinusIcon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { FileDiffMetadata } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import type {
  FileTree as FileTreeModel,
  FileTreeDirectoryHandle,
  FileTreeItemHandle
} from "@pierre/trees"
import { FileTree, useFileTree } from "@pierre/trees/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties, Key, ReactNode } from "react"

import { ProjectFileCodeViewer } from "@/renderer/components/chat/project-file-code-viewer"
import {
  buildProjectGitStatusSummary,
  buildProjectTreeDirectoryPaths,
  buildProjectTreeGitStatusEntries,
  buildProjectTreePaths,
  buildVisibleGitStatusFiles,
  formatProjectDiffCount,
  getProjectDiffFileStats,
  getProjectDiffSummary,
  parseProjectDiffFiles
} from "@/renderer/lib/chat/project-context-panel"
import { rpcClient } from "@/renderer/lib/rpc"

const PROJECT_DIFF_UNSAFE_CSS = `
  :host {
    background: transparent;
    color: inherit;
    font-family: inherit;
  }

  [data-code],
  [data-content],
  [data-gutter] {
    background-color: var(--diffs-bg);
  }

  [data-line-type='change-addition'] {
    background-color: var(--diffs-bg-addition-override);
  }

  [data-line-type='change-deletion'] {
    background-color: var(--diffs-bg-deletion-override);
  }

  [data-gutter] [data-line-type='change-addition'] {
    color: var(--diffs-addition-color-override);
  }

  [data-gutter] [data-line-type='change-deletion'] {
    color: var(--diffs-deletion-color-override);
  }
`
const DIFF_RENDER_OPTIONS = {
  collapsedContextThreshold: 4,
  disableFileHeader: true,
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
const PROJECT_DIFF_STYLE = {
  "--diffs-addition-color-override": "var(--success)",
  "--diffs-bg-addition-emphasis-override":
    "color-mix(in oklab, var(--success) 22%, transparent)",
  "--diffs-bg-addition-override":
    "color-mix(in oklab, var(--success) 12%, var(--card))",
  "--diffs-bg-context-gutter-override": "var(--surface-tertiary)",
  "--diffs-bg-context-override": "var(--card)",
  "--diffs-bg-deletion-emphasis-override":
    "color-mix(in oklab, var(--danger) 22%, transparent)",
  "--diffs-bg-deletion-override":
    "color-mix(in oklab, var(--danger) 12%, var(--card))",
  "--diffs-bg-hover-override": "var(--foreground)",
  "--diffs-bg-selection-override": "var(--primary)",
  "--diffs-bg-separator-override": "var(--surface-tertiary)",
  "--diffs-dark": "var(--foreground)",
  "--diffs-dark-bg": "var(--card)",
  "--diffs-deletion-color-override": "var(--danger)",
  "--diffs-fg-number-addition-override": "var(--success)",
  "--diffs-fg-number-deletion-override": "var(--danger)",
  "--diffs-fg-number-override": "var(--muted-foreground)",
  "--diffs-light": "var(--foreground)",
  "--diffs-light-bg": "var(--card)",
  "--diffs-modified-color-override": "var(--accent)",
  colorScheme: "inherit"
} as CSSProperties
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
    color: var(--trees-git-modified-color);
  }

  button[data-type='item'][data-item-git-status='added'] {
    background: color-mix(in oklch, var(--trees-git-added-color) 12%, transparent);
  }

  button[data-type='item'][data-item-git-status='deleted'] {
    background: color-mix(in oklch, var(--trees-git-deleted-color) 12%, transparent);
  }

  button[data-type='item'][data-item-git-status='modified'],
  button[data-type='item'][data-item-git-status='renamed'] {
    color: var(--trees-git-modified-color);
  }

  button[data-type='item'][data-item-git-status='untracked'] {
    color: var(--trees-git-untracked-color);
  }
`
const PROJECT_TREE_STYLE = {
  "--trees-accent-override": "var(--primary)",
  "--trees-bg-muted-override": "var(--surface-tertiary)",
  "--trees-bg-override": "transparent",
  "--trees-border-color-override": "transparent",
  "--trees-fg-muted-override": "var(--muted-foreground)",
  "--trees-fg-override": "currentColor",
  "--trees-file-icon-color": "var(--muted-foreground)",
  "--trees-focus-ring-color-override": "var(--ring)",
  "--trees-git-added-color-override": "var(--success)",
  "--trees-git-deleted-color-override": "var(--danger)",
  "--trees-git-modified-color-override": "var(--warning)",
  "--trees-git-renamed-color-override": "var(--accent)",
  "--trees-git-untracked-color-override": "var(--muted-foreground)",
  "--trees-scrollbar-thumb-override": "var(--scrollbar-thumb)",
  "--trees-selected-bg-override":
    "color-mix(in oklab, var(--primary) 12%, transparent)",
  "--trees-selected-fg-override": "var(--foreground)",
  "--trees-status-added-override": "var(--success)",
  "--trees-status-deleted-override": "var(--danger)",
  "--trees-status-modified-override": "var(--warning)",
  "--trees-status-renamed-override": "var(--accent)",
  "--trees-status-untracked-override": "var(--muted-foreground)",
  "--truncate-marker-background-color": "var(--card)",
  colorScheme: "inherit",
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
const PROJECT_FILE_TREE_DEFAULT_SIZE = 30
const PROJECT_FILE_TREE_MAX_SIZE = 55
const PROJECT_FILE_TREE_MIN_SIZE = 18
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
const DiffStatsSummary = ({
  additions,
  className,
  deletions
}: {
  additions: number
  className?: string
  deletions: number
}) => (
  <span className={cn("font-semibold tabular-nums", className)}>
    <span className="text-success">+{formatProjectDiffCount(additions)}</span>{" "}
    <span className="text-danger">-{formatProjectDiffCount(deletions)}</span>
  </span>
)

const isProjectContextPanelView = (
  view: Key
): view is ProjectContextPanelView =>
  view === PROJECT_CONTEXT_FILES_TAB_ID ||
  view === PROJECT_CONTEXT_CHANGES_TAB_ID ||
  view === PROJECT_CONTEXT_COMMIT_TAB_ID

const isFileTreeDirectoryHandle = (
  item: FileTreeItemHandle | null
): item is FileTreeDirectoryHandle => item?.isDirectory() === true

const ProjectFileTree = ({
  gitStatusFiles,
  label,
  onFileSelect,
  paths
}: {
  gitStatusFiles: NonNullable<ChatSessionSummary["gitStatus"]>["files"]
  label: string
  onFileSelect: (relativePath: string) => void
  paths: string[]
}) => {
  const { t } = useI18n()
  const gitStatusEntries = useMemo(
    () => buildProjectTreeGitStatusEntries(gitStatusFiles),
    [gitStatusFiles]
  )
  const directoryPaths = useMemo(
    () => buildProjectTreeDirectoryPaths(paths),
    [paths]
  )
  const modelRef = useRef<FileTreeModel | null>(null)
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      const lastSelected = selectedPaths.at(-1)
      const selectedItem = lastSelected
        ? modelRef.current?.getItem(lastSelected)
        : null

      if (!selectedItem || selectedItem.isDirectory()) {
        return
      }

      onFileSelect(selectedItem.getPath())
    },
    [onFileSelect]
  )
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    gitStatus: gitStatusEntries,
    initialExpansion: 1,
    onSelectionChange: handleSelectionChange,
    paths,
    unsafeCSS: PROJECT_TREE_UNSAFE_CSS
  })
  modelRef.current = model
  const handleCollapseFolders = useCallback(() => {
    for (const directoryPath of directoryPaths) {
      const directoryItem = model.getItem(directoryPath)

      if (isFileTreeDirectoryHandle(directoryItem)) {
        directoryItem.collapse()
      }
    }
  }, [directoryPaths, model])

  useEffect(() => {
    model.resetPaths(paths)
    model.setGitStatus(gitStatusEntries)
  }, [model, paths, gitStatusEntries])

  const collapseFoldersLabel = t("chat.projectPanel.collapseFolders")
  const isCollapseFoldersDisabled = directoryPaths.length === 0
  const collapseFoldersButton = (
    <Button
      aria-label={collapseFoldersLabel}
      className="shrink-0"
      isDisabled={isCollapseFoldersDisabled}
      isIconOnly
      onPress={handleCollapseFolders}
      size="sm"
      type="button"
      variant="ghost"
    >
      <HugeiconsIcon icon={FolderMinusIcon} size={14} strokeWidth={2} />
    </Button>
  )

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">
          {label}
        </span>
        {isCollapseFoldersDisabled ? (
          collapseFoldersButton
        ) : (
          <Tooltip>
            <Tooltip.Trigger>{collapseFoldersButton}</Tooltip.Trigger>
            <Tooltip.Content placement="bottom">
              {collapseFoldersLabel}
            </Tooltip.Content>
          </Tooltip>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden py-2">
        <FileTree
          aria-label={label}
          className="block h-full min-h-0 w-full min-w-0 text-muted-foreground"
          model={model}
          style={PROJECT_TREE_STYLE}
        />
      </div>
    </div>
  )
}

const ProjectPanelStatusStrip = ({
  diffSummary,
  gitStatusSummaryItems
}: {
  diffSummary: ReturnType<typeof getProjectDiffSummary>
  gitStatusSummaryItems: ReturnType<typeof buildProjectGitStatusSummary>
}) => {
  const { t } = useI18n()

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-3">
      {diffSummary.changedFileCount > 0 ? (
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate text-muted-foreground">
            {t("chat.projectPanel.filesChanged", {
              count: formatProjectDiffCount(diffSummary.changedFileCount)
            })}
          </span>
          <DiffStatsSummary
            additions={diffSummary.additions}
            deletions={diffSummary.deletions}
          />
        </div>
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
  )
}

const ProjectFilePreview = ({
  errorMessage,
  fileData,
  isLoading,
  relativePath
}: {
  errorMessage: string | null
  fileData: ReadProjectFileOutput | undefined
  isLoading: boolean
  relativePath: string | null
}) => {
  const { t } = useI18n()
  const pathSegments = useMemo(
    () => relativePath?.split("/").filter(Boolean) ?? [],
    [relativePath]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs",
            relativePath ? "text-foreground" : "text-muted-foreground"
          )}
          title={relativePath ?? undefined}
        >
          {pathSegments.length > 0 ? (
            pathSegments.map((segment, index) => (
              <span className="contents" key={`${index}-${segment}`}>
                {index > 0 ? (
                  <span className="shrink-0 text-muted-foreground/70">/</span>
                ) : null}
                <span
                  className={cn(
                    "truncate",
                    index === pathSegments.length - 1
                      ? "min-w-0 font-medium text-foreground"
                      : "max-w-28 shrink-0 text-muted-foreground"
                  )}
                >
                  {segment}
                </span>
              </span>
            ))
          ) : (
            <span className="truncate">
              {t("chat.projectPanel.previewTitle")}
            </span>
          )}
        </div>
        {fileData?.language ? (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {fileData.language}
          </span>
        ) : null}
      </div>

      {isLoading && (
        <div className="flex min-h-36 flex-1 items-center justify-center">
          <Spinner size="sm" />
        </div>
      )}
      {!isLoading && errorMessage ? (
        <div className="flex min-h-36 flex-1 items-center justify-center px-4 text-center text-xs leading-5 text-danger">
          {errorMessage}
        </div>
      ) : null}
      {!isLoading && fileData && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ProjectFileCodeViewer
            content={fileData.content}
            language={fileData.language}
            relativePath={relativePath ?? ""}
          />
        </div>
      )}
      {!isLoading && !fileData && !errorMessage ? (
        <div className="flex min-h-36 flex-1 items-center justify-center px-4 text-center text-xs leading-5 text-muted-foreground">
          {t("chat.projectPanel.previewEmpty")}
        </div>
      ) : null}
    </div>
  )
}

const ProjectFilesTreePane = ({
  gitStatusFiles,
  isTreeLoading,
  label,
  onFileSelect,
  paths
}: {
  gitStatusFiles: NonNullable<ChatSessionSummary["gitStatus"]>["files"]
  isTreeLoading: boolean
  label: string
  onFileSelect: (relativePath: string) => void
  paths: string[]
}) => {
  const { t } = useI18n()

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden">
      {paths.length > 0 ? (
        <ProjectFileTree
          gitStatusFiles={gitStatusFiles}
          label={label}
          onFileSelect={onFileSelect}
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
  )
}

const ProjectFilesPanel = ({
  gitStatusFiles,
  isTreeLoading,
  label,
  paths,
  sessionId
}: {
  gitStatusFiles: NonNullable<ChatSessionSummary["gitStatus"]>["files"]
  isTreeLoading: boolean
  label: string
  paths: string[]
  sessionId: string
}) => {
  const { t } = useI18n()
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileData, setFileData] = useState<ReadProjectFileOutput | undefined>()
  const [fileErrorMessage, setFileErrorMessage] = useState<string | null>(null)
  const [isFileLoading, setFileLoading] = useState(false)
  const fileRequestIdRef = useRef(0)

  const handleFileSelect = useCallback(
    async (relativePath: string) => {
      const requestId = fileRequestIdRef.current + 1

      fileRequestIdRef.current = requestId
      setSelectedFilePath(relativePath)
      setFileData(undefined)
      setFileErrorMessage(null)
      setFileLoading(true)

      try {
        const result = await rpcClient.projectSnapshots.readFile({
          filePath: relativePath,
          sessionId
        })

        if (fileRequestIdRef.current === requestId) {
          setFileData(result)
        }
      } catch {
        if (fileRequestIdRef.current === requestId) {
          setFileData(undefined)
          setFileErrorMessage(t("chat.projectPanel.readFileError"))
        }
      } finally {
        if (fileRequestIdRef.current === requestId) {
          setFileLoading(false)
        }
      }
    },
    [sessionId, t]
  )

  useEffect(() => {
    fileRequestIdRef.current += 1
    setSelectedFilePath(null)
    setFileData(undefined)
    setFileErrorMessage(null)
    setFileLoading(false)
  }, [sessionId])

  useEffect(() => {
    if (selectedFilePath && !paths.includes(selectedFilePath)) {
      setSelectedFilePath(null)
      setFileData(undefined)
      setFileErrorMessage(null)
      setFileLoading(false)
    }
  }, [paths, selectedFilePath])

  if (!selectedFilePath) {
    return (
      <ProjectFilesTreePane
        gitStatusFiles={gitStatusFiles}
        isTreeLoading={isTreeLoading}
        label={label}
        onFileSelect={handleFileSelect}
        paths={paths}
      />
    )
  }

  return (
    <Resizable
      className="h-full min-h-0 min-w-0 flex-1 overflow-hidden"
      id="project-files-layout"
      orientation="horizontal"
    >
      <Resizable.Panel
        className="min-w-0 overflow-hidden overscroll-contain"
        defaultSize={PROJECT_FILE_TREE_DEFAULT_SIZE}
        id="project-files-tree"
        maxSize={PROJECT_FILE_TREE_MAX_SIZE}
        minSize={PROJECT_FILE_TREE_MIN_SIZE}
      >
        <ProjectFilesTreePane
          gitStatusFiles={gitStatusFiles}
          isTreeLoading={isTreeLoading}
          label={label}
          onFileSelect={handleFileSelect}
          paths={paths}
        />
      </Resizable.Panel>
      <Resizable.Handle
        aria-label={t("chat.projectPanel.resizeHandle")}
        className="self-stretch"
        type="line"
        variant="secondary"
        withIndicator
      />
      <Resizable.Panel
        className="min-w-0 overflow-hidden"
        defaultSize={100 - PROJECT_FILE_TREE_DEFAULT_SIZE}
        id="project-files-preview"
        minSize={100 - PROJECT_FILE_TREE_MAX_SIZE}
      >
        <ProjectFilePreview
          errorMessage={fileErrorMessage}
          fileData={fileData}
          isLoading={isFileLoading}
          relativePath={selectedFilePath}
        />
      </Resizable.Panel>
    </Resizable>
  )
}

const CollapsibleFileDiff = ({
  fileDiff,
  index,
  renderDiffHeaderMetadata
}: {
  fileDiff: FileDiffMetadata
  index: number
  renderDiffHeaderMetadata: (fileDiff: FileDiffMetadata) => ReactNode
}) => {
  const [isCollapsed, setCollapsed] = useState(false)

  const handleToggle = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  const { baseName, parentPath } = useMemo(() => {
    const lastSlash = fileDiff.name.lastIndexOf("/")

    return lastSlash === -1
      ? { baseName: fileDiff.name, parentPath: "" }
      : {
          baseName: fileDiff.name.slice(lastSlash + 1),
          parentPath: fileDiff.name.slice(0, lastSlash)
        }
  }, [fileDiff.name])

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 text-[11px]">
      <button
        className="flex w-full cursor-pointer items-center gap-2 border-b border-border/50 bg-muted/50 px-3 py-2 text-left transition-colors hover:bg-muted/80"
        onClick={handleToggle}
        type="button"
      >
        <svg
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            !isCollapsed && "rotate-90"
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M9 18l6-6-6-6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {baseName}
          {parentPath ? (
            <span className="ml-1.5 text-muted-foreground">{parentPath}</span>
          ) : null}
        </span>
        {renderDiffHeaderMetadata(fileDiff)}
      </button>

      {isCollapsed ? null : (
        <FileDiff
          className="text-[11px]"
          fileDiff={fileDiff}
          key={`${fileDiff.name}-${fileDiff.prevName ?? ""}-${index}`}
          options={DIFF_RENDER_OPTIONS}
          style={PROJECT_DIFF_STYLE}
        />
      )}
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {diffFiles.length > 0 ? (
          <div className="space-y-3 p-3">
            {diffFiles.map((fileDiff, index) => (
              <CollapsibleFileDiff
                fileDiff={fileDiff}
                index={index}
                key={`${fileDiff.name}-${fileDiff.prevName ?? ""}-${index}`}
                renderDiffHeaderMetadata={renderDiffHeaderMetadata}
              />
            ))}
          </div>
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
  diffSummary
}: {
  changedFiles: ReturnType<typeof buildVisibleGitStatusFiles>
  diffSummary: ReturnType<typeof getProjectDiffSummary>
}) => {
  const { t } = useI18n()
  const [commitMessage, setCommitMessage] = useState("")
  const hasChangedFiles = changedFiles.length > 0

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-2">
        <span className="min-w-0 text-xs font-semibold text-muted-foreground">
          {t("chat.projectPanel.commitTitle")}
        </span>
        {diffSummary.changedFileCount > 0 ? (
          <span className="flex max-w-full min-w-0 items-center gap-1.5 text-[11px]">
            <span className="truncate text-muted-foreground">
              {t("chat.projectPanel.filesChanged", {
                count: formatProjectDiffCount(diffSummary.changedFileCount)
              })}
            </span>
            <DiffStatsSummary
              additions={diffSummary.additions}
              deletions={diffSummary.deletions}
            />
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="p-3">
          <p className="text-xs font-semibold text-muted-foreground">
            {t("chat.projectPanel.commitFilesTitle")}
          </p>
          {hasChangedFiles ? (
            <ul className="mt-2 divide-y divide-border/70">
              {changedFiles.map((file) => (
                <li
                  className="grid min-h-9 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 py-2 text-xs"
                  key={`${file.status}-${file.path}`}
                >
                  <span
                    className={cn(
                      "min-w-0 whitespace-normal leading-5 [overflow-wrap:anywhere]",
                      PROJECT_STATUS_TEXT_CLASS_NAMES[file.status]
                    )}
                    title={file.path}
                  >
                    {file.path}
                  </span>
                  <Chip
                    className="shrink-0"
                    color={PROJECT_STATUS_CHIP_COLORS[file.status]}
                    size="sm"
                    variant="soft"
                  >
                    <Chip.Label className="whitespace-nowrap">
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
          className="min-h-28 min-w-0 text-sm"
          fullWidth
          id="project-commit-message"
          maxLength={COMMIT_MESSAGE_MAX_LENGTH}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder={t("chat.projectPanel.commitMessagePlaceholder")}
          rows={5}
          value={commitMessage}
          variant="secondary"
        />
        <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {commitMessage.length} / {COMMIT_MESSAGE_MAX_LENGTH}
          </span>
          <Button className="shrink-0" isDisabled size="sm" type="button">
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
  selectedSession,
  selectedView
}: {
  gitDiff?: GitProjectDiffOutput
  isDiffLoading: boolean
  isTreeLoading: boolean
  onRefresh: () => void
  onViewChange: (view: ProjectContextPanelView) => void
  projectItems: ProjectSnapshotItem[]
  selectedSession: ChatSessionSummary
  selectedView: ProjectContextPanelView
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
  const changedFiles = useMemo(
    () => buildVisibleGitStatusFiles(gitStatus?.files ?? []),
    [gitStatus?.files]
  )
  const hasGitChanges = Boolean(gitStatus?.changedFileCount)
  const emptyDiffMessage = useMemo(() => {
    if (isDiffLoading) {
      return t("chat.projectPanel.loading")
    }

    if (hasGitChanges) {
      return t("chat.projectPanel.emptyTrackedDiff")
    }

    return t("chat.projectPanel.emptyDiff")
  }, [isDiffLoading, hasGitChanges, t])
  const renderDiffHeaderMetadata = useCallback((fileDiff: FileDiffMetadata) => {
    const stats = getProjectDiffFileStats(fileDiff)

    return (
      <DiffStatsSummary
        additions={stats.additions}
        className="text-[11px] leading-none"
        deletions={stats.deletions}
      />
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
    <aside className="flex h-full min-h-0 min-w-0 overflow-hidden overscroll-contain border border-border bg-card shadow-sm">
      <Tabs
        className="flex h-full min-h-0 w-full flex-col gap-0 overflow-hidden"
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
        />

        <Tabs.Panel
          className="mt-0 flex min-h-0 flex-1 overflow-hidden p-0 data-[inert=true]:hidden"
          id={PROJECT_CONTEXT_FILES_TAB_ID}
        >
          <ProjectFilesPanel
            gitStatusFiles={gitStatus?.files ?? []}
            isTreeLoading={isTreeLoading}
            label={t("chat.projectPanel.filesTitle")}
            paths={paths}
            sessionId={selectedSession.id}
          />
        </Tabs.Panel>

        <Tabs.Panel
          className="mt-0 flex min-h-0 flex-1 overflow-hidden p-0 data-[inert=true]:hidden"
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
          className="mt-0 flex min-h-0 flex-1 overflow-hidden p-0 data-[inert=true]:hidden"
          id={PROJECT_CONTEXT_COMMIT_TAB_ID}
        >
          <ProjectCommitPanel
            changedFiles={changedFiles}
            diffSummary={diffSummary}
          />
        </Tabs.Panel>
      </Tabs>
    </aside>
  )
}
