import { describe, expect, it } from "vite-plus/test"

import {
  formatChatSessionRelativeTime,
  formatGitStatusCompactLabel,
  getChatSessionMetaItems,
  getChatSessionTitle,
  getVisibleProjectGroupSessions,
  hasHiddenProjectGroupSessions,
  getProjectNameFromPath,
  groupChatSessionsByProject,
  isProjectGroupExpanded,
  isProjectsSidebarMode,
  PROJECT_GROUP_PAGE_SIZE,
  reorderProjectPaths,
  shouldShowProjectGroupLessAction,
  sortPinnedChatSessions,
  sortChatSessionsByUpdatedAt
} from "@/renderer/lib/sidebar/chat-sessions"

const buildSessionFixture = ({
  createdAt = "2026-03-26T12:00:00.000Z",
  id,
  lastOpenedAt,
  pinnedAt,
  projectPath,
  title,
  updatedAt = "2026-03-26T12:00:00.000Z"
}: {
  createdAt?: string
  id: string
  lastOpenedAt: string
  pinnedAt: string | null
  projectPath: string
  title: string
  updatedAt?: string
}) => ({
  archivedAt: null,
  createdAt,
  id,
  lastOpenedAt,
  modelId: null,
  pinnedAt,
  projectPath,
  title,
  updatedAt
})

describe("sidebar chat session helpers", () => {
  it("sorts sessions by updated time without letting open time reorder them", () => {
    const sessions = sortChatSessionsByUpdatedAt([
      buildSessionFixture({
        id: "opened-later",
        lastOpenedAt: "2026-03-26T12:30:00.000Z",
        pinnedAt: null,
        projectPath: "/tmp/project-a",
        title: "",
        updatedAt: "2026-03-26T12:00:00.000Z"
      }),
      buildSessionFixture({
        id: "updated-later",
        lastOpenedAt: "2026-03-26T12:01:00.000Z",
        pinnedAt: null,
        projectPath: "/tmp/project-a",
        title: "",
        updatedAt: "2026-03-26T12:10:00.000Z"
      })
    ])

    expect(sessions.map((session) => session.id)).toEqual([
      "updated-later",
      "opened-later"
    ])
  })

  it("groups unpinned chat sessions by exact project path without letting last opened time reorder projects", () => {
    const groups = groupChatSessionsByProject([
      buildSessionFixture({
        createdAt: "2026-03-26T12:00:00.000Z",
        id: "older-project-a",
        lastOpenedAt: "2026-03-26T12:01:00.000Z",
        pinnedAt: null,
        projectPath: "/tmp/project-a",
        title: "",
        updatedAt: "2026-03-26T12:01:00.000Z"
      }),
      buildSessionFixture({
        createdAt: "2026-03-26T11:00:00.000Z",
        id: "project-b",
        lastOpenedAt: "2026-03-26T12:03:00.000Z",
        pinnedAt: null,
        projectPath: "/tmp/project-b",
        title: "",
        updatedAt: "2026-03-26T12:03:00.000Z"
      }),
      buildSessionFixture({
        createdAt: "2026-03-26T12:30:00.000Z",
        id: "newer-project-a",
        lastOpenedAt: "2026-03-26T12:02:00.000Z",
        pinnedAt: null,
        projectPath: "/tmp/project-a",
        title: "",
        updatedAt: "2026-03-26T12:02:00.000Z"
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
    expect(groups[0]?.projectName).toBe("project-a")
    expect(groups[1]?.projectName).toBe("project-b")
    expect(groups[0]?.sessions.map((session) => session.id)).toEqual([
      "newer-project-a",
      "older-project-a"
    ])
  })

  it("applies project display names, custom order, and pinned project precedence", () => {
    const groups = groupChatSessionsByProject(
      [
        buildSessionFixture({
          id: "project-a",
          lastOpenedAt: "2026-03-26T12:03:00.000Z",
          pinnedAt: null,
          projectPath: "/tmp/project-a",
          title: ""
        }),
        buildSessionFixture({
          id: "project-b",
          lastOpenedAt: "2026-03-26T12:02:00.000Z",
          pinnedAt: null,
          projectPath: "/tmp/project-b",
          title: ""
        }),
        buildSessionFixture({
          id: "project-c",
          lastOpenedAt: "2026-03-26T12:01:00.000Z",
          pinnedAt: null,
          projectPath: "/tmp/project-c",
          title: ""
        })
      ],
      {
        projectDisplayNames: {
          "/tmp/project-b": "Renamed Project"
        },
        projectOrder: ["/tmp/project-a", "/tmp/project-c", "/tmp/project-b"],
        projectPins: {
          "/tmp/project-b": "2026-03-26T12:10:00.000Z",
          "/tmp/project-c": "2026-03-26T12:11:00.000Z"
        }
      }
    )

    expect(groups.map((group) => group.projectPath)).toEqual([
      "/tmp/project-c",
      "/tmp/project-b",
      "/tmp/project-a"
    ])
    expect(groups[1]?.projectName).toBe("Renamed Project")
  })

  it("reorders project paths for drag and drop", () => {
    expect(
      reorderProjectPaths({
        activeProjectPath: "/tmp/project-a",
        overProjectPath: "/tmp/project-c",
        projectPaths: ["/tmp/project-a", "/tmp/project-b", "/tmp/project-c"]
      })
    ).toEqual(["/tmp/project-b", "/tmp/project-c", "/tmp/project-a"])
    expect(
      reorderProjectPaths({
        activeProjectPath: "/tmp/missing",
        overProjectPath: "/tmp/project-c",
        projectPaths: ["/tmp/project-a", "/tmp/project-b", "/tmp/project-c"]
      })
    ).toEqual(["/tmp/project-a", "/tmp/project-b", "/tmp/project-c"])
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

  it("sorts pinned sessions by pinned time and then by updated time", () => {
    const sessions = sortPinnedChatSessions([
      buildSessionFixture({
        id: "older-pin",
        lastOpenedAt: "2026-03-26T12:04:00.000Z",
        pinnedAt: "2026-03-26T12:05:00.000Z",
        projectPath: "/tmp/project-a",
        title: "",
        updatedAt: "2026-03-26T12:01:00.000Z"
      }),
      buildSessionFixture({
        id: "newer-pin",
        lastOpenedAt: "2026-03-26T12:01:00.000Z",
        pinnedAt: "2026-03-26T12:06:00.000Z",
        projectPath: "/tmp/project-b",
        title: "",
        updatedAt: "2026-03-26T12:04:00.000Z"
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
        session: {
          ...firstSession,
          lastOpenedAt: "2026-03-26T12:55:00.000Z",
          updatedAt: "2026-03-26T12:00:00.000Z",
          gitStatus: {
            added: 1,
            changedFileCount: 4,
            deleted: 0,
            files: [
              {
                path: "src/app.tsx",
                status: "added"
              },
              {
                path: "src/main.ts",
                status: "modified"
              },
              {
                path: "src/settings.ts",
                status: "modified"
              },
              {
                path: "README.md",
                status: "untracked"
              }
            ],
            isRepository: true,
            modified: 2,
            projectPath: "/tmp/project-a",
            renamed: 0,
            untracked: 1
          }
        }
      })
    ).toEqual([
      {
        kind: "git-diff",
        label: "+1 ~2 ?1"
      },
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

  it("keeps the active project group manually collapsible", () => {
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
        group
      })
    ).toBe(false)
    expect(
      isProjectGroupExpanded({
        collapsedProjectPaths: [],
        group
      })
    ).toBe(true)
  })

  it("exposes the mode predicate", () => {
    expect(isProjectsSidebarMode("projects")).toBe(true)
    expect(isProjectsSidebarMode("simple")).toBe(false)
  })

  it("keeps git status labels compact", () => {
    expect(
      formatGitStatusCompactLabel({
        added: 1,
        changedFileCount: 5,
        deleted: 1,
        files: [],
        isRepository: true,
        modified: 1,
        projectPath: "/tmp/project-a",
        renamed: 1,
        untracked: 1
      })
    ).toBe("+1 ~1 -1 R1 ?1")
    expect(
      formatGitStatusCompactLabel({
        added: 0,
        changedFileCount: 0,
        deleted: 0,
        files: [],
        isRepository: true,
        modified: 0,
        projectPath: "/tmp/project-a",
        renamed: 0,
        untracked: 0
      })
    ).toBeNull()
  })
})
