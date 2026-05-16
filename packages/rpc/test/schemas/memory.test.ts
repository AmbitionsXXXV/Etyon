import { describe, expect, it } from "vite-plus/test"

import {
  MemoryEntriesOutputSchema,
  MemorySettingsSchema,
  MemoryStatsOutputSchema
} from "../../src/schemas/memory"

describe("memory schemas", () => {
  it("fills memory settings defaults", () => {
    expect(MemorySettingsSchema.parse({})).toEqual({
      enabled: true,
      includeChatbot: true,
      maxContextEntries: 8,
      shareAcrossProjects: true
    })
  })

  it("validates memory entries and stats", () => {
    const entries = MemoryEntriesOutputSchema.parse({
      entries: [
        {
          accessCount: 2,
          archivedAt: null,
          content: "Remember stable settings panels.",
          createdAt: "2026-05-16T00:00:00.000Z",
          id: "memory-1",
          kind: "episodic",
          lastAccessedAt: "2026-05-16T00:01:00.000Z",
          projectPath: "/tmp/project",
          scope: "project",
          sessionId: "session-1",
          source: "chat-session",
          sourceId: "session-1",
          updatedAt: "2026-05-16T00:01:00.000Z"
        }
      ]
    })
    const stats = MemoryStatsOutputSchema.parse({
      lastUpdatedAt: "2026-05-16T00:01:00.000Z",
      totalEntries: 1
    })

    expect(entries.entries[0].scope).toBe("project")
    expect(stats.totalEntries).toBe(1)
  })
})
