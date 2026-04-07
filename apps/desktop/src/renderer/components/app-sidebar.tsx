import { useI18n } from "@etyon/i18n/react"
import type { ChatSessionSummary } from "@etyon/rpc"
import { Button } from "@etyon/ui/components/button"
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
import {
  Archive02Icon,
  FileAddIcon,
  Folder01Icon,
  FolderOpenIcon,
  NoteEditIcon,
  PinIcon,
  PinOffIcon,
  Search01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import type {
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode
} from "react"

import { orpc } from "@/renderer/lib/rpc"
import {
  getChatSessionTitle,
  getChatSessionMetaItems,
  getVisibleProjectGroupSessions,
  groupChatSessionsByProject,
  hasHiddenProjectGroupSessions,
  isProjectGroupExpanded,
  isProjectsSidebarMode,
  PROJECT_GROUP_PAGE_SIZE,
  shouldShowProjectGroupLessAction,
  sortPinnedChatSessions
} from "@/renderer/lib/sidebar/chat-sessions"
import { useChatSessionActions } from "@/renderer/lib/sidebar/use-chat-session-actions"
import {
  SIDEBAR_WIDTH_PX_MAX,
  SIDEBAR_WIDTH_PX_MIN,
  useProjectSidebarState
} from "@/renderer/lib/sidebar/use-project-sidebar-state"

const EXPAND_EASE = [0.25, 1, 0.5, 1] as const
const EXPAND_RESET_DELAY_MS = 520
const PROJECT_GROUP_ROW_CLASS_NAME =
  "title-bar-no-drag -mx-1 flex h-10 w-full items-center gap-3 rounded-xl px-2 text-left text-[15px] font-medium text-sidebar-foreground/82 transition-[background-color,color] hover:bg-white/4 hover:text-sidebar-accent-foreground"
const PROJECTS_SECTION_EMPTY_CLASS_NAME =
  "title-bar-no-drag mt-2 rounded-[1.25rem] border border-dashed border-sidebar-border/70 bg-white/[0.03] px-4 py-4 text-[12px] leading-5 text-sidebar-foreground/68"
const PROJECTS_SECTION_HEADER_CLASS_NAME =
  "title-bar-no-drag group/projects-header flex items-center gap-1 rounded-[1.125rem] px-1 py-1.5 transition-[background-color,color] hover:bg-white/[0.03] focus-within:bg-white/[0.03]"
const SESSION_ROW_CLASS_NAME =
  "h-10.5 items-center rounded-[1.125rem] px-3 py-0 text-[14px] font-medium text-sidebar-foreground/86 transition-[background-color,color] hover:bg-white/5 hover:text-sidebar-accent-foreground data-[active=true]:bg-white/7 data-[active=true]:text-sidebar-accent-foreground"
const SESSION_ROW_META_CLASS_NAME =
  "shrink-0 text-[14px] leading-none font-medium tabular-nums text-sidebar-foreground/58"

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
  currentSessionId?: string
  fallbackSessionTitle: string
  onOpen: (sessionId: string) => void
  onTogglePinned?: (sessionId: string, pinned: boolean) => void
  session: ChatSessionSummary
  showPinAction?: boolean
  togglingPinnedSessionId?: string
}

interface ProjectGroupSectionProps {
  collapsedProjectPaths: string[]
  currentSessionId?: string
  fallbackSessionTitle: string
  group: {
    projectName: string
    projectPath: string
    sessions: ChatSessionSummary[]
  }
  onOpen: (sessionId: string) => void
  onShowLess: (projectPath: string) => void
  onShowMore: (projectPath: string) => void
  onToggleCollapsed: (projectPath: string) => void
  onTogglePinned: (sessionId: string, pinned: boolean) => void
  showLessLabel: string
  showMoreLabel: string
  toggleProjectGroupLabel: string
  togglingPinnedSessionId?: string
  visibleCount: number
}

interface ProjectGroupsSectionProps {
  addProjectLabel: string
  collapsedProjectPaths: string[]
  currentSessionId?: string
  emptyProjectsLabel: string
  fallbackSessionTitle: string
  groups: {
    projectName: string
    projectPath: string
    sessions: ChatSessionSummary[]
  }[]
  isCreatingProjectChatSession: boolean
  onCreateProjectChatSession: () => void
  onOpen: (sessionId: string) => void
  onShowLess: (projectPath: string) => void
  onShowMore: (projectPath: string) => void
  onToggleCollapsed: (projectPath: string) => void
  onTogglePinned: (sessionId: string, pinned: boolean) => void
  projectCount: number
  projectsCountLabel: string
  projectsLabel: string
  sessionCount: number
  showLessLabel: string
  showMoreLabel: string
  toggleProjectGroupLabel: string
  togglingPinnedSessionId?: string
  visibleCountForProject: (projectPath: string) => number
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
        <div
          aria-label="Resize sidebar"
          className="title-bar-no-drag absolute top-0 right-0 z-30 h-full w-3 cursor-col-resize after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-sidebar-border/50 after:transition-colors hover:after:bg-sidebar-accent-foreground/28"
          onPointerDown={handleSidebarResizePointerDown}
          role="separator"
        />
      ) : null}
    </Sidebar>
  )
}

const ChatSessionItem = ({
  currentSessionId,
  fallbackSessionTitle,
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
  const isPinned = Boolean(session.pinnedAt)
  const isTogglingPinned = togglingPinnedSessionId === session.id
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
    },
    []
  )

  const isRowActive = currentSessionId === session.id

  return (
    <SidebarMenuItem>
      <div
        className={cn(
          SESSION_ROW_CLASS_NAME,
          "flex w-full items-center gap-0 overflow-hidden py-0",
          showPinAction ? "px-0" : "px-3"
        )}
        data-active={isRowActive ? true : undefined}
      >
        {showPinAction ? (
          <button
            aria-label={isPinned ? t("unpinSession") : t("pinSession")}
            className={cn(
              "flex min-h-10.5 w-9 shrink-0 items-center justify-center rounded-none border-0 bg-transparent p-0 text-sidebar-foreground/70 outline-none transition-[opacity,color] duration-150 hover:bg-white/5 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50",
              "pointer-events-none opacity-0",
              "group-hover/menu-item:pointer-events-auto group-hover/menu-item:opacity-100",
              "group-focus-within/menu-item:pointer-events-auto group-focus-within/menu-item:opacity-100",
              "focus-visible:pointer-events-auto focus-visible:opacity-100"
            )}
            disabled={isTogglingPinned}
            onClick={handleTogglePinned}
            title={isPinned ? t("unpinSession") : t("pinSession")}
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
              showPinAction ? "pl-1 pr-0" : "px-0"
            )}
            onClick={handleClick}
            title={session.projectPath}
            type="button"
          >
            <div className="flex min-w-0 flex-1 items-center text-left leading-none">
              <span className="block truncate leading-none">
                {getChatSessionTitle({
                  fallbackTitle: fallbackSessionTitle,
                  session
                })}
              </span>
            </div>
            <div className="ml-2.5 flex shrink-0 items-center gap-2.5 leading-none">
              {diffMetaItem?.label ? (
                <span
                  className={cn(
                    SESSION_ROW_META_CLASS_NAME,
                    "min-w-17 text-right"
                  )}
                >
                  {diffMetaItem.label}
                </span>
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
              "hover:text-sidebar-accent-foreground focus-visible:pointer-events-auto focus-visible:opacity-100"
            )}
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
  collapsedProjectPaths,
  currentSessionId,
  fallbackSessionTitle,
  group,
  onOpen,
  onShowLess,
  onShowMore,
  onToggleCollapsed,
  onTogglePinned,
  showLessLabel,
  showMoreLabel,
  toggleProjectGroupLabel,
  togglingPinnedSessionId,
  visibleCount
}: ProjectGroupSectionProps) => {
  const expanded = isProjectGroupExpanded({
    collapsedProjectPaths,
    currentSessionId,
    group
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

  return (
    <SidebarGroup className="px-0 pb-3" key={group.projectPath}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={`${toggleProjectGroupLabel}: ${group.projectName}`}
              className={PROJECT_GROUP_ROW_CLASS_NAME}
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
              <SidebarGroupLabel className="h-auto min-w-0 items-start px-0 py-0 text-inherit">
                <span className="truncate font-medium">
                  {group.projectName}
                </span>
              </SidebarGroupLabel>
            </button>
          }
        />
        <TooltipContent side="right">{group.projectPath}</TooltipContent>
      </Tooltip>

      {expanded ? (
        <>
          <SidebarMenu className="title-bar-no-drag mt-1.5 space-y-1">
            {visibleSessions.map((session) => (
              <ChatSessionItem
                currentSessionId={currentSessionId}
                fallbackSessionTitle={fallbackSessionTitle}
                key={session.id}
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
    </SidebarGroup>
  )
}

const ProjectGroupsSection = ({
  addProjectLabel,
  collapsedProjectPaths,
  currentSessionId,
  emptyProjectsLabel,
  fallbackSessionTitle,
  groups,
  isCreatingProjectChatSession,
  onCreateProjectChatSession,
  onOpen,
  onShowLess,
  onShowMore,
  onToggleCollapsed,
  onTogglePinned,
  projectCount,
  projectsCountLabel,
  projectsLabel,
  sessionCount,
  showLessLabel,
  showMoreLabel,
  toggleProjectGroupLabel,
  togglingPinnedSessionId,
  visibleCountForProject
}: ProjectGroupsSectionProps) => {
  const sectionContent =
    groups.length > 0 ? (
      <div className="mt-1">
        {groups.map((group) => (
          <ProjectGroupSection
            collapsedProjectPaths={collapsedProjectPaths}
            currentSessionId={currentSessionId}
            fallbackSessionTitle={fallbackSessionTitle}
            group={group}
            key={group.projectPath}
            onOpen={onOpen}
            onShowLess={onShowLess}
            onShowMore={onShowMore}
            onToggleCollapsed={onToggleCollapsed}
            onTogglePinned={onTogglePinned}
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

  return (
    <SidebarGroup className="px-3 pb-3">
      <div className={PROJECTS_SECTION_HEADER_CLASS_NAME}>
        <div className="flex min-w-0 flex-1 items-center px-1.5 py-1">
          <span className="min-w-0 truncate text-[11px] font-semibold tracking-[0.22em] text-sidebar-foreground/54 uppercase">
            {projectsLabel}
          </span>
        </div>

        <Tooltip>
          <TooltipTrigger
            render={
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
                disabled={isCreatingProjectChatSession}
                onClick={onCreateProjectChatSession}
                size="icon-sm"
                title={addProjectLabel}
                variant="ghost"
              >
                <HugeiconsIcon icon={FileAddIcon} size={16} strokeWidth={2} />
              </Button>
            }
          />
          <TooltipContent side="bottom">{addProjectLabel}</TooltipContent>
        </Tooltip>

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
    handleCreateChatSession,
    handleCreateProjectChatSession,
    handleOpenChatSession,
    handleSetChatSessionPinned,
    isCreatingChatSession,
    isSettingPinnedChatSessionId
  } = useChatSessionActions()
  const {
    collapsedProjectPaths,
    handleToggleProjectCollapsed,
    isSidebarStateReady,
    persistSidebarWidth,
    setSidebarWidthLocally,
    sidebarWidthPx
  } = useProjectSidebarState()
  const chatSessionsQuery = useQuery(orpc.chatSessions.list.queryOptions({}))
  const settingsQuery = useQuery(orpc.settings.get.queryOptions({}))
  const [projectVisibleCounts, setProjectVisibleCounts] = useState<
    Record<string, number>
  >({})
  const chatSessions = chatSessionsQuery.data ?? []
  const isProjectsMode = isProjectsSidebarMode(
    settingsQuery.data?.sidebar.mode ?? "simple"
  )
  const chatSessionGroups = groupChatSessionsByProject(chatSessions)
  const projectSessionCount = chatSessionGroups.reduce(
    (total, group) => total + group.sessions.length,
    0
  )
  const pinnedChatSessions = sortPinnedChatSessions(chatSessions)
  const fallbackSessionTitle = t("actions.newChat")
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
    <Button aria-label={t("sidebar.search")} size="icon-lg" variant="ghost">
      <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
    </Button>
  )

  const newChatButton = (
    <Button
      aria-label={t("actions.newChat")}
      disabled={isCreatingChatSession}
      onClick={handleCreateChatSession}
      size="icon-lg"
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
                currentSessionId={currentSessionId}
                fallbackSessionTitle={fallbackSessionTitle}
                key={session.id}
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
                  currentSessionId={currentSessionId}
                  fallbackSessionTitle={fallbackSessionTitle}
                  key={session.id}
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
          collapsedProjectPaths={collapsedProjectPaths}
          currentSessionId={currentSessionId}
          emptyProjectsLabel={t("sidebar.emptyProjects")}
          fallbackSessionTitle={fallbackSessionTitle}
          groups={chatSessionGroups}
          isCreatingProjectChatSession={isCreatingChatSession}
          onCreateProjectChatSession={handleCreateProjectChatSession}
          onOpen={handleOpenChatSession}
          onShowLess={handleShowLessProjectSessions}
          onShowMore={handleShowMoreProjectSessions}
          onToggleCollapsed={handleToggleProjectCollapsed}
          onTogglePinned={handleSetChatSessionPinned}
          projectCount={chatSessionGroups.length}
          projectsCountLabel={t("sidebar.projectsCount", {
            projectCount: chatSessionGroups.length,
            sessionCount: projectSessionCount
          })}
          projectsLabel={t("sidebar.projects")}
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

          <Tooltip>
            <TooltipTrigger render={newChatButton} />
            <TooltipContent side="bottom">
              {t("actions.newChat")}
            </TooltipContent>
          </Tooltip>
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
