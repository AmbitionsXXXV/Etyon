import { setTimeout as delay } from "node:timers/promises"

import { AppSettingsSchema } from "@etyon/rpc"
import type { ParsedSkill } from "@etyon/rpc"
import type { LanguageModel } from "ai"
import { describe, expect, it, vi } from "vite-plus/test"

import type { streamAgentChat } from "@/main/agents/agent-runtime"
import { buildChatStreamResponse } from "@/main/server/routes/build-chat-stream-response"

const readResponseText = async (response: Response): Promise<string> => {
  if (!response.body) {
    return ""
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    text += decoder.decode(value, {
      stream: true
    })
  }

  text += decoder.decode()

  return text
}

describe("buildChatStreamResponse", () => {
  it("passes a runtime state into the agent stream", async () => {
    const streamResult = {
      toUIMessageStream: () =>
        new ReadableStream({
          start(controller) {
            controller.close()
          }
        })
    } as Awaited<ReturnType<typeof streamAgentChat>>
    const streamAgentChatMock = vi.fn(
      (_options: Parameters<typeof streamAgentChat>[0]) => {
        _options.runtimeState?.beginPhase("turn").end()

        return Promise.resolve(streamResult)
      }
    )
    const db = {} as Parameters<typeof streamAgentChat>[0]["db"]
    const extensionRunner = {
      emit: vi.fn(() => Promise.resolve()),
      getStreamHooks: () => {},
      getToolHooks: () => {},
      listTools: vi.fn(() => [])
    } satisfies NonNullable<
      Parameters<typeof streamAgentChat>[0]["extensionRunner"]
    >

    const response = buildChatStreamResponse({
      abortSignal: new AbortController().signal,
      buildLongTermMemorySystem: () => Promise.resolve(""),
      db,
      extensionRunner,
      messages: [
        {
          id: "message-1",
          parts: [],
          role: "user"
        }
      ],
      model: { modelId: "openai/gpt-4.1" } as unknown as LanguageModel,
      modelId: "openai/gpt-4.1",
      modelMessages: [],
      moonshotReasoningForAssistantToolCalls: [],
      onFinishPersist: () => Promise.resolve(),
      projectPath: "/tmp/project-a",
      requestStartedAt: Date.now(),
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({}),
      shouldRetrieveLongTermMemory: false,
      skillCapabilities: ["write-fs"],
      streamAgentChat: streamAgentChatMock,
      systemPrompts: []
    })

    const responseText = await readResponseText(response)

    const streamOptions = streamAgentChatMock.mock.calls[0]?.[0]

    expect(streamOptions?.runtimeState?.getSnapshot()).toEqual({
      phase: "idle"
    })
    expect(streamOptions?.extensionRunner).toBe(extensionRunner)
    expect(streamOptions?.skillCapabilities).toEqual(["write-fs"])
    expect(responseText).toContain("agent-turn")
  })

  it("starts the model stream when long-term memory retrieval times out", async () => {
    const streamResult = {
      toUIMessageStream: () =>
        new ReadableStream({
          start(controller) {
            controller.close()
          }
        })
    } as Awaited<ReturnType<typeof streamAgentChat>>
    const streamAgentChatMock = vi.fn(
      (_options: Parameters<typeof streamAgentChat>[0]) =>
        Promise.resolve(streamResult)
    )
    const db = {} as Parameters<typeof streamAgentChat>[0]["db"]

    const response = buildChatStreamResponse({
      abortSignal: new AbortController().signal,
      buildLongTermMemorySystem: async ({ abortSignal }) => {
        await delay(50, undefined, { signal: abortSignal })

        return "late memory"
      },
      db,
      memoryRetrievalTimeoutMs: 1,
      messages: [
        {
          id: "message-1",
          parts: [],
          role: "user"
        }
      ],
      model: { modelId: "openai/gpt-4.1" } as unknown as LanguageModel,
      modelId: "openai/gpt-4.1",
      modelMessages: [],
      moonshotReasoningForAssistantToolCalls: [],
      onFinishPersist: () => Promise.resolve(),
      projectPath: "/tmp/project-a",
      requestStartedAt: Date.now(),
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({}),
      shouldRetrieveLongTermMemory: true,
      streamAgentChat: streamAgentChatMock,
      systemPrompts: []
    })

    const responseText = await readResponseText(response)
    const streamOptions = streamAgentChatMock.mock.calls[0]?.[0]

    expect(responseText).toContain("memory-loading")
    expect(responseText).toContain("model-start")
    expect(streamAgentChatMock).toHaveBeenCalledTimes(1)
    expect(streamOptions?.systemPrompts).toEqual([])
  })

  it("routes /plan requests through the plan profile without sending the command token to the model", async () => {
    const streamResult = {
      toUIMessageStream: () =>
        new ReadableStream({
          start(controller) {
            controller.close()
          }
        })
    } as Awaited<ReturnType<typeof streamAgentChat>>
    const streamAgentChatMock = vi.fn(
      (_options: Parameters<typeof streamAgentChat>[0]) =>
        Promise.resolve(streamResult)
    )
    const db = {} as Parameters<typeof streamAgentChat>[0]["db"]

    const response = buildChatStreamResponse({
      abortSignal: new AbortController().signal,
      buildLongTermMemorySystem: () => Promise.resolve(""),
      db,
      messages: [
        {
          id: "message-1",
          parts: [
            {
              text: "/plan Refactor the agent runtime",
              type: "text"
            }
          ],
          role: "user"
        }
      ],
      model: { modelId: "openai/gpt-4.1" } as unknown as LanguageModel,
      modelId: "openai/gpt-4.1",
      modelMessages: [
        {
          content: "/plan Refactor the agent runtime",
          role: "user"
        }
      ],
      moonshotReasoningForAssistantToolCalls: [],
      onFinishPersist: () => Promise.resolve(),
      projectPath: "/tmp/project-a",
      requestStartedAt: Date.now(),
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({
        agents: {
          allowSubagentDelegation: true
        }
      }),
      shouldRetrieveLongTermMemory: false,
      streamAgentChat: streamAgentChatMock,
      systemPrompts: ["base system"]
    })

    await readResponseText(response)

    const streamOptions = streamAgentChatMock.mock.calls[0]?.[0]

    expect(streamOptions?.activeToolNames).toEqual([
      "findFiles",
      "fileInfo",
      "searchFiles",
      "readFile",
      "gitDiff",
      "memorySearch"
    ])
    expect(streamOptions?.settings.agents).toMatchObject({
      allowSubagentDelegation: false,
      defaultProfileId: "plan",
      enabled: true
    })
    expect(streamOptions?.messages).toEqual([
      {
        content: "Refactor the agent runtime",
        role: "user"
      }
    ])
    expect(streamOptions?.systemPrompts).toEqual([
      "base system",
      expect.stringContaining("[PLAN MODE ACTIVE]")
    ])
  })

  it("formats /prompt requests from loaded prompt templates before streaming", async () => {
    const streamResult = {
      toUIMessageStream: () =>
        new ReadableStream({
          start(controller) {
            controller.close()
          }
        })
    } as Awaited<ReturnType<typeof streamAgentChat>>
    const streamAgentChatMock = vi.fn(
      (_options: Parameters<typeof streamAgentChat>[0]) =>
        Promise.resolve(streamResult)
    )
    const db = {} as Parameters<typeof streamAgentChat>[0]["db"]

    const response = buildChatStreamResponse({
      abortSignal: new AbortController().signal,
      buildLongTermMemorySystem: () => Promise.resolve(""),
      db,
      messages: [
        {
          id: "message-1",
          parts: [
            {
              text: '/prompt review "current diff" doc/agents.md',
              type: "text"
            }
          ],
          role: "user"
        }
      ],
      model: { modelId: "openai/gpt-4.1" } as unknown as LanguageModel,
      modelId: "openai/gpt-4.1",
      modelMessages: [
        {
          content: '/prompt review "current diff" doc/agents.md',
          role: "user"
        }
      ],
      moonshotReasoningForAssistantToolCalls: [],
      onFinishPersist: () => Promise.resolve(),
      projectPath: "/tmp/project-a",
      promptTemplates: [
        {
          body: "Review $1 against $2.",
          description: "Review task",
          name: "review",
          path: "/tmp/project-a/.agents/skills/reviewer/prompts/review.md"
        }
      ],
      requestStartedAt: Date.now(),
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({}),
      shouldRetrieveLongTermMemory: false,
      streamAgentChat: streamAgentChatMock,
      systemPrompts: []
    })

    await readResponseText(response)

    expect(streamAgentChatMock.mock.calls[0]?.[0].messages).toEqual([
      {
        content: [
          "<prompt_template>",
          "<name>review</name>",
          "<description>Review task</description>",
          "<path>/tmp/project-a/.agents/skills/reviewer/prompts/review.md</path>",
          "<content>",
          "Review current diff against doc/agents.md.",
          "</content>",
          "</prompt_template>"
        ].join("\n"),
        role: "user"
      }
    ])
  })

  it("formats /skill command invocations from loaded skill command metadata before streaming", async () => {
    const streamResult = {
      toUIMessageStream: () =>
        new ReadableStream({
          start(controller) {
            controller.close()
          }
        })
    } as Awaited<ReturnType<typeof streamAgentChat>>
    const streamAgentChatMock = vi.fn(
      (_options: Parameters<typeof streamAgentChat>[0]) =>
        Promise.resolve(streamResult)
    )
    const db = {} as Parameters<typeof streamAgentChat>[0]["db"]
    const skill: ParsedSkill = {
      body: "Review changes with project conventions.",
      capabilities: ["read-fs"],
      commands: [
        {
          description: "Review the current diff.",
          flags: ["--strict"],
          name: "review"
        }
      ],
      description: "Reviewer skill.",
      extensions: [],
      modelVisible: true,
      name: "reviewer",
      path: "/tmp/project-a/.agents/skills/reviewer/SKILL.md",
      projectPath: "/tmp/project-a",
      scope: "project",
      shortDescription: "Reviewer",
      visible: true
    }

    const response = buildChatStreamResponse({
      abortSignal: new AbortController().signal,
      buildLongTermMemorySystem: () => Promise.resolve(""),
      db,
      messages: [
        {
          id: "message-1",
          parts: [
            {
              text: "/skill reviewer review --strict -- current diff",
              type: "text"
            }
          ],
          role: "user"
        }
      ],
      model: { modelId: "openai/gpt-4.1" } as unknown as LanguageModel,
      modelId: "openai/gpt-4.1",
      modelMessages: [
        {
          content: "/skill reviewer review --strict -- current diff",
          role: "user"
        }
      ],
      moonshotReasoningForAssistantToolCalls: [],
      onFinishPersist: () => Promise.resolve(),
      projectPath: "/tmp/project-a",
      requestStartedAt: Date.now(),
      sessionId: "session-1",
      settings: AppSettingsSchema.parse({}),
      shouldRetrieveLongTermMemory: false,
      skillCommandSkills: [skill],
      streamAgentChat: streamAgentChatMock,
      systemPrompts: []
    })

    await readResponseText(response)

    expect(streamAgentChatMock.mock.calls[0]?.[0].messages).toEqual([
      {
        content: [
          "<skill_command_invocation>",
          "<skill>",
          "<name>reviewer</name>",
          "<description>Reviewer skill.</description>",
          "<short_description>Reviewer</short_description>",
          "<path>/tmp/project-a/.agents/skills/reviewer/SKILL.md</path>",
          "<scope>project</scope>",
          "</skill>",
          "<command>",
          "<name>review</name>",
          "<description>Review the current diff.</description>",
          "<flags>",
          "<flag>--strict</flag>",
          "</flags>",
          "<selected_flags>",
          "<flag>--strict</flag>",
          "</selected_flags>",
          "</command>",
          "<arguments>current diff</arguments>",
          "<instructions>",
          "Review changes with project conventions.",
          "</instructions>",
          "</skill_command_invocation>"
        ].join("\n"),
        role: "user"
      }
    ])
  })
})
