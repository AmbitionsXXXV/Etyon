import { useI18n } from "@etyon/i18n/react"
import type { ChatSessionSummary } from "@etyon/rpc"
import { Button } from "@etyon/ui/components/button"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuButton,
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
  ArrowDown01Icon,
  ArrowRight01Icon,
  Folder01Icon,
  NoteEditIcon,
  PinIcon,
  PinOffIcon,
  Search01Icon
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { MouseEvent, ReactNode } from "react"

import { orpc } from "@/renderer/lib/rpc"
import {
  getChatSessionTitle,
  getChatSessionMetaItems,
  getProjectNameFromPath,
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
import { useProjectSidebarState } from "@/renderer/lib/sidebar/use-project-sidebar-state"

const EXPAND_EASE = [0.25, 1, 0.5, 1] as const
const EXPAND_RESET_DELAY_MS = 520

interface AppSidebarShellProps {
  children?: ReactNode
  contentClassName?: string
  headerClassName?: string
  headerContent: ReactNode
}

interface ChatSessionItemProps {
  currentSessionId?: string
  fallbackSessionTitle: string
  onOpen: (sessionId: string) => void
  onTogglePinned?: (sessionId: string, pinned: boolean) => void
  projectLabel?: string
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

export const AppSidebarShell = ({
  children,
  contentClassName,
  headerClassName,
  headerContent
}: AppSidebarShellProps) => {
  const { state } = useSidebar()
  const expandResetTimeoutRef = useRef<number | null>(null)
  const prevStateRef = useRef(state)
  const [expanding, setExpanding] = useState(false)

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
    </Sidebar>
  )
}

const ChatSessionItem = ({
  currentSessionId,
  fallbackSessionTitle,
  onOpen,
  onTogglePinned,
  projectLabel,
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

  return (
    <SidebarMenuItem key={session.id}>
      <SidebarMenuButton
        className={cn("h-auto items-start py-2", showPinAction && "pr-8")}
        isActive={currentSessionId === session.id}
        onClick={handleClick}
        title={session.projectPath}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-left font-medium">
            {getChatSessionTitle({
              fallbackTitle: fallbackSessionTitle,
              session
            })}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-sidebar-foreground/60">
            {projectLabel ? (
              <span className="truncate">{projectLabel}</span>
            ) : (
              <span />
            )}
            <div className="flex shrink-0 items-center gap-2">
              <span className="inline-flex min-w-[2.5rem] justify-end">
                {diffMetaItem?.label ?? ""}
              </span>
              <span className="inline-flex min-w-[2rem] justify-end">
                {timeMetaItem?.label ?? ""}
              </span>
            </div>
          </div>
        </div>
      </SidebarMenuButton>
      {showPinAction ? (
        <SidebarMenuAction
          aria-label={isPinned ? t("unpinSession") : t("pinSession")}
          disabled={isTogglingPinned}
          onClick={handleTogglePinned}
          showOnHover
          title={isPinned ? t("unpinSession") : t("pinSession")}
        >
          <HugeiconsIcon icon={isPinned ? PinOffIcon : PinIcon} />
        </SidebarMenuAction>
      ) : null}
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
    <SidebarGroup className="px-3 pb-3" key={group.projectPath}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={`${toggleProjectGroupLabel}: ${group.projectName}`}
              className="title-bar-no-drag flex w-full items-center gap-2 rounded-lg px-0 py-0 text-left text-sidebar-foreground/90 transition-colors hover:text-sidebar-accent-foreground"
              onClick={handleToggleCollapsed}
              type="button"
            >
              <HugeiconsIcon
                icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
                size={16}
                strokeWidth={2}
              />
              <HugeiconsIcon icon={Folder01Icon} size={16} strokeWidth={2} />
              <SidebarGroupLabel className="h-auto min-w-0 items-start px-0 py-0 text-sidebar-foreground/90">
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
          <SidebarMenu className="title-bar-no-drag mt-2">
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
              className="title-bar-no-drag mt-1 ml-2 text-left text-xs text-sidebar-foreground/60 transition-colors hover:text-sidebar-accent-foreground"
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

export const AppSidebar = () => {
  const { t } = useI18n({ keyPrefix: "home" })
  const {
    currentSessionId,
    handleCreateChatSession,
    handleOpenChatSession,
    handleSetChatSessionPinned,
    isCreatingChatSession,
    isSettingPinnedChatSessionId
  } = useChatSessionActions()
  const {
    collapsedProjectPaths,
    handleToggleProjectCollapsed,
    isSidebarStateReady
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

    if (chatSessions.length === 0) {
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
          <SidebarMenu className="title-bar-no-drag">
            {chatSessions.map((session) => (
              <ChatSessionItem
                currentSessionId={currentSessionId}
                fallbackSessionTitle={fallbackSessionTitle}
                key={session.id}
                onOpen={handleOpenChatSession}
                projectLabel={getProjectNameFromPath(session.projectPath)}
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
            <SidebarGroupLabel className="h-auto items-start px-0 py-0 text-sidebar-foreground/90">
              <div className="flex items-center gap-2 font-medium">
                <HugeiconsIcon icon={PinIcon} size={16} strokeWidth={2} />
                <span>{t("sidebar.pinnedThreads")}</span>
              </div>
            </SidebarGroupLabel>
            <SidebarMenu className="title-bar-no-drag mt-2">
              {pinnedChatSessions.map((session) => (
                <ChatSessionItem
                  currentSessionId={currentSessionId}
                  fallbackSessionTitle={fallbackSessionTitle}
                  key={session.id}
                  onOpen={handleOpenChatSession}
                  onTogglePinned={handleSetChatSessionPinned}
                  projectLabel={getProjectNameFromPath(session.projectPath)}
                  session={session}
                  showPinAction
                  togglingPinnedSessionId={isSettingPinnedChatSessionId}
                />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        {chatSessionGroups.map((group) => (
          <ProjectGroupSection
            collapsedProjectPaths={collapsedProjectPaths}
            currentSessionId={currentSessionId}
            fallbackSessionTitle={fallbackSessionTitle}
            group={group}
            key={group.projectPath}
            onOpen={handleOpenChatSession}
            onShowLess={handleShowLessProjectSessions}
            onShowMore={handleShowMoreProjectSessions}
            onToggleCollapsed={handleToggleProjectCollapsed}
            onTogglePinned={handleSetChatSessionPinned}
            showLessLabel={t("sidebar.showLess")}
            showMoreLabel={t("sidebar.showMore")}
            toggleProjectGroupLabel={t("sidebar.toggleProjectGroup")}
            togglingPinnedSessionId={isSettingPinnedChatSessionId}
            visibleCount={getVisibleCountForProject(group.projectPath)}
          />
        ))}
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
    >
      {sidebarContent}
    </AppSidebarShell>
  )
}
