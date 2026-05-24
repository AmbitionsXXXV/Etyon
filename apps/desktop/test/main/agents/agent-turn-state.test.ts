import { describe, expect, it, vi } from "vite-plus/test"

import { createAgentTurnState } from "@/main/agents/agent-turn-state"

describe("agent turn state", () => {
  it("captures a readonly snapshot for the next model turn", async () => {
    const messages = [
      {
        content: "Read the project.",
        role: "user"
      }
    ]
    const readFile = vi.fn()
    const tools = {
      readFile
    }
    const streamOptions = {
      headers: {
        "x-run-id": "run-1"
      },
      metadata: {
        source: "chat"
      }
    }

    const turnState = await createAgentTurnState({
      messages,
      model: "gpt-5",
      streamOptions,
      systemPrompt: "You are an agent.",
      thinkingLevel: "medium",
      tools
    })

    messages.push({
      content: "This belongs to the next turn.",
      role: "user"
    })
    tools.readFile = vi.fn()
    streamOptions.headers["x-run-id"] = "run-2"
    streamOptions.metadata.source = "settings"

    expect(turnState).toEqual({
      messages: [
        {
          content: "Read the project.",
          role: "user"
        }
      ],
      model: "gpt-5",
      streamOptions: {
        headers: {
          "x-run-id": "run-1"
        },
        metadata: {
          source: "chat"
        }
      },
      systemPrompt: "You are an agent.",
      thinkingLevel: "medium",
      tools: {
        readFile
      }
    })
    expect(Object.isFrozen(turnState.messages)).toBe(true)
    expect(Object.isFrozen(turnState.tools)).toBe(true)
    expect(Object.isFrozen(turnState.streamOptions.headers)).toBe(true)
    expect(Object.isFrozen(turnState.streamOptions.metadata)).toBe(true)
  })

  it("resolves system prompt providers once per turn state", async () => {
    const systemPrompt = vi.fn(() => Promise.resolve("Dynamic system prompt"))

    const turnState = await createAgentTurnState({
      messages: [],
      model: "gpt-5",
      systemPrompt,
      tools: {}
    })

    expect(systemPrompt).toHaveBeenCalledTimes(1)
    expect(turnState.systemPrompt).toBe("Dynamic system prompt")
  })

  it("keeps provider credentials out of the snapshot", async () => {
    const resolveProviderCredentials = vi.fn(() =>
      Promise.resolve({
        apiKey: "secret-key"
      })
    )

    const turnState = await createAgentTurnState({
      messages: [],
      model: "gpt-5",
      resolveProviderCredentials,
      systemPrompt: "No credentials here.",
      tools: {}
    })

    expect(resolveProviderCredentials).not.toHaveBeenCalled()
    await expect(turnState.resolveProviderCredentials?.()).resolves.toEqual({
      apiKey: "secret-key"
    })
    await expect(turnState.resolveProviderCredentials?.()).resolves.toEqual({
      apiKey: "secret-key"
    })
    expect(resolveProviderCredentials).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(turnState)).not.toContain("secret-key")
  })
})
