import { AppSettingsSchema, MEMORY_TOOL_MODEL_AUTO_VALUE } from "@etyon/rpc"
import type { AppSettings } from "@etyon/rpc"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import {
  rewriteMemoryQuery,
  summarizeMemoryContent
} from "@/main/memory/summarization"

const { generateTextMock, resolveModelMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  resolveModelMock: vi.fn()
}))

vi.mock("ai", () => ({
  generateText: generateTextMock
}))

vi.mock("@/main/server/lib/providers", () => ({
  resolveModel: resolveModelMock
}))

const createSettings = (memory: Record<string, unknown> = {}): AppSettings =>
  AppSettingsSchema.parse({
    ai: {
      defaultProvider: "openai",
      providers: {
        openai: {
          apiKey: "sk-test",
          enabled: true,
          models: [
            {
              capabilities: {
                contextWindow: 128_000,
                jsonMode: true,
                streaming: true
              },
              id: "gpt-5.4-mini",
              name: "GPT-5.4 Mini"
            }
          ]
        }
      }
    },
    memory: {
      memoryToolModel: MEMORY_TOOL_MODEL_AUTO_VALUE,
      ...memory
    }
  })

describe("memory summarization runtime", () => {
  beforeEach(() => {
    generateTextMock.mockReset()
    resolveModelMock.mockReset()
    resolveModelMock.mockReturnValue("resolved-model")
  })

  it("returns fallback content when auto summarization is disabled", async () => {
    const fallbackContent = "Chat session memory\nConversation:\nUser: keep raw"

    await expect(
      summarizeMemoryContent({
        fallbackContent,
        heading: "Chat session memory",
        projectPath: "/tmp/project",
        settings: createSettings({
          autoSummarize: false
        })
      })
    ).resolves.toBe(fallbackContent)
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it("formats structured summary JSON from the memory tool model", async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        confidence: 0.82,
        decisions: ["Keep memory helpers under renderer/lib/memory."],
        facts: ["Memory retrieval is local-first."],
        procedures: ["Use focused tests for schema changes."],
        summary: "User prefers local-first memory implementation."
      })
    })

    const result = await summarizeMemoryContent({
      fallbackContent: "raw conversation",
      heading: "Chat session memory",
      projectPath: "/tmp/project",
      settings: createSettings({
        autoSummarize: true
      })
    })

    expect(result).toContain(
      "Summary: User prefers local-first memory implementation."
    )
    expect(result).toContain("- Keep memory helpers under renderer/lib/memory.")
    expect(result).toContain("Confidence: 0.82")
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "resolved-model"
      })
    )
  })

  it("falls back when model output cannot be parsed", async () => {
    generateTextMock.mockResolvedValue({ text: "not json" })

    await expect(
      summarizeMemoryContent({
        fallbackContent: "raw conversation",
        heading: "Chat session memory",
        projectPath: null,
        settings: createSettings({
          autoSummarize: true
        })
      })
    ).resolves.toBe("raw conversation")
  })

  it("rewrites memory queries through the memory tool model", async () => {
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        query: "memory retrieval local first settings"
      })
    })

    await expect(
      rewriteMemoryQuery({
        query: "What did we decide about this part?",
        settings: createSettings({
          queryRewriting: true
        })
      })
    ).resolves.toBe("memory retrieval local first settings")
  })
})
