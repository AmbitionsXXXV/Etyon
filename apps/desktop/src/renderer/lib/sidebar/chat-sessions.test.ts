import { describe, expect, it } from "vitest"

import {
  formatChatSessionRelativeTime,
  getChatSessionMetaItems,
  getChatSessionTitle,
  getVisibleProjectGroupSessions,
  hasHiddenProjectGroupSessions,
  getProjectNameFromPath,
  groupChatSessionsByProject,
  isProjectGroupExpanded,
  isProjectsSidebarMode,
  PROJECT_GROUP_PAGE_SIZE,
  shouldShowProjectGroupLessAction,
  sortPinnedChatSessions
} from "./chat-sessions"

const buildSessionFixture = ({
  id,
  lastOpenedAt,
  pinnedAt,
  projectPath,
  title
}: {
  id: string
  lastOpenedAt: string
  pinnedAt: string | null
  projectPath: string
  title: string
}) => ({
  createdAt: "2026-03-26T12:00:00.000Z",
  id,
  lastOpenedAt,
  modelId: null,
  pinnedAt,
  projectPath,
  title,
  updatedAt: "2026-03-26T12:00:00.000Z"
})

describe("sidebar chat session helpers", () => {
  it("groups unpinned chat sessions by exact project path and sorts each group by last opened at", () => {
    const groups = groupChatSessionsByProject([
      buildSessionFixture({
        id: "older-project-a",
        lastOpenedAt: "2026-03-26T12:01:00.000Z",
        pinnedAt: null,
        projectPath: "/tmp/project-a",
        title: ""
      }),
      buildSessionFixture({
        id: "project-b",
        lastOpenedAt: "2026-03-26T12:03:00.000Z",
        pinnedAt: null,
        projectPath: "/tmp/project-b",
        title: ""
      }),
      buildSessionFixture({
        id: "newer-project-a",
        lastOpenedAt: "2026-03-26T12:02:00.000Z",
        pinnedAt: null,
        projectPath: "/tmp/project-a",
        title: ""
      }),
      buildSessionFixture({
        id: "pinned-project-a",
        lastOpenedAt: "2026-03-26T12:04:00.000Z",
        pinnedAt: "2026-03-26T12:05:00.000Z",
        projectPath: "/tmp/project-a",
        title: ""
      })
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]?.projectName).toBe("project-b")
    expect(groups[1]?.projectName).toBe("project-a")
    expect(groups[1]?.sessions.map((session) => session.id)).toEqual([
      "newer-project-a",
      "older-project-a"
    ])
  })

  it("derives project names from unix and windows style paths", () => {
    expect(getProjectNameFromPath("/Users/test/project-a")).toBe("project-a")
    expect(getProjectNameFromPath("C:\\Users\\test\\project-b")).toBe(
      "project-b"
    )
  })

  it("falls back to the localized new chat title when the title is blank", () => {
    expect(
      getChatSessionTitle({
        fallbackTitle: "New Chat",
        session: buildSessionFixture({
          id: "session-1",
          lastOpenedAt: "2026-03-26T12:00:00.000Z",
          pinnedAt: null,
          projectPath: "/tmp/project-a",
          title: "   "
        })
      })
    ).toBe("New Chat")
  })

  it("sorts pinned sessions by pinned time and then by last opened at", () => {
    const sessions = sortPinnedChatSessions([
      buildSessionFixture({
        id: "older-pin",
        lastOpenedAt: "2026-03-26T12:01:00.000Z",
        pinnedAt: "2026-03-26T12:05:00.000Z",
        projectPath: "/tmp/project-a",
        title: ""
      }),
      buildSessionFixture({
        id: "newer-pin",
        lastOpenedAt: "2026-03-26T12:04:00.000Z",
        pinnedAt: "2026-03-26T12:06:00.000Z",
        projectPath: "/tmp/project-b",
        title: ""
      }),
      buildSessionFixture({
        id: "not-pinned",
        lastOpenedAt: "2026-03-26T12:07:00.000Z",
        pinnedAt: null,
        projectPath: "/tmp/project-c",
        title: ""
      })
    ])

    expect(sessions.map((session) => session.id)).toEqual([
      "newer-pin",
      "older-pin"
    ])
  })

  it("builds relative time labels and project group visibility helpers", () => {
    const sessions = Array.from(
      { length: PROJECT_GROUP_PAGE_SIZE + 2 },
      (_, index) =>
        buildSessionFixture({
          id: `session-${index}`,
          lastOpenedAt: "2026-03-26T12:00:00.000Z",
          pinnedAt: null,
          projectPath: "/tmp/project-a",
          title: ""
        })
    )
    const [firstSession] = sessions

    if (!firstSession) {
      throw new Error("expected a first session fixture")
    }

    expect(
      formatChatSessionRelativeTime(
        "2026-03-26T12:30:00.000Z",
        new Date("2026-03-26T13:00:00.000Z")
      )
    ).toBe("30m")
    expect(
      getChatSessionMetaItems({
        now: new Date("2026-03-26T13:00:00.000Z"),
        session: firstSession
      })
    ).toEqual([
      {
        kind: "time",
        label: "1h"
      }
    ])
    expect(
      getVisibleProjectGroupSessions({
        sessions,
        visibleCount: PROJECT_GROUP_PAGE_SIZE
      })
    ).toHaveLength(PROJECT_GROUP_PAGE_SIZE)
    expect(
      hasHiddenProjectGroupSessions({
        sessions,
        visibleCount: PROJECT_GROUP_PAGE_SIZE
      })
    ).toBe(true)
    expect(
      shouldShowProjectGroupLessAction({
        sessions,
        visibleCount: sessions.length
      })
    ).toBe(true)
  })

  it("forces the active project group open even when it is collapsed", () => {
    const group = groupChatSessionsByProject([
      buildSessionFixture({
        id: "session-1",
        lastOpenedAt: "2026-03-26T12:00:00.000Z",
        pinnedAt: null,
        projectPath: "/tmp/project-a",
        title: ""
      })
    ]).at(0)

    if (!group) {
      throw new Error("expected a project group fixture")
    }

    expect(
      isProjectGroupExpanded({
        collapsedProjectPaths: ["/tmp/project-a"],
        currentSessionId: "session-1",
        group
      })
    ).toBe(true)
    expect(
      isProjectGroupExpanded({
        collapsedProjectPaths: ["/tmp/project-a"],
        currentSessionId: "session-2",
        group
      })
    ).toBe(false)
  })

  it("exposes the mode predicate", () => {
    expect(isProjectsSidebarMode("projects")).toBe(true)
    expect(isProjectsSidebarMode("simple")).toBe(false)
  })
})
