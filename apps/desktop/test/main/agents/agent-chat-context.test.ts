import { AppSettingsSchema } from "@etyon/rpc"
import type { ChatMention } from "@etyon/rpc"
import type * as Ai from "ai"
import type { UIMessage } from "ai"
import { describe, expect, it, vi } from "vite-plus/test"

import {
  buildAgentChatMemoryQuery,
  prepareAgentChatContext
} from "@/main/agents/agent-chat-context"

const {
  buildMemorySystemPromptMock,
  buildMentionContextMock,
  buildSessionMemorySystemPromptMock,
  buildSkillsSystemPromptMock,
  convertToModelMessagesMock,
  getChatSessionMemoryMock,
  listSkillPromptTemplatesMock
} = vi.hoisted(() => ({
  buildMemorySystemPromptMock: vi.fn(() => Promise.resolve("long memory")),
  buildMentionContextMock: vi.fn(() => ({
    system: "mention context"
  })),
  buildSessionMemorySystemPromptMock: vi.fn(() => "session memory"),
  buildSkillsSystemPromptMock: vi.fn(() => "skills context"),
  convertToModelMessagesMock: vi.fn<() => Promise<Ai.ModelMessage[]>>(() =>
    Promise.resolve([
      {
        content: "model message",
        role: "user"
      }
    ])
  ),
  getChatSessionMemoryMock: vi.fn(() =>
    Promise.resolve({
      content: "remembered",
      createdAt: "2026-05-24T00:00:00.000Z",
      messageCount: 2,
      sessionId: "session-1",
      updatedAt: "2026-05-24T00:00:00.000Z"
    })
  ),
  listSkillPromptTemplatesMock: vi.fn(() => [
    {
      content: "Review this.",
      description: "Review helper.",
      name: "review",
      path: "/project/.agents/skills/reviewer/prompts/review.md",
      skillName: "reviewer"
    }
  ])
}))

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof Ai>()

  return {
    ...actual,
    convertToModelMessages: convertToModelMessagesMock
  }
})

vi.mock("@/main/chat-session-memory", () => ({
  buildSessionMemorySystemPrompt: buildSessionMemorySystemPromptMock,
  getChatSessionMemory: getChatSessionMemoryMock
}))

vi.mock("@/main/memory", () => ({
  buildMemorySystemPrompt: buildMemorySystemPromptMock
}))

vi.mock("@/main/project-snapshot", () => ({
  buildMentionContext: buildMentionContextMock
}))

vi.mock("@/main/skills", () => ({
  buildSkillsSystemPrompt: buildSkillsSystemPromptMock,
  listSkillPromptTemplates: listSkillPromptTemplatesMock
}))

const createTextMessage = ({
  id,
  role,
  text
}: {
  id: string
  role: UIMessage["role"]
  text: string
}): UIMessage => ({
  id,
  parts: [
    {
      text,
      type: "text"
    }
  ],
  role
})

describe("agent chat context", () => {
  it("builds a normalized memory query from the last three user messages", () => {
    const messages = [
      createTextMessage({
        id: "user-1",
        role: "user",
        text: "first\n question"
      }),
      createTextMessage({
        id: "assistant-1",
        role: "assistant",
        text: "ignored"
      }),
      createTextMessage({
        id: "user-2",
        role: "user",
        text: "second\tquestion"
      }),
      createTextMessage({
        id: "user-3",
        role: "user",
        text: "third question"
      }),
      createTextMessage({
        id: "user-4",
        role: "user",
        text: "fourth question"
      })
    ]

    expect(buildAgentChatMemoryQuery(messages)).toBe(
      ["second question", "third question", "fourth question"].join("\n")
    )
  })

  it("prepares model context, system prompts, and prompt templates", async () => {
    const selectedSkill = {
      description: "Use when reviewing code.",
      kind: "skill",
      name: "reviewer",
      path: "/project/.agents/skills/reviewer/SKILL.md",
      projectPath: "/project",
      relativePath: ".agents/skills/reviewer/SKILL.md",
      scope: "project",
      shortDescription: null
    } satisfies ChatMention
    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: true
      },
      memory: {
        autoRetrieve: true,
        enabled: true
      }
    })
    const abortController = new AbortController()

    const context = await prepareAgentChatContext({
      db: {} as Parameters<typeof prepareAgentChatContext>[0]["db"],
      mentions: [selectedSkill],
      messages: [
        createTextMessage({
          id: "user-1",
          role: "user",
          text: "Read the diff"
        })
      ],
      projectPath: "/project",
      sessionId: "session-1",
      settings
    })
    const longTermMemory = await context.buildLongTermMemorySystem({
      abortSignal: abortController.signal
    })

    expect(context).toMatchObject({
      modelMessages: [
        {
          content: "model message",
          role: "user"
        }
      ],
      shouldRetrieveLongTermMemory: true,
      systemPrompts: ["session memory", "skills context", "mention context"]
    })
    expect(context.promptTemplates).toHaveLength(1)
    expect(longTermMemory).toBe("long memory")
    expect(buildMemorySystemPromptMock).toHaveBeenCalledWith({
      abortSignal: abortController.signal,
      db: {},
      projectPath: "/project",
      query: "Read the diff",
      settings: settings.memory
    })
  })

  it("completes unresolved tool calls before exposing model messages", async () => {
    const settings = AppSettingsSchema.parse({
      agents: {
        enabled: false
      }
    })

    const unresolvedToolCallMessages = [
      {
        content: "Inspect the file.",
        role: "user"
      },
      {
        content: [
          {
            input: {
              path: "src/index.ts"
            },
            toolCallId: "readFile:18",
            toolName: "readFile",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      {
        content: "Continue from here.",
        role: "user"
      }
    ] satisfies Ai.ModelMessage[]

    convertToModelMessagesMock.mockResolvedValueOnce(unresolvedToolCallMessages)

    const context = await prepareAgentChatContext({
      db: {} as Parameters<typeof prepareAgentChatContext>[0]["db"],
      mentions: [],
      messages: [
        createTextMessage({
          id: "user-1",
          role: "user",
          text: "Continue from here."
        })
      ],
      projectPath: "/project",
      sessionId: "session-1",
      settings
    })

    expect(context.modelMessages).toEqual([
      {
        content: "Inspect the file.",
        role: "user"
      },
      {
        content: [
          {
            input: {
              path: "src/index.ts"
            },
            toolCallId: "readFile:18",
            toolName: "readFile",
            type: "tool-call"
          }
        ],
        role: "assistant"
      },
      {
        content: [
          {
            output: {
              type: "error-text",
              value:
                "Tool execution did not complete before the next user message."
            },
            toolCallId: "readFile:18",
            toolName: "readFile",
            type: "tool-result"
          }
        ],
        role: "tool"
      },
      {
        content: "Continue from here.",
        role: "user"
      }
    ])
  })
})
