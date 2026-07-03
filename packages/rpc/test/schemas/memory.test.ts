import { describe, expect, it } from "vite-plus/test"

import {
  MemoryEntriesOutputSchema,
  MemorySettingsSchema,
  MemoryStatsOutputSchema
} from "../../src/schemas/memory"

describe("memory schemas", () => {
  it("fills memory settings defaults", () => {
    expect(MemorySettingsSchema.parse({})).toEqual({
      autoRetrieve: true,
      autoSummarize: false,
      embeddingModel: "",
      enabled: true,
      includeChatbot: true,
      maxContextEntries: 8,
      maxRetrievedMemories: 8,
      memoryToolModel: "__auto__",
      queryRewriting: false,
      shareAcrossProjects: true,
      similarityThreshold: 0.1
    })
  })

  it("maps legacy context entry settings to retrieved memory settings", () => {
    expect(
      MemorySettingsSchema.parse({
        maxContextEntries: 5
      }).maxRetrievedMemories
    ).toBe(5)
  })

  it("keeps explicit retrieved memory settings over legacy values", () => {
    expect(
      MemorySettingsSchema.parse({
        maxContextEntries: 5,
        maxRetrievedMemories: 3
      }).maxRetrievedMemories
    ).toBe(3)
  })

  it("validates memory retrieval ranges", () => {
    expect(() =>
      MemorySettingsSchema.parse({
        maxRetrievedMemories: 21
      })
    ).toThrow()

    expect(() =>
      MemorySettingsSchema.parse({
        similarityThreshold: 1.1
      })
    ).toThrow()
  })

  it("accepts explicit memory enhancement settings", () => {
    expect(
      MemorySettingsSchema.parse({
        autoRetrieve: false,
        autoSummarize: true,
        embeddingModel: "local:minilm-l6-v2",
        enabled: false,
        includeChatbot: false,
        maxContextEntries: 2,
        maxRetrievedMemories: 6,
        memoryToolModel: "openai/gpt-4.1-mini",
        queryRewriting: false,
        shareAcrossProjects: false,
        similarityThreshold: 0.75
      })
    ).toEqual({
      autoRetrieve: false,
      autoSummarize: true,
      embeddingModel: "local:minilm-l6-v2",
      enabled: false,
      includeChatbot: false,
      maxContextEntries: 2,
      maxRetrievedMemories: 6,
      memoryToolModel: "openai/gpt-4.1-mini",
      queryRewriting: false,
      shareAcrossProjects: false,
      similarityThreshold: 0.75
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
