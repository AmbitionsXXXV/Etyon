import { useI18n } from "@etyon/i18n/react"
import type { ChatSessionSummary } from "@etyon/rpc"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@etyon/ui/components/dialog"
import { Dropdown } from "@etyon/ui/components/dropdown"
import { Separator } from "@etyon/ui/components/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarTrigger,
  useSidebar
} from "@etyon/ui/components/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@etyon/ui/components/tooltip"
import { cn } from "@etyon/ui/lib/utils"
import { Button, Input } from "@heroui/react"
import {
  Archive02Icon,
  Delete02Icon,
  FileAddIcon,
  Folder01Icon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  NoteEditIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  Search01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import type {
  ChangeEvent,
  DragEvent,
  Key,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SyntheticEvent
} from "react"

import { orpc } from "@/renderer/lib/rpc"
import {
  CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS,
  getChatSessionTitle,
  getChatSessionMetaItems,
  getVisibleProjectGroupSessions,
  groupChatSessionsByProject,
  hasHiddenProjectGroupSessions,
  isProjectGroupExpanded,
  isProjectsSidebarMode,
  PROJECT_GROUP_PAGE_SIZE,
  reorderProjectPaths,
  shouldShowProjectGroupLessAction,
  sortPinnedChatSessions
} from "@/renderer/lib/sidebar/chat-sessions"
import type { ChatSessionGroup } from "@/renderer/lib/sidebar/chat-sessions"
import { useChatSessionActions } from "@/renderer/lib/sidebar/use-chat-session-actions"
import {
  SIDEBAR_WIDTH_PX_MAX,
  SIDEBAR_WIDTH_PX_MIN,
  useProjectSidebarState
} from "@/renderer/lib/sidebar/use-project-sidebar-state"

const EXPAND_EASE = [0.25, 1, 0.5, 1] as const
const EXPAND_RESET_DELAY_MS = 520
const PROJECT_GROUP_ROW_CLASS_NAME =
  "title-bar-no-drag group/project-row -mx-1 flex h-10 w-full items-center gap-1 rounded-xl px-2 text-left text-[15px] font-medium text-sidebar-foreground/82 transition-[background-color,color] hover:bg-white/4 hover:text-sidebar-accent-foreground focus-within:bg-white/4 focus-within:text-sidebar-accent-foreground"
const PROJECT_GROUP_TOGGLE_CLASS_NAME =
  "flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-0 text-left text-inherit outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
const PROJECTS_SECTION_EMPTY_CLASS_NAME =
  "title-bar-no-drag mt-2 rounded-[1.25rem] border border-dashed border-sidebar-border/70 bg-white/[0.03] px-4 py-4 text-[12px] leading-5 text-sidebar-foreground/68"
const PROJECTS_SECTION_HEADER_CLASS_NAME =
  "title-bar-no-drag group/projects-header flex items-center gap-1 rounded-[1.125rem] px-1 py-1.5 transition-[background-color,color] hover:bg-white/[0.03] focus-within:bg-white/[0.03]"
const SESSION_ROW_CLASS_NAME =
  "min-h-10.5 items-center rounded-[1.125rem] px-3 py-0 text-sm font-medium text-sidebar-foreground/86 transition-[background-color,color] hover:bg-white/5 hover:text-sidebar-accent-foreground data-[active=true]:bg-white/7 data-[active=true]:text-sidebar-accent-foreground"
const SESSION_ROW_META_CLASS_NAME =
  "shrink-0 text-sm leading-none font-medium tabular-nums text-sidebar-foreground/58"

interface AppSidebarShellProps {
  children?: ReactNode
  contentClassName?: string
  headerClassName?: string
  headerContent: ReactNode
  onSidebarResizeCommit?: (sidebarWidthPx: number) => void
  onSidebarResizePreview?: (sidebarWidthPx: number) => void
  sidebarWidthPx?: number
}

interface ChatSessionItemProps {
  archivingSessionId?: string
  currentSessionId?: string
  fallbackSessionTitle: string
  layout?: "project" | "simple"
  onArchive: (sessionId: string) => void
  onOpen: (sessionId: string) => void
  onTogglePinned?: (sessionId: string, pinned: boolean) => void
  session: ChatSessionSummary
  showPinAction?: boolean
  togglingPinnedSessionId?: string
}

interface ProjectGroupSectionProps {
  archivingSessionId?: string
  archivingProjectPath?: string
  collapsedProjectPaths: string[]
  currentSessionId?: string
  draggingProjectPath?: string
  fallbackSessionTitle: string
  group: ChatSessionGroup
  onArchive: (sessionId: string) => void
  onArchiveProjectChats: (projectPath: string) => void
  onOpenProjectInFileManager: (projectPath: string) => void
  onOpen: (sessionId: string) => void
  onProjectDragEnd: () => void
  onProjectDragOver: (
    event: DragEvent<HTMLDivElement>,
    projectPath: string
  ) => void
  onProjectDragStart: (
    event: DragEvent<HTMLDivElement>,
    projectPath: string
  ) => void
  onProjectDrop: (event: DragEvent<HTMLDivElement>, projectPath: string) => void
  onRemoveProject: (projectPath: string) => void
  onRenameProject: (projectPath: string, displayName: string) => void
  onShowLess: (projectPath: string) => void
  onShowMore: (projectPath: string) => void
  onToggleCollapsed: (projectPath: string) => void
  onToggleProjectPinned: (projectPath: string, pinned: boolean) => void
  onTogglePinned: (sessionId: string, pinned: boolean) => void
  openProjectInFileManagerLabel: string
  removingProjectPath?: string
  renamingProjectPath?: string
  showLessLabel: string
  showMoreLabel: string
  settingPinnedProjectPath?: string
  toggleProjectGroupLabel: string
  togglingPinnedSessionId?: string
  visibleCount: number
}

interface ProjectGroupsSectionProps {
  addProjectLabel: string
  archivingSessionId?: string
  archivingProjectPath?: string
  collapsedProjectPaths: string[]
  currentSessionId?: string
  emptyProjectsLabel: string
  fallbackSessionTitle: string
  groups: ChatSessionGroup[]
  isCreatingProjectChatSession: boolean
  onArchive: (sessionId: string) => void
  onArchiveProjectChats: (projectPath: string) => void
  onCreateProjectChatSession: () => void
  onOpenProjectInFileManager: (projectPath: string) => void
  onOpen: (sessionId: string) => void
  onReorderProjects: (projectPaths: string[]) => void
  onRemoveProject: (projectPath: string) => void
  onRenameProject: (projectPath: string, displayName: string) => void
  onShowLess: (projectPath: string) => void
  onShowMore: (projectPath: string) => void
  onToggleCollapsed: (projectPath: string) => void
  onToggleProjectPinned: (projectPath: string, pinned: boolean) => void
  onTogglePinned: (sessionId: string, pinned: boolean) => void
  openProjectInFileManagerLabel: string
  projectCount: number
  projectsCountLabel: string
  projectsLabel: string
  removingProjectPath?: string
  renamingProjectPath?: string
  settingPinnedProjectPath?: string
  sessionCount: number
  showLessLabel: string
  showMoreLabel: string
  toggleProjectGroupLabel: string
  togglingPinnedSessionId?: string
  visibleCountForProject: (projectPath: string) => number
}

const getProjectMenuDisabledKeys = ({
  isArchivingProject,
  isRemovingProject,
  isRenamingProject,
  isSettingPinnedProject
}: {
  isArchivingProject: boolean
  isRemovingProject: boolean
  isRenamingProject: boolean
  isSettingPinnedProject: boolean
}): string[] => {
  const disabledKeys: string[] = []

  if (isArchivingProject) {
    disabledKeys.push("archive-chats")
  }

  if (isRemovingProject) {
    disabledKeys.push("remove")
  }

  if (isRenamingProject) {
    disabledKeys.push("rename-project")
  }

  if (isSettingPinnedProject) {
    disabledKeys.push("toggle-pin")
  }

  return disabledKeys
}

const getSessionButtonTitle = ({
  diffLabel,
  projectPath
}: {
  diffLabel?: string
  projectPath: string
}): string => (diffLabel ? `${projectPath} - ${diffLabel}` : projectPath)

const getSessionMainButtonPaddingClassName = (showPinAction: boolean): string =>
  showPinAction ? "pl-1 pr-0" : "px-0"

const getSessionRowPaddingClassName = (showPinAction: boolean): string =>
  showPinAction ? "px-0" : "px-3"

const getSessionTitleContainerLayoutClassName = (
  showProjectDiffLine: boolean
): string =>
  showProjectDiffLine
    ? "flex-col justify-center gap-1 py-1.5"
    : "items-center leading-none"

const SidebarGitStatusSummary = ({
  gitStatus
}: {
  gitStatus: ChatSessionSummary["gitStatus"]
}) => {
  if (!gitStatus?.isRepository || gitStatus.changedFileCount === 0) {
    return null
  }

  const items = [
    gitStatus.added > 0
      ? { className: "text-success", label: `+${gitStatus.added}` }
      : null,
    gitStatus.modified > 0
      ? { className: "text-warning", label: `~${gitStatus.modified}` }
      : null,
    gitStatus.deleted > 0
      ? { className: "text-danger", label: `-${gitStatus.deleted}` }
      : null,
    gitStatus.renamed > 0
      ? { className: "text-accent", label: `R${gitStatus.renamed}` }
      : null,
    gitStatus.untracked > 0
      ? {
          className: "text-sidebar-foreground/55",
          label: `?${gitStatus.untracked}`
        }
      : null
  ].filter(
    (item): item is { className: string; label: string } => item !== null
  )

  return (
    <span className="inline-flex max-w-22 min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-full border border-sidebar-border/60 bg-white/[0.035] px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums">
      {items.map((item) => (
        <span className={cn("shrink-0", item.className)} key={item.label}>
          {item.label}
        </span>
      ))}
    </span>
  )
}

export const AppSidebarShell = ({
  children,
  contentClassName,
  headerClassName,
  headerContent,
  onSidebarResizeCommit,
  onSidebarResizePreview,
  sidebarWidthPx = 272
}: AppSidebarShellProps) => {
  const { state } = useSidebar()
  const expandResetTimeoutRef = useRef<number | null>(null)
  const prevStateRef = useRef(state)
  const [expanding, setExpanding] = useState(false)
  const resizeStartRef = useRef<{
    pointerId: number
    startSidebarWidthPx: number
    startX: number
  } | null>(null)

  useEffect(() => {
    if (expandResetTimeoutRef.current !== null) {
      window.clearTimeout(expandResetTimeoutRef.current)
      expandResetTimeoutRef.current = null
    }

    if (prevStateRef.current === "collapsed" && state === "expanded") {
      setExpanding(true)
      expandResetTimeoutRef.current = window.setTimeout(() => {
        setExpanding(false)
        expandResetTimeoutRef.current = null
      }, EXPAND_RESET_DELAY_MS)
    }

    prevStateRef.current = state

    return () => {
      if (expandResetTimeoutRef.current !== null) {
        window.clearTimeout(expandResetTimeoutRef.current)
        expandResetTimeoutRef.current = null
      }
    }
  }, [state])

  const headerVariants = {
    collapsed: { opacity: 0 },
    expanded: {
      opacity: 1,
      transition: { delay: 0.08, duration: 0.35, ease: EXPAND_EASE }
    }
  }

  const contentVariants = {
    collapsed: { opacity: 0 },
    expanded: {
      opacity: 1,
      transition: { delay: 0.14, duration: 0.38, ease: EXPAND_EASE }
    }
  }
  const handleSidebarResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (state === "collapsed") {
        return
      }

      resizeStartRef.current = {
        pointerId: event.pointerId,
        startSidebarWidthPx: sidebarWidthPx,
        startX: event.clientX
      }

      event.currentTarget.setPointerCapture(event.pointerId)

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const activeResize = resizeStartRef.current

        if (!activeResize || moveEvent.pointerId !== activeResize.pointerId) {
          return
        }

        const nextSidebarWidthPx = Math.min(
          SIDEBAR_WIDTH_PX_MAX,
          Math.max(
            SIDEBAR_WIDTH_PX_MIN,
            activeResize.startSidebarWidthPx +
              (moveEvent.clientX - activeResize.startX)
          )
        )

        onSidebarResizePreview?.(nextSidebarWidthPx)
      }

      const handlePointerUp = (upEvent: PointerEvent) => {
        const activeResize = resizeStartRef.current

        if (!activeResize || upEvent.pointerId !== activeResize.pointerId) {
          return
        }

        const nextSidebarWidthPx = Math.min(
          SIDEBAR_WIDTH_PX_MAX,
          Math.max(
            SIDEBAR_WIDTH_PX_MIN,
            activeResize.startSidebarWidthPx +
              (upEvent.clientX - activeResize.startX)
          )
        )

        resizeStartRef.current = null
        onSidebarResizeCommit?.(nextSidebarWidthPx)
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
      }

      window.addEventListener("pointermove", handlePointerMove)
      window.addEventListener("pointerup", handlePointerUp)
    },
    [onSidebarResizeCommit, onSidebarResizePreview, sidebarWidthPx, state]
  )

  return (
    <Sidebar collapsible="offcanvas" side="left">
      <SidebarHeader
        className={cn("title-bar-drag ml-auto pt-1", headerClassName)}
      >
        <motion.div
          animate={expanding ? "expanded" : undefined}
          className="title-bar-no-drag flex items-center gap-0.5"
          initial={false}
          variants={headerVariants}
        >
          {headerContent}
        </motion.div>
      </SidebarHeader>

      <SidebarContent className={cn("title-bar-drag", contentClassName)}>
        <motion.div
          animate={expanding ? "expanded" : undefined}
          className="flex min-h-0 flex-1 flex-col"
          initial={false}
          variants={contentVariants}
        >
          {children}
        </motion.div>
      </SidebarContent>

      {state === "expanded" ? (
        <hr
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          className="title-bar-no-drag absolute top-0 right-0 z-30 h-full w-3 cursor-col-resize border-0 after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-sidebar-border/50 after:transition-colors hover:after:bg-sidebar-accent-foreground/28"
          onPointerDown={handleSidebarResizePointerDown}
        />
      ) : null}
    </Sidebar>
  )
}

const ChatSessionItem = ({
  archivingSessionId,
  currentSessionId,
  fallbackSessionTitle,
  onArchive,
  onOpen,
  onTogglePinned,
  session,
  showPinAction = false,
  togglingPinnedSessionId
}: ChatSessionItemProps) => {
  const { t } = useI18n({ keyPrefix: "home.sidebar" })
  const handleClick = useCallback(() => {
    onOpen(session.id)
  }, [onOpen, session.id])
  const metaItems = getChatSessionMetaItems({ session })
  const diffMetaItem = metaItems.find((item) => item.kind === "git-diff")
  const timeMetaItem = metaItems.find((item) => item.kind === "time")
  const isArchiving = archivingSessionId === session.id
  const isPinned = Boolean(session.pinnedAt)
  const isTogglingPinned = togglingPinnedSessionId === session.id
  const pinActionLabel = t(isPinned ? "unpinSession" : "pinSession")
  const handleTogglePinned = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      onTogglePinned?.(session.id, !isPinned)
    },
    [isPinned, onTogglePinned, session.id]
  )
  const handleArchiveClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      onArchive(session.id)
    },
    [onArchive, session.id]
  )

  const isRowActive = currentSessionId === session.id
  const showProjectDiffLine = false

  return (
    <SidebarMenuItem>
      <div
        className={cn(
          SESSION_ROW_CLASS_NAME,
          "flex w-full items-center gap-0 overflow-hidden py-0",
          getSessionRowPaddingClassName(showPinAction)
        )}
        data-active={isRowActive ? true : undefined}
      >
        {showPinAction ? (
          <button
            aria-label={pinActionLabel}
            className={cn(
              "flex min-h-10.5 w-9 shrink-0 items-center justify-center rounded-none border-0 bg-transparent p-0 text-sidebar-foreground/70 outline-none transition-[opacity,color] duration-150 hover:bg-white/5 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50",
              "pointer-events-none opacity-0",
              "group-hover/menu-item:pointer-events-auto group-hover/menu-item:opacity-100",
              "group-focus-within/menu-item:pointer-events-auto group-focus-within/menu-item:opacity-100",
              "focus-visible:pointer-events-auto focus-visible:opacity-100"
            )}
            disabled={isTogglingPinned}
            onClick={handleTogglePinned}
            title={pinActionLabel}
            type="button"
          >
            <HugeiconsIcon
              className="size-3.5 shrink-0"
              icon={isPinned ? PinOffIcon : PinIcon}
            />
          </button>
        ) : null}
        <div className="relative flex min-h-10.5 min-w-0 flex-1 items-stretch pr-2">
          <button
            className={cn(
              "flex min-w-0 flex-1 items-center gap-0 border-0 bg-transparent py-0 text-left text-inherit outline-none transition-colors hover:bg-transparent focus-visible:z-1 focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              getSessionMainButtonPaddingClassName(showPinAction)
            )}
            onClick={handleClick}
            title={getSessionButtonTitle({
              diffLabel: diffMetaItem?.label,
              projectPath: session.projectPath
            })}
            type="button"
          >
            <div
              className={cn(
                "flex min-w-0 flex-1 text-left",
                getSessionTitleContainerLayoutClassName(showProjectDiffLine)
              )}
            >
              <span className="block max-w-full truncate leading-none">
                {getChatSessionTitle({
                  fallbackTitle: fallbackSessionTitle,
                  session
                })}
              </span>
              {showProjectDiffLine ? (
                <span className="block max-w-full truncate text-[12px] leading-none font-medium text-sidebar-foreground/50 tabular-nums">
                  {diffMetaItem?.label}
                </span>
              ) : null}
            </div>
            <div className="ml-2.5 flex shrink-0 items-center gap-2.5 leading-none">
              {diffMetaItem?.label ? (
                <SidebarGitStatusSummary gitStatus={session.gitStatus} />
              ) : null}
              <span
                className={cn(
                  SESSION_ROW_META_CLASS_NAME,
                  "min-w-8 text-right transition-opacity duration-150 group-hover/menu-item:opacity-0 group-focus-within/menu-item:opacity-0"
                )}
              >
                {timeMetaItem?.label ?? "\u00A0"}
              </span>
            </div>
          </button>
          <button
            aria-label={t("archiveSession")}
            className={cn(
              "absolute top-1/2 right-0 z-1 flex h-full w-8 -translate-y-1/2 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-sidebar-foreground outline-none transition-opacity duration-150",
              "pointer-events-none opacity-0",
              "group-hover/menu-item:pointer-events-auto group-hover/menu-item:opacity-100",
              "group-focus-within/menu-item:pointer-events-auto group-focus-within/menu-item:opacity-100",
              "hover:text-sidebar-accent-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-50"
            )}
            disabled={isArchiving}
            onClick={handleArchiveClick}
            title={t("archiveSession")}
            type="button"
          >
            <HugeiconsIcon className="size-3.5 shrink-0" icon={Archive02Icon} />
          </button>
        </div>
      </div>
    </SidebarMenuItem>
  )
}

const ProjectGroupSection = ({
  archivingSessionId,
  archivingProjectPath,
  collapsedProjectPaths,
  currentSessionId,
  draggingProjectPath,
  fallbackSessionTitle,
  group,
  onOpen,
  onShowLess,
  onShowMore,
  onArchive,
  onArchiveProjectChats,
  onOpenProjectInFileManager,
  onProjectDragEnd,
  onProjectDragOver,
  onProjectDragStart,
  onProjectDrop,
  onRemoveProject,
  onRenameProject,
  onToggleCollapsed,
  onToggleProjectPinned,
  onTogglePinned,
  openProjectInFileManagerLabel,
  removingProjectPath,
  renamingProjectPath,
  showLessLabel,
  showMoreLabel,
  settingPinnedProjectPath,
  toggleProjectGroupLabel,
  togglingPinnedSessionId,
  visibleCount
}: ProjectGroupSectionProps) => {
  const { t } = useI18n()
  const [confirmAction, setConfirmAction] = useState<
    "archive-chats" | "remove" | null
  >(null)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState(group.projectName)
  const expanded = isProjectGroupExpanded({
    collapsedProjectPaths,
    group
  })
  const isArchivingProject = archivingProjectPath === group.projectPath
  const isPinnedProject = Boolean(group.pinnedAt)
  const isDraggingProject = draggingProjectPath === group.projectPath
  const isRemovingProject = removingProjectPath === group.projectPath
  const isRenamingProject = renamingProjectPath === group.projectPath
  const isSettingPinnedProject = settingPinnedProjectPath === group.projectPath
  const disabledMenuKeys = getProjectMenuDisabledKeys({
    isArchivingProject,
    isRemovingProject,
    isRenamingProject,
    isSettingPinnedProject
  })
  const visibleSessions = getVisibleProjectGroupSessions({
    sessions: group.sessions,
    visibleCount
  })
  const hasHiddenSessions = hasHiddenProjectGroupSessions({
    sessions: group.sessions,
    visibleCount
  })
  const showLessAction = shouldShowProjectGroupLessAction({
    sessions: group.sessions,
    visibleCount
  })
  const handleToggleCollapsed = useCallback(() => {
    onToggleCollapsed(group.projectPath)
  }, [group.projectPath, onToggleCollapsed])
  const handleShowLess = useCallback(() => {
    onShowLess(group.projectPath)
  }, [group.projectPath, onShowLess])
  const handleShowMore = useCallback(() => {
    onShowMore(group.projectPath)
  }, [group.projectPath, onShowMore])
  const handleConfirmCancel = useCallback(() => {
    setConfirmAction(null)
  }, [])
  const handleConfirmProjectAction = useCallback(() => {
    if (confirmAction === "archive-chats") {
      onArchiveProjectChats(group.projectPath)
    }

    if (confirmAction === "remove") {
      onRemoveProject(group.projectPath)
    }

    setConfirmAction(null)
  }, [confirmAction, group.projectPath, onArchiveProjectChats, onRemoveProject])
  const handleMenuAction = useCallback(
    (key: Key) => {
      const action = String(key)

      if (action === "archive-chats") {
        setConfirmAction("archive-chats")
        return
      }

      if (action === "open-in-file-manager") {
        onOpenProjectInFileManager(group.projectPath)
        return
      }

      if (action === "remove") {
        setConfirmAction("remove")
        return
      }

      if (action === "rename-project") {
        setRenameDraft(group.projectName)
        setRenameDialogOpen(true)
        return
      }

      if (action === "toggle-pin") {
        onToggleProjectPinned(group.projectPath, !isPinnedProject)
      }
    },
    [
      group.projectName,
      group.projectPath,
      isPinnedProject,
      onOpenProjectInFileManager,
      onToggleProjectPinned
    ]
  )
  const handleRenameCancel = useCallback(() => {
    setRenameDialogOpen(false)
    setRenameDraft(group.projectName)
  }, [group.projectName])
  const handleRenameDraftChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setRenameDraft(event.target.value)
    },
    []
  )
  const handleRenameSubmit = useCallback(
    (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault()

      const nextDisplayName = renameDraft.trim()

      if (!nextDisplayName) {
        return
      }

      onRenameProject(group.projectPath, nextDisplayName)
      setRenameDialogOpen(false)
    },
    [group.projectPath, onRenameProject, renameDraft]
  )
  const confirmDescription =
    confirmAction === "remove"
      ? t("home.sidebar.projectMenu.removeDescription", {
          projectName: group.projectName
        })
      : t("home.sidebar.projectMenu.archiveChatsDescription", {
          projectName: group.projectName
        })
  const confirmTitle =
    confirmAction === "remove"
      ? t("home.sidebar.projectMenu.remove")
      : t("home.sidebar.projectMenu.archiveChats")

  return (
    <SidebarGroup
      className={cn("px-0 pb-3", isDraggingProject && "opacity-60")}
      key={group.projectPath}
      onDragEnd={onProjectDragEnd}
      onDragOver={(event) => {
        onProjectDragOver(event, group.projectPath)
      }}
      onDrop={(event) => {
        onProjectDrop(event, group.projectPath)
      }}
    >
      <div
        className={cn(
          PROJECT_GROUP_ROW_CLASS_NAME,
          "cursor-grab active:cursor-grabbing"
        )}
        draggable
        onDragStart={(event) => {
          onProjectDragStart(event, group.projectPath)
        }}
      >
        <button
          aria-label={`${toggleProjectGroupLabel}: ${group.projectName}`}
          className={PROJECT_GROUP_TOGGLE_CLASS_NAME}
          onClick={handleToggleCollapsed}
          type="button"
        >
          <HugeiconsIcon
            className={cn(
              "shrink-0 transition-colors",
              expanded
                ? "text-sidebar-foreground/92"
                : "text-sidebar-foreground/64"
            )}
            icon={expanded ? FolderOpenIcon : Folder01Icon}
            size={18}
            strokeWidth={2}
          />
          <SidebarGroupLabel className="h-auto min-w-0 flex-1 items-start px-0 py-0 text-inherit">
            <span className="truncate font-medium">{group.projectName}</span>
          </SidebarGroupLabel>
          {isPinnedProject ? (
            <HugeiconsIcon
              className="size-3.5 shrink-0 text-sidebar-foreground/50"
              icon={PinIcon}
              strokeWidth={2}
            />
          ) : null}
        </button>

        <Dropdown>
          <Button
            aria-label={t("home.sidebar.projectMenu.menuLabel", {
              projectName: group.projectName
            })}
            className={cn(
              "h-7 w-7 shrink-0 text-sidebar-foreground/56 transition-[opacity,transform,color] duration-150",
              "pointer-events-none translate-x-1 opacity-0",
              "group-hover/project-row:pointer-events-auto group-hover/project-row:translate-x-0 group-hover/project-row:opacity-100",
              "group-focus-within/project-row:pointer-events-auto group-focus-within/project-row:translate-x-0 group-focus-within/project-row:opacity-100",
              "focus-visible:pointer-events-auto focus-visible:translate-x-0 focus-visible:opacity-100",
              "hover:text-sidebar-accent-foreground"
            )}
            isIconOnly
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon
              icon={MoreHorizontalIcon}
              size={16}
              strokeWidth={2}
            />
          </Button>
          <Dropdown.Popover className="min-w-64 rounded-[1.35rem] border border-sidebar-border/70 bg-popover/95 p-1.5 text-popover-foreground shadow-[0_18px_44px_oklch(0_0_0/0.32)] backdrop-blur-xl">
            <Dropdown.Menu
              disabledKeys={disabledMenuKeys}
              onAction={handleMenuAction}
            >
              <Dropdown.Item
                id="toggle-pin"
                textValue={
                  isPinnedProject
                    ? t("home.sidebar.projectMenu.unpinProject")
                    : t("home.sidebar.projectMenu.pinProject")
                }
              >
                <HugeiconsIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  icon={isPinnedProject ? PinOffIcon : PinIcon}
                  strokeWidth={2}
                />
                <span>
                  {isPinnedProject
                    ? t("home.sidebar.projectMenu.unpinProject")
                    : t("home.sidebar.projectMenu.pinProject")}
                </span>
              </Dropdown.Item>
              <Dropdown.Item
                id="open-in-file-manager"
                textValue={openProjectInFileManagerLabel}
              >
                <HugeiconsIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  icon={FolderOpenIcon}
                  strokeWidth={2}
                />
                <span>{openProjectInFileManagerLabel}</span>
              </Dropdown.Item>
              <Dropdown.Item
                id="rename-project"
                textValue={t("home.sidebar.projectMenu.renameProject")}
              >
                <HugeiconsIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  icon={PencilEdit02Icon}
                  strokeWidth={2}
                />
                <span>{t("home.sidebar.projectMenu.renameProject")}</span>
              </Dropdown.Item>
              <Separator className="my-1" />
              <Dropdown.Item
                id="archive-chats"
                textValue={t("home.sidebar.projectMenu.archiveChats")}
              >
                <HugeiconsIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  icon={Archive02Icon}
                  strokeWidth={2}
                />
                <span>{t("home.sidebar.projectMenu.archiveChats")}</span>
              </Dropdown.Item>
              <Dropdown.Item
                id="remove"
                textValue={t("home.sidebar.projectMenu.remove")}
                variant="danger"
              >
                <HugeiconsIcon
                  className="size-4 shrink-0 text-danger"
                  icon={Delete02Icon}
                  strokeWidth={2}
                />
                <span>{t("home.sidebar.projectMenu.remove")}</span>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>

      {expanded ? (
        <>
          <SidebarMenu className="title-bar-no-drag mt-1.5 space-y-1">
            {visibleSessions.map((session) => (
              <ChatSessionItem
                currentSessionId={currentSessionId}
                archivingSessionId={archivingSessionId}
                fallbackSessionTitle={fallbackSessionTitle}
                key={session.id}
                layout="project"
                onArchive={onArchive}
                onOpen={onOpen}
                onTogglePinned={onTogglePinned}
                session={session}
                showPinAction
                togglingPinnedSessionId={togglingPinnedSessionId}
              />
            ))}
          </SidebarMenu>

          {hasHiddenSessions || showLessAction ? (
            <button
              className="title-bar-no-drag mt-1 ml-11 text-left text-[13px] font-medium text-sidebar-foreground/56 transition-colors hover:text-sidebar-accent-foreground"
              onClick={hasHiddenSessions ? handleShowMore : handleShowLess}
              type="button"
            >
              {hasHiddenSessions ? showMoreLabel : showLessLabel}
            </button>
          ) : null}
        </>
      ) : null}

      <Dialog onOpenChange={setRenameDialogOpen} open={renameDialogOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <form className="space-y-4" onSubmit={handleRenameSubmit}>
            <DialogHeader>
              <DialogTitle>
                {t("home.sidebar.projectMenu.renameTitle")}
              </DialogTitle>
              <DialogDescription>{group.projectPath}</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              onChange={handleRenameDraftChange}
              placeholder={t("home.sidebar.projectMenu.renamePlaceholder")}
              value={renameDraft}
            />
            <DialogFooter>
              <Button
                onPress={handleRenameCancel}
                type="button"
                variant="outline"
              >
                {t("settings.common.cancel")}
              </Button>
              <Button
                isDisabled={!renameDraft.trim() || isRenamingProject}
                type="submit"
              >
                {t("settings.common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={() => setConfirmAction(null)}
        open={confirmAction !== null}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onPress={handleConfirmCancel}
              type="button"
              variant="outline"
            >
              {t("settings.common.cancel")}
            </Button>
            <Button
              isDisabled={isArchivingProject || isRemovingProject}
              onPress={handleConfirmProjectAction}
              type="button"
              variant={confirmAction === "remove" ? "danger-soft" : "primary"}
            >
              {confirmAction === "remove"
                ? t("home.sidebar.projectMenu.removeConfirm")
                : t("home.sidebar.projectMenu.archiveChatsConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarGroup>
  )
}

const ProjectGroupsSection = ({
  addProjectLabel,
  archivingSessionId,
  archivingProjectPath,
  collapsedProjectPaths,
  currentSessionId,
  emptyProjectsLabel,
  fallbackSessionTitle,
  groups,
  isCreatingProjectChatSession,
  onArchive,
  onArchiveProjectChats,
  onCreateProjectChatSession,
  onOpenProjectInFileManager,
  onOpen,
  onReorderProjects,
  onRemoveProject,
  onRenameProject,
  onShowLess,
  onShowMore,
  onToggleCollapsed,
  onToggleProjectPinned,
  onTogglePinned,
  openProjectInFileManagerLabel,
  projectCount,
  projectsCountLabel,
  projectsLabel,
  removingProjectPath,
  renamingProjectPath,
  settingPinnedProjectPath,
  sessionCount,
  showLessLabel,
  showMoreLabel,
  toggleProjectGroupLabel,
  togglingPinnedSessionId,
  visibleCountForProject
}: ProjectGroupsSectionProps) => {
  const [draggingProjectPath, setDraggingProjectPath] = useState<string | null>(
    null
  )
  const handleProjectDragEnd = useCallback(() => {
    setDraggingProjectPath(null)
  }, [])
  const handleProjectDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, projectPath: string) => {
      if (!draggingProjectPath || draggingProjectPath === projectPath) {
        return
      }

      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
    },
    [draggingProjectPath]
  )
  const handleProjectDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, projectPath: string) => {
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData("text/plain", projectPath)
      setDraggingProjectPath(projectPath)
    },
    []
  )
  const handleProjectDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, overProjectPath: string) => {
      event.preventDefault()

      const activeProjectPath =
        draggingProjectPath || event.dataTransfer.getData("text/plain")

      if (!activeProjectPath || activeProjectPath === overProjectPath) {
        setDraggingProjectPath(null)
        return
      }

      onReorderProjects(
        reorderProjectPaths({
          activeProjectPath,
          overProjectPath,
          projectPaths: groups.map((group) => group.projectPath)
        })
      )
      setDraggingProjectPath(null)
    },
    [draggingProjectPath, groups, onReorderProjects]
  )
  const sectionContent =
    groups.length > 0 ? (
      <div className="mt-1">
        {groups.map((group) => (
          <ProjectGroupSection
            archivingSessionId={archivingSessionId}
            archivingProjectPath={archivingProjectPath}
            collapsedProjectPaths={collapsedProjectPaths}
            currentSessionId={currentSessionId}
            draggingProjectPath={draggingProjectPath ?? undefined}
            fallbackSessionTitle={fallbackSessionTitle}
            group={group}
            key={group.projectPath}
            onArchive={onArchive}
            onArchiveProjectChats={onArchiveProjectChats}
            onOpen={onOpen}
            onOpenProjectInFileManager={onOpenProjectInFileManager}
            onProjectDragEnd={handleProjectDragEnd}
            onProjectDragOver={handleProjectDragOver}
            onProjectDragStart={handleProjectDragStart}
            onProjectDrop={handleProjectDrop}
            onRemoveProject={onRemoveProject}
            onRenameProject={onRenameProject}
            onShowLess={onShowLess}
            onShowMore={onShowMore}
            onToggleCollapsed={onToggleCollapsed}
            onToggleProjectPinned={onToggleProjectPinned}
            onTogglePinned={onTogglePinned}
            openProjectInFileManagerLabel={openProjectInFileManagerLabel}
            removingProjectPath={removingProjectPath}
            renamingProjectPath={renamingProjectPath}
            settingPinnedProjectPath={settingPinnedProjectPath}
            showLessLabel={showLessLabel}
            showMoreLabel={showMoreLabel}
            toggleProjectGroupLabel={toggleProjectGroupLabel}
            togglingPinnedSessionId={togglingPinnedSessionId}
            visibleCount={visibleCountForProject(group.projectPath)}
          />
        ))}
      </div>
    ) : (
      <div className={PROJECTS_SECTION_EMPTY_CLASS_NAME}>
        {emptyProjectsLabel}
      </div>
    )
  const addProjectButton = (
    <Button
      aria-label={addProjectLabel}
      className={cn(
        "text-sidebar-foreground/56 transition-[opacity,transform,color] duration-200",
        "pointer-events-none translate-x-1 opacity-0",
        "group-hover/projects-header:pointer-events-auto group-hover/projects-header:translate-x-0 group-hover/projects-header:opacity-100",
        "group-focus-within/projects-header:pointer-events-auto group-focus-within/projects-header:translate-x-0 group-focus-within/projects-header:opacity-100",
        "focus-visible:pointer-events-auto focus-visible:translate-x-0 focus-visible:opacity-100",
        "hover:text-sidebar-accent-foreground"
      )}
      isDisabled={isCreatingProjectChatSession}
      isIconOnly
      onPress={onCreateProjectChatSession}
      size="sm"
      variant="ghost"
    >
      <HugeiconsIcon icon={FileAddIcon} size={16} strokeWidth={2} />
    </Button>
  )

  return (
    <SidebarGroup className="px-3 pb-3">
      <div className={PROJECTS_SECTION_HEADER_CLASS_NAME}>
        <div className="flex min-w-0 flex-1 items-center px-1.5 py-1">
          <span className="min-w-0 truncate text-[11px] font-semibold tracking-[0.22em] text-sidebar-foreground/54 uppercase">
            {projectsLabel}
          </span>
        </div>

        {isCreatingProjectChatSession ? (
          addProjectButton
        ) : (
          <Tooltip>
            <TooltipTrigger render={addProjectButton} />
            <TooltipContent side="bottom">{addProjectLabel}</TooltipContent>
          </Tooltip>
        )}

        <div
          aria-label={projectsCountLabel}
          className="rounded-[0.875rem] border border-sidebar-border/50 bg-sidebar-foreground/5 px-2.5 py-1 text-[11px] font-medium text-sidebar-foreground/58 tabular-nums"
          title={projectsCountLabel}
        >
          {projectCount} / {sessionCount}
        </div>
      </div>

      {sectionContent}
    </SidebarGroup>
  )
}

export const AppSidebar = () => {
  const { t } = useI18n({ keyPrefix: "home" })
  const {
    currentSessionId,
    handleArchiveChatSession,
    handleArchiveProjectChats,
    handleCreateChatSession,
    handleCreateProjectChatSession,
    handleOpenChatSession,
    handleOpenProjectInFileManager,
    handleRemoveProject,
    handleSetChatSessionPinned,
    isArchivingChatSessionId,
    isArchivingProjectPath,
    isCreatingChatSession,
    isRemovingProjectPath,
    isSettingPinnedChatSessionId
  } = useChatSessionActions()
  const {
    collapsedProjectPaths,
    handleRenameProject,
    handleSetProjectOrder,
    handleSetProjectPinned,
    handleToggleProjectCollapsed,
    isRenamingProjectPath,
    isSidebarStateReady,
    isSettingPinnedProjectPath,
    persistSidebarWidth,
    projectDisplayNames,
    projectOrder,
    projectPins,
    setSidebarWidthLocally,
    sidebarWidthPx
  } = useProjectSidebarState()
  const chatSessionsQuery = useQuery({
    ...orpc.chatSessions.list.queryOptions({}),
    refetchInterval: CHAT_SESSIONS_STATUS_REFETCH_INTERVAL_MS
  })
  const settingsQuery = useQuery(orpc.settings.get.queryOptions({}))
  const [projectVisibleCounts, setProjectVisibleCounts] = useState<
    Record<string, number>
  >({})
  const chatSessions = chatSessionsQuery.data ?? []
  const isProjectsMode = isProjectsSidebarMode(
    settingsQuery.data?.sidebar.mode ?? "simple"
  )
  const chatSessionGroups = groupChatSessionsByProject(chatSessions, {
    projectDisplayNames,
    projectOrder,
    projectPins
  })
  const projectSessionCount = chatSessionGroups.reduce(
    (total, group) => total + group.sessions.length,
    0
  )
  const pinnedChatSessions = sortPinnedChatSessions(chatSessions)
  const fallbackSessionTitle = t("actions.newChat")
  const openProjectInFileManagerLabel = (() => {
    if (window.electron.process.platform === "darwin") {
      return t("sidebar.projectMenu.openInFinder")
    }

    if (window.electron.process.platform === "win32") {
      return t("sidebar.projectMenu.openInExplorer")
    }

    return t("sidebar.projectMenu.openInFileManager")
  })()
  const handleShowLessProjectSessions = useCallback((projectPath: string) => {
    setProjectVisibleCounts((prev) => ({
      ...prev,
      [projectPath]: PROJECT_GROUP_PAGE_SIZE
    }))
  }, [])
  const handleShowMoreProjectSessions = useCallback((projectPath: string) => {
    setProjectVisibleCounts((prev) => ({
      ...prev,
      [projectPath]:
        (prev[projectPath] ?? PROJECT_GROUP_PAGE_SIZE) + PROJECT_GROUP_PAGE_SIZE
    }))
  }, [])
  const getVisibleCountForProject = useCallback(
    (projectPath: string) =>
      projectVisibleCounts[projectPath] ?? PROJECT_GROUP_PAGE_SIZE,
    [projectVisibleCounts]
  )

  const searchButton = (
    <Button
      aria-label={t("sidebar.search")}
      isIconOnly
      size="lg"
      variant="ghost"
    >
      <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
    </Button>
  )

  const newChatButton = (
    <Button
      aria-label={t("actions.newChat")}
      isDisabled={isCreatingChatSession}
      isIconOnly
      onPress={handleCreateChatSession}
      size="lg"
      variant="ghost"
    >
      <HugeiconsIcon icon={NoteEditIcon} strokeWidth={2} />
    </Button>
  )

  const sidebarContent = (() => {
    if (
      chatSessionsQuery.isPending ||
      (isProjectsMode && !isSidebarStateReady)
    ) {
      return (
        <SidebarGroup className="px-3 pb-3">
          <SidebarMenu className="title-bar-no-drag">
            <SidebarMenuSkeleton showIcon />
            <SidebarMenuSkeleton showIcon />
            <SidebarMenuSkeleton showIcon />
          </SidebarMenu>
        </SidebarGroup>
      )
    }

    if (!isProjectsMode && chatSessions.length === 0) {
      return (
        <SidebarGroup className="px-3 pb-3">
          <div className="title-bar-no-drag rounded-xl border border-dashed border-sidebar-border/80 px-3 py-4 text-xs text-sidebar-foreground/70">
            {t("sidebar.empty")}
          </div>
        </SidebarGroup>
      )
    }

    if (!isProjectsMode) {
      return (
        <SidebarGroup className="px-3 pb-3">
          <SidebarMenu className="title-bar-no-drag space-y-1">
            {chatSessions.map((session) => (
              <ChatSessionItem
                archivingSessionId={isArchivingChatSessionId}
                currentSessionId={currentSessionId}
                fallbackSessionTitle={fallbackSessionTitle}
                key={session.id}
                onArchive={handleArchiveChatSession}
                onOpen={handleOpenChatSession}
                session={session}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      )
    }

    return (
      <>
        {pinnedChatSessions.length > 0 ? (
          <SidebarGroup className="px-3 pb-3">
            <SidebarGroupLabel className="h-auto items-start px-1 py-0 text-[11px] font-semibold tracking-[0.16em] text-sidebar-foreground/42 uppercase">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={PinIcon} size={14} strokeWidth={2} />
                <span>{t("sidebar.pinnedThreads")}</span>
              </div>
            </SidebarGroupLabel>
            <SidebarMenu className="title-bar-no-drag mt-2 space-y-1">
              {pinnedChatSessions.map((session) => (
                <ChatSessionItem
                  archivingSessionId={isArchivingChatSessionId}
                  currentSessionId={currentSessionId}
                  fallbackSessionTitle={fallbackSessionTitle}
                  key={session.id}
                  layout="project"
                  onArchive={handleArchiveChatSession}
                  onOpen={handleOpenChatSession}
                  onTogglePinned={handleSetChatSessionPinned}
                  session={session}
                  showPinAction
                  togglingPinnedSessionId={isSettingPinnedChatSessionId}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        <ProjectGroupsSection
          addProjectLabel={t("sidebar.addProject")}
          archivingSessionId={isArchivingChatSessionId}
          archivingProjectPath={isArchivingProjectPath}
          collapsedProjectPaths={collapsedProjectPaths}
          currentSessionId={currentSessionId}
          emptyProjectsLabel={t("sidebar.emptyProjects")}
          fallbackSessionTitle={fallbackSessionTitle}
          groups={chatSessionGroups}
          isCreatingProjectChatSession={isCreatingChatSession}
          onArchive={handleArchiveChatSession}
          onArchiveProjectChats={handleArchiveProjectChats}
          onCreateProjectChatSession={handleCreateProjectChatSession}
          onOpen={handleOpenChatSession}
          onOpenProjectInFileManager={handleOpenProjectInFileManager}
          onReorderProjects={handleSetProjectOrder}
          onRemoveProject={handleRemoveProject}
          onRenameProject={handleRenameProject}
          onShowLess={handleShowLessProjectSessions}
          onShowMore={handleShowMoreProjectSessions}
          onToggleCollapsed={handleToggleProjectCollapsed}
          onToggleProjectPinned={handleSetProjectPinned}
          onTogglePinned={handleSetChatSessionPinned}
          openProjectInFileManagerLabel={openProjectInFileManagerLabel}
          projectCount={chatSessionGroups.length}
          projectsCountLabel={t("sidebar.projectsCount", {
            projectCount: chatSessionGroups.length,
            sessionCount: projectSessionCount
          })}
          projectsLabel={t("sidebar.projects")}
          removingProjectPath={isRemovingProjectPath}
          renamingProjectPath={isRenamingProjectPath}
          settingPinnedProjectPath={isSettingPinnedProjectPath}
          sessionCount={projectSessionCount}
          showLessLabel={t("sidebar.showLess")}
          showMoreLabel={t("sidebar.showMore")}
          toggleProjectGroupLabel={t("sidebar.toggleProjectGroup")}
          togglingPinnedSessionId={isSettingPinnedChatSessionId}
          visibleCountForProject={getVisibleCountForProject}
        />
      </>
    )
  })()

  return (
    <AppSidebarShell
      headerContent={
        <>
          <SidebarTrigger aria-label={t("sidebar.toggleSidebar")} />

          <Tooltip>
            <TooltipTrigger render={searchButton} />
            <TooltipContent side="bottom">{t("sidebar.search")}</TooltipContent>
          </Tooltip>

          {isCreatingChatSession ? (
            newChatButton
          ) : (
            <Tooltip>
              <TooltipTrigger render={newChatButton} />
              <TooltipContent side="bottom">
                {t("actions.newChat")}
              </TooltipContent>
            </Tooltip>
          )}
        </>
      }
      onSidebarResizeCommit={persistSidebarWidth}
      onSidebarResizePreview={setSidebarWidthLocally}
      sidebarWidthPx={sidebarWidthPx}
    >
      {sidebarContent}
    </AppSidebarShell>
  )
}
