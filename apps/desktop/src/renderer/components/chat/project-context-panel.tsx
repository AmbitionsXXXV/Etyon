import { useI18n } from "@etyon/i18n/react"
import type {
  ChatSessionSummary,
  GitProjectDiffOutput,
  ProjectSnapshotItem,
  ReadProjectFileOutput
} from "@etyon/rpc"
import { cn } from "@etyon/ui/lib/utils"
import { Resizable } from "@heroui-pro/react"
import {
  Button,
  Chip,
  Spinner,
  Tabs,
  TextArea,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip
} from "@heroui/react"
import {
  ArrowReloadHorizontalIcon,
  FileCodeIcon,
  FolderMinusIcon,
  GitCompareIcon
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
import { TerminalPanel } from "@/renderer/components/chat/terminal-panel"
import {
  buildProjectGitStatusSummary,
  buildProjectTreeDirectoryPaths,
  buildProjectTreeGitStatusEntries,
  buildProjectTreePaths,
  buildVisibleGitStatusFiles,
  COMMIT_MESSAGE_MAX_LENGTH,
  formatProjectDiffCount,
  getProjectDiffFileStats,
  getProjectDiffSummary,
  isProjectChangesScope,
  isProjectContextPanelView,
  parseProjectDiffFiles,
  PROJECT_CHANGES_SCOPE_AGENT,
  PROJECT_CHANGES_SCOPE_ALL,
  PROJECT_CONTEXT_CHANGES_TAB_ID,
  PROJECT_CONTEXT_COMMIT_TAB_ID,
  PROJECT_CONTEXT_FILES_TAB_ID,
  PROJECT_CONTEXT_TERMINAL_TAB_ID,
  PROJECT_FILE_TREE_DEFAULT_SIZE,
  PROJECT_FILE_TREE_MAX_SIZE,
  PROJECT_FILE_TREE_MIN_SIZE
} from "@/renderer/lib/chat/project-context-panel"
import type {
  ProjectChangesScope,
  ProjectContextPanelView
} from "@/renderer/lib/chat/project-context-panel"
import { requestProjectPanelReveal } from "@/renderer/lib/chat/project-panel-navigation"
import type { ProjectPanelRevealRequest } from "@/renderer/lib/chat/project-panel-navigation"
import { rpcClient } from "@/renderer/lib/rpc"

// HeroUI v3 Button type omits tabIndex, but Tooltip.Trigger's Focusable needs it on the child; spread bypasses the type restriction
const FOCUSABLE_TAB_INDEX = { tabIndex: 0 } as Record<string, unknown>

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

const isFileTreeDirectoryHandle = (
  item: FileTreeItemHandle | null
): item is FileTreeDirectoryHandle => item?.isDirectory() === true

const ProjectFileTree = ({
  gitStatusFiles,
  label,
  onFileSelect,
  paths,
  revealTarget
}: {
  gitStatusFiles: NonNullable<ChatSessionSummary["gitStatus"]>["files"]
  label: string
  onFileSelect: (relativePath: string) => void
  paths: string[]
  revealTarget?: ProjectPanelRevealRequest | null
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
  // Guards a programmatic reveal selection from re-entering the user-selection
  // path (which loads the file and clears any highlight line).
  const suppressSelectionRef = useRef(false)
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      if (suppressSelectionRef.current) {
        suppressSelectionRef.current = false
        return
      }

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

  // Mirror a reveal into the tree's own selection: expand ancestors, select the
  // node, and scroll it into view. The file content is loaded by the parent, so
  // this selection is suppressed from re-triggering a load.
  useEffect(() => {
    if (!revealTarget) {
      return
    }

    const revealPath = revealTarget.path
    const frame = requestAnimationFrame(() => {
      const item = model.getItem(revealPath)

      if (!item || item.isDirectory()) {
        return
      }

      const segments = revealPath.split("/").filter(Boolean)

      for (let index = 1; index < segments.length; index += 1) {
        const directoryItem = model.getItem(segments.slice(0, index).join("/"))

        if (isFileTreeDirectoryHandle(directoryItem)) {
          directoryItem.expand()
        }
      }

      suppressSelectionRef.current = true
      item.select()
      model.scrollToPath(revealPath, { offset: "center" })
      queueMicrotask(() => {
        suppressSelectionRef.current = false
      })
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [model, revealTarget])

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
      {...FOCUSABLE_TAB_INDEX}
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
          color={
            PROJECT_STATUS_CHIP_COLORS[
              item.status as keyof typeof PROJECT_STATUS_CHIP_COLORS
            ]
          }
          key={item.status}
          size="sm"
          title={`${t(PROJECT_STATUS_LABEL_KEYS[item.status as keyof typeof PROJECT_STATUS_LABEL_KEYS])}: ${item.count}`}
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
  hasChanges,
  highlightLine,
  isLoading,
  relativePath
}: {
  errorMessage: string | null
  fileData: ReadProjectFileOutput | undefined
  hasChanges: boolean
  highlightLine?: number | null
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
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {fileData?.language ? (
            <span className="text-[10px] text-muted-foreground">
              {fileData.language}
            </span>
          ) : null}
          {hasChanges && relativePath ? (
            <Tooltip>
              <Tooltip.Trigger>
                <Button
                  aria-label={t("chat.projectPanel.viewDiff")}
                  className="h-6 min-w-0 px-1.5 text-[11px]"
                  onPress={() =>
                    requestProjectPanelReveal({
                      path: relativePath,
                      view: "diff"
                    })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                  {...FOCUSABLE_TAB_INDEX}
                >
                  <HugeiconsIcon
                    icon={GitCompareIcon}
                    size={13}
                    strokeWidth={2}
                  />
                  {t("chat.projectPanel.viewDiff")}
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom">
                {t("chat.projectPanel.viewDiff")}
              </Tooltip.Content>
            </Tooltip>
          ) : null}
        </div>
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
            highlightLine={highlightLine}
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
  paths,
  revealTarget
}: {
  gitStatusFiles: NonNullable<ChatSessionSummary["gitStatus"]>["files"]
  isTreeLoading: boolean
  label: string
  onFileSelect: (relativePath: string) => void
  paths: string[]
  revealTarget?: ProjectPanelRevealRequest | null
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
          revealTarget={revealTarget}
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
  revealTarget,
  sessionId
}: {
  gitStatusFiles: NonNullable<ChatSessionSummary["gitStatus"]>["files"]
  isTreeLoading: boolean
  label: string
  paths: string[]
  revealTarget?: ProjectPanelRevealRequest | null
  sessionId: string
}) => {
  const { t } = useI18n()
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileData, setFileData] = useState<ReadProjectFileOutput | undefined>()
  const [fileErrorMessage, setFileErrorMessage] = useState<string | null>(null)
  const [isFileLoading, setFileLoading] = useState(false)
  const [highlightLine, setHighlightLine] = useState<number | null>(null)
  const fileRequestIdRef = useRef(0)
  const handledRevealIdRef = useRef<number | null>(null)
  const hasChanges = useMemo(
    () =>
      selectedFilePath !== null &&
      gitStatusFiles.some(
        (file) => file.path === selectedFilePath && file.status !== "ignored"
      ),
    [gitStatusFiles, selectedFilePath]
  )

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

  // User-driven tree selection clears any reveal highlight; a reveal keeps it.
  const handleTreeFileSelect = useCallback(
    (relativePath: string) => {
      setHighlightLine(null)
      void handleFileSelect(relativePath)
    },
    [handleFileSelect]
  )

  useEffect(() => {
    if (
      !revealTarget ||
      revealTarget.requestId === handledRevealIdRef.current
    ) {
      return
    }

    handledRevealIdRef.current = revealTarget.requestId
    setHighlightLine(revealTarget.line ?? null)
    void handleFileSelect(revealTarget.path)
  }, [handleFileSelect, revealTarget])

  useEffect(() => {
    fileRequestIdRef.current += 1
    handledRevealIdRef.current = null
    setSelectedFilePath(null)
    setFileData(undefined)
    setFileErrorMessage(null)
    setFileLoading(false)
    setHighlightLine(null)
  }, [sessionId])

  useEffect(() => {
    if (selectedFilePath && !paths.includes(selectedFilePath)) {
      setSelectedFilePath(null)
      setFileData(undefined)
      setFileErrorMessage(null)
      setFileLoading(false)
      setHighlightLine(null)
    }
  }, [paths, selectedFilePath])

  if (!selectedFilePath) {
    return (
      <ProjectFilesTreePane
        gitStatusFiles={gitStatusFiles}
        isTreeLoading={isTreeLoading}
        label={label}
        onFileSelect={handleTreeFileSelect}
        paths={paths}
        revealTarget={revealTarget}
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
          onFileSelect={handleTreeFileSelect}
          paths={paths}
          revealTarget={revealTarget}
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
          hasChanges={hasChanges}
          highlightLine={highlightLine}
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
  renderDiffHeaderMetadata,
  revealRequestId
}: {
  fileDiff: FileDiffMetadata
  index: number
  renderDiffHeaderMetadata: (fileDiff: FileDiffMetadata) => ReactNode
  revealRequestId?: number
}) => {
  const { t } = useI18n()
  const [isCollapsed, setCollapsed] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const handleToggle = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  const firstChangedLine = fileDiff.hunks[0]?.additionStart
  const handleViewFile = useCallback(() => {
    requestProjectPanelReveal({
      path: fileDiff.name,
      view: "file",
      ...(firstChangedLine === undefined ? {} : { line: firstChangedLine })
    })
  }, [fileDiff.name, firstChangedLine])

  // A reveal targeting this file expands the card and scrolls it into view.
  useEffect(() => {
    if (revealRequestId === undefined) {
      return
    }

    setCollapsed(false)
    const frame = requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ block: "start" })
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [revealRequestId])

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
    <div
      className="rounded-xl border border-border/70 text-[11px]"
      ref={cardRef}
    >
      <div
        className={cn(
          "sticky top-0 z-20 flex w-full items-center gap-2 rounded-t-[11px] border-b border-border/50 bg-muted/95 px-3 py-2 shadow-sm backdrop-blur",
          isCollapsed && "rounded-b-[11px] border-b-0"
        )}
      >
        <button
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left transition-colors hover:text-foreground"
          data-project-diff-file-header=""
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
        </button>
        {renderDiffHeaderMetadata(fileDiff)}
        <Tooltip>
          <Tooltip.Trigger>
            <Button
              aria-label={t("chat.projectPanel.viewFile")}
              className="size-6 shrink-0"
              isIconOnly
              onPress={handleViewFile}
              size="sm"
              type="button"
              variant="ghost"
              {...FOCUSABLE_TAB_INDEX}
            >
              <HugeiconsIcon icon={FileCodeIcon} size={13} strokeWidth={2} />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content placement="bottom">
            {t("chat.projectPanel.viewFile")}
          </Tooltip.Content>
        </Tooltip>
      </div>

      {isCollapsed ? null : (
        <div className="overflow-hidden rounded-b-[11px]">
          <FileDiff
            className="text-[11px]"
            fileDiff={fileDiff}
            key={`${fileDiff.name}-${fileDiff.prevName ?? ""}-${index}`}
            options={DIFF_RENDER_OPTIONS}
            style={PROJECT_DIFF_STYLE}
          />
        </div>
      )}
    </div>
  )
}

const ProjectChangesPanel = ({
  diffFiles,
  emptyDiffMessage,
  gitDiff,
  gitDiffScope,
  hasAgentEditedPaths,
  isDiffLoading,
  onGitDiffScopeChange,
  renderDiffHeaderMetadata,
  revealTarget
}: {
  diffFiles: FileDiffMetadata[]
  emptyDiffMessage: string
  gitDiff?: GitProjectDiffOutput
  gitDiffScope: ProjectChangesScope
  hasAgentEditedPaths: boolean
  isDiffLoading: boolean
  onGitDiffScopeChange: (scope: ProjectChangesScope) => void
  renderDiffHeaderMetadata: (fileDiff: FileDiffMetadata) => ReactNode
  revealTarget?: ProjectPanelRevealRequest | null
}) => {
  const { t } = useI18n()
  const isEmptyAgentScope =
    gitDiffScope === PROJECT_CHANGES_SCOPE_AGENT && !hasAgentEditedPaths
  const handleGitDiffScopeChange = useCallback(
    (keys: Set<Key>) => {
      for (const key of keys) {
        if (isProjectChangesScope(key)) {
          onGitDiffScopeChange(key)
          return
        }
      }
    },
    [onGitDiffScopeChange]
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground">
          {t("chat.projectPanel.diffTitle")}
        </span>
        <div className="flex items-center gap-2">
          <ToggleButtonGroup
            aria-label={t("chat.projectPanel.changesScopeLabel")}
            disallowEmptySelection
            onSelectionChange={handleGitDiffScopeChange}
            selectedKeys={new Set([gitDiffScope])}
            selectionMode="single"
            size="sm"
          >
            <ToggleButton id={PROJECT_CHANGES_SCOPE_AGENT}>
              {t("chat.projectPanel.agentChanges")}
            </ToggleButton>
            <ToggleButton id={PROJECT_CHANGES_SCOPE_ALL}>
              <ToggleButtonGroup.Separator />
              {t("chat.projectPanel.allChanges")}
            </ToggleButton>
          </ToggleButtonGroup>
          {gitDiff?.truncated ? (
            <span className="text-[11px] text-warning">
              {t("chat.projectPanel.truncated")}
            </span>
          ) : null}
        </div>
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
                revealRequestId={
                  revealTarget?.view === "diff" &&
                  revealTarget.path === fileDiff.name
                    ? revealTarget.requestId
                    : undefined
                }
              />
            ))}
          </div>
        ) : isEmptyAgentScope ? (
          <div className="flex h-full min-h-36 flex-col items-center justify-center gap-3 px-4 text-center text-xs leading-5 text-muted-foreground">
            <p>{t("chat.projectPanel.emptyAgentDiff")}</p>
            <Button
              onPress={() => onGitDiffScopeChange(PROJECT_CHANGES_SCOPE_ALL)}
              size="sm"
              type="button"
              variant="secondary"
            >
              {t("chat.projectPanel.showAllChanges")}
            </Button>
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
                      PROJECT_STATUS_TEXT_CLASS_NAMES[
                        file.status as keyof typeof PROJECT_STATUS_TEXT_CLASS_NAMES
                      ]
                    )}
                    title={file.path}
                  >
                    {file.path}
                  </span>
                  <Chip
                    className="shrink-0"
                    color={
                      PROJECT_STATUS_CHIP_COLORS[
                        file.status as keyof typeof PROJECT_STATUS_CHIP_COLORS
                      ]
                    }
                    size="sm"
                    variant="soft"
                  >
                    <Chip.Label className="whitespace-nowrap">
                      {t(
                        PROJECT_STATUS_LABEL_KEYS[
                          file.status as keyof typeof PROJECT_STATUS_LABEL_KEYS
                        ]
                      )}
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
  gitDiffScope,
  isDiffLoading,
  isTreeLoading,
  onGitDiffScopeChange,
  onRefresh,
  onViewChange,
  projectItems,
  revealTarget,
  selectedSession,
  selectedView
}: {
  gitDiff?: GitProjectDiffOutput
  gitDiffScope: ProjectChangesScope
  isDiffLoading: boolean
  isTreeLoading: boolean
  onGitDiffScopeChange: (scope: ProjectChangesScope) => void
  onRefresh: () => void
  onViewChange: (view: ProjectContextPanelView) => void
  projectItems: ProjectSnapshotItem[]
  revealTarget?: ProjectPanelRevealRequest | null
  selectedSession: ChatSessionSummary
  selectedView: ProjectContextPanelView
}) => {
  const { t } = useI18n()
  const fileRevealTarget = revealTarget?.view === "file" ? revealTarget : null
  const diffRevealTarget = revealTarget?.view === "diff" ? revealTarget : null
  const { gitStatus } = selectedSession
  const hasAgentEditedPaths =
    (selectedSession.agentEditedPaths ?? []).length > 0
  const gitStatusSummaryItems = useMemo(
    () => buildProjectGitStatusSummary(gitStatus),
    [gitStatus]
  )
  const paths = useMemo(
    () => buildProjectTreePaths(projectItems),
    [projectItems]
  )
  const diffFiles = useMemo(
    () =>
      parseProjectDiffFiles({
        fileSnapshots: gitDiff?.fileSnapshots ?? [],
        patch: gitDiff?.patch ?? ""
      }),
    [gitDiff?.fileSnapshots, gitDiff?.patch]
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
              <Tabs.Tab id={PROJECT_CONTEXT_TERMINAL_TAB_ID}>
                {t("chat.projectPanel.terminalView")}
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
            revealTarget={fileRevealTarget}
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
            gitDiffScope={gitDiffScope}
            hasAgentEditedPaths={hasAgentEditedPaths}
            isDiffLoading={isDiffLoading}
            onGitDiffScopeChange={onGitDiffScopeChange}
            renderDiffHeaderMetadata={renderDiffHeaderMetadata}
            revealTarget={diffRevealTarget}
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

        <Tabs.Panel
          className="mt-0 flex min-h-0 flex-1 overflow-hidden p-0 data-[inert=true]:hidden"
          id={PROJECT_CONTEXT_TERMINAL_TAB_ID}
        >
          <TerminalPanel
            key={selectedSession.id}
            sessionId={selectedSession.id}
          />
        </Tabs.Panel>
      </Tabs>
    </aside>
  )
}
