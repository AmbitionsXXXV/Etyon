import type {
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart
} from "@ai-sdk/provider"
import type { UIMessageChunk } from "ai"
import { tool } from "ai"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { describe, expect, it, vi } from "vite-plus/test"
import { z } from "zod"

import {
  announcesImminentAction,
  runAgentLoop
} from "@/main/agents/minimal/agent-loop"
import type { AgentLoopStep } from "@/main/agents/minimal/agent-loop"
import { CHAT_RUN_LIMIT_DATA_TYPE } from "@/shared/chat/stream-data"

const usage = {
  inputTokens: {
    cacheRead: undefined,
    cacheWrite: undefined,
    noCache: undefined,
    total: 1
  },
  outputTokens: {
    reasoning: undefined,
    text: undefined,
    total: 1
  }
}

const textStep = (
  text: string,
  finishReason: "stop" | "tool-calls" = "stop"
): LanguageModelV3StreamPart[] => [
  { type: "stream-start", warnings: [] },
  { id: "text-1", type: "text-start" },
  { delta: text, id: "text-1", type: "text-delta" },
  { id: "text-1", type: "text-end" },
  {
    finishReason: { raw: finishReason, unified: finishReason },
    type: "finish",
    usage
  }
]

const toolCallStep = (
  toolName: string,
  input = "{}"
): LanguageModelV3StreamPart[] => [
  { type: "stream-start", warnings: [] },
  {
    input,
    toolCallId: `call-${toolName}-${Math.random().toString(36).slice(2, 8)}`,
    toolName,
    type: "tool-call"
  },
  {
    finishReason: { raw: "tool_calls", unified: "tool-calls" },
    type: "finish",
    usage
  }
]

interface LoopHarness {
  chunks: UIMessageChunk[]
  model: MockLanguageModelV3
  prompts: LanguageModelV3Prompt[]
  writer: {
    merge: (stream: ReadableStream<UIMessageChunk>) => void
    onError: undefined
    write: (chunk: UIMessageChunk) => void
  }
  flush: () => Promise<void>
}

const buildHarness = (
  scripts: readonly LanguageModelV3StreamPart[][]
): LoopHarness => {
  const chunks: UIMessageChunk[] = []
  const prompts: LanguageModelV3Prompt[] = []
  const pumps: Promise<void>[] = []
  let callIndex = 0

  const model = new MockLanguageModelV3({
    doStream: (options) => {
      prompts.push(options.prompt)
      const script = scripts[Math.min(callIndex, scripts.length - 1)]

      callIndex += 1

      return Promise.resolve({
        stream: simulateReadableStream({ chunks: [...(script ?? [])] })
      })
    }
  })

  return {
    chunks,
    flush: async () => {
      await Promise.all(pumps)
    },
    model,
    prompts,
    writer: {
      merge: (stream) => {
        pumps.push(
          (async () => {
            const reader = stream.getReader()

            while (true) {
              const { done, value } = await reader.read()

              if (done) {
                break
              }

              chunks.push(value)
            }
          })()
        )
      },
      onError: undefined,
      write: (chunk) => {
        chunks.push(chunk)
      }
    }
  }
}

const userMessages = [{ content: "总结一下暂存的修改", role: "user" as const }]

describe("runAgentLoop", () => {
  it("completes after a plain text stop without nudging", async () => {
    const harness = buildHarness([textStep("报告已经生成,内容在上面。")])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: userMessages,
      model: harness.model,
      tools: {},
      writer: harness.writer
    })

    await harness.flush()
    expect(outcome.exitReason).toBe("completed")
    expect(outcome.finishReason).toBe("stop")
    expect(outcome.nudged).toBe(false)
    expect(outcome.stepCount).toBe(1)
    expect(
      harness.chunks.filter((chunk) => chunk.type === "start")
    ).toHaveLength(1)
    expect(
      harness.chunks.filter((chunk) => chunk.type === "finish")
    ).toHaveLength(1)
  })

  it("continues through tool-call steps until the model stops", async () => {
    const steps: AgentLoopStep[] = []
    const ping = vi.fn().mockResolvedValue("pong")
    const harness = buildHarness([
      toolCallStep("ping"),
      textStep("工具结果处理完毕。")
    ])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: userMessages,
      model: harness.model,
      onStepFinish: (step) => {
        steps.push(step)
      },
      tools: {
        ping: tool({
          description: "test tool",
          execute: ping,
          inputSchema: z.object({})
        })
      },
      writer: harness.writer
    })

    await harness.flush()
    expect(outcome.exitReason).toBe("completed")
    expect(outcome.stepCount).toBe(2)
    expect(ping).toHaveBeenCalledTimes(1)
    expect(steps.map((step) => step.toolCallCount)).toEqual([1, 0])
    expect(steps.map((step) => step.finishReason)).toEqual([
      "tool-calls",
      "stop"
    ])
  })

  it("nudges once when the model announces an action and stops", async () => {
    const harness = buildHarness([
      textStep(
        "我会生成一份 artifact 汇报,但先说明限制。先确认 `artifacts/` 目录。"
      ),
      textStep("已确认目录并完成汇报。")
    ])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: userMessages,
      model: harness.model,
      tools: {},
      writer: harness.writer
    })

    await harness.flush()
    expect(outcome.exitReason).toBe("completed")
    expect(outcome.nudged).toBe(true)
    expect(outcome.stepCount).toBe(2)

    const secondPrompt = harness.prompts[1] ?? []
    const lastPromptMessage = secondPrompt.at(-1)

    expect(lastPromptMessage?.role).toBe("user")
    expect(JSON.stringify(lastPromptMessage?.content)).toContain(
      "without executing it"
    )
  })

  it("nudges at most once per run", async () => {
    const announce = textStep("接下来我会检查 artifacts 目录。")
    const harness = buildHarness([announce, announce])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: userMessages,
      model: harness.model,
      tools: {},
      writer: harness.writer
    })

    await harness.flush()
    expect(outcome.exitReason).toBe("completed")
    expect(outcome.nudged).toBe(true)
    expect(outcome.stepCount).toBe(2)
  })

  it("does not nudge closing idioms", async () => {
    const harness = buildHarness([
      textStep("修改完成。如果还有问题,随时让我知道。")
    ])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: userMessages,
      model: harness.model,
      tools: {},
      writer: harness.writer
    })

    await harness.flush()
    expect(outcome.nudged).toBe(false)
    expect(outcome.stepCount).toBe(1)
  })

  it("stops at maxSteps and surfaces a visible run-limit part", async () => {
    const harness = buildHarness([
      toolCallStep("ping"),
      toolCallStep("ping"),
      toolCallStep("ping")
    ])

    const outcome = await runAgentLoop({
      maxSteps: 2,
      messages: userMessages,
      model: harness.model,
      tools: {
        ping: tool({
          description: "test tool",
          execute: () => Promise.resolve("pong"),
          inputSchema: z.object({})
        })
      },
      writer: harness.writer
    })

    await harness.flush()
    expect(outcome.exitReason).toBe("max-steps")
    expect(outcome.stepCount).toBe(2)

    const limitChunk = harness.chunks.find(
      (chunk) => chunk.type === CHAT_RUN_LIMIT_DATA_TYPE
    )

    expect(limitChunk).toBeDefined()
    expect((limitChunk as { data: { maxSteps: number } }).data.maxSteps).toBe(2)
  })

  it("suspends when a tool requires approval instead of executing it", async () => {
    const write = vi.fn().mockResolvedValue("written")
    const harness = buildHarness([
      toolCallStep("write", JSON.stringify({ path: "a.txt" }))
    ])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: userMessages,
      model: harness.model,
      tools: {
        write: tool({
          description: "gated tool",
          execute: write,
          inputSchema: z.object({ path: z.string() }),
          needsApproval: true
        })
      },
      writer: harness.writer
    })

    await harness.flush()
    expect(outcome.exitReason).toBe("suspended")
    expect(write).not.toHaveBeenCalled()
  })

  it("executes an approved pending tool call when the run resumes", async () => {
    const write = vi.fn().mockResolvedValue({ bytesWritten: 3 })
    const harness = buildHarness([textStep("已写入文件并完成。")])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: [
        { content: "写入 a.txt", role: "user" },
        {
          content: [
            {
              input: { path: "a.txt" },
              toolCallId: "tc-approved",
              toolName: "write",
              type: "tool-call"
            },
            {
              approvalId: "ap-1",
              toolCallId: "tc-approved",
              type: "tool-approval-request"
            }
          ],
          role: "assistant"
        },
        {
          content: [
            {
              approvalId: "ap-1",
              approved: true,
              type: "tool-approval-response"
            }
          ],
          role: "tool"
        }
      ],
      model: harness.model,
      tools: {
        write: tool({
          description: "gated tool",
          execute: write,
          inputSchema: z.object({ path: z.string() }),
          needsApproval: true
        })
      },
      writer: harness.writer
    })

    await harness.flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0]).toEqual({ path: "a.txt" })
    expect(outcome.exitReason).toBe("completed")
  })

  it("returns model-error when the stream setup throws", async () => {
    const model = new MockLanguageModelV3({
      doStream: () => Promise.reject(new Error("boom: provider down"))
    })
    const harness = buildHarness([])

    const outcome = await runAgentLoop({
      maxSteps: 8,
      messages: userMessages,
      model,
      tools: {},
      writer: harness.writer
    })

    await harness.flush()
    expect(outcome.exitReason).toBe("model-error")
    expect(outcome.errorMessage).toContain("boom")

    const errorChunk = harness.chunks.find((chunk) => chunk.type === "error")

    expect(errorChunk).toBeDefined()
  })

  it("returns aborted when the signal is already aborted", async () => {
    const controller = new AbortController()

    controller.abort()

    const harness = buildHarness([textStep("不该被调用")])
    const outcome = await runAgentLoop({
      abortSignal: controller.signal,
      maxSteps: 8,
      messages: userMessages,
      model: harness.model,
      tools: {},
      writer: harness.writer
    })

    expect(outcome.exitReason).toBe("aborted")
    expect(outcome.stepCount).toBe(0)
  })
})

describe("announcesImminentAction", () => {
  it("matches the observed preamble-then-stop message", () => {
    expect(
      announcesImminentAction(
        "我会生成一份 artifact 汇报,但先说明限制:当前可用工具只有文件读写/搜索。报告会明确记录这个限制。先确认 `artifacts/` 目录。"
      )
    ).toBe(true)
  })

  it("matches English announcements", () => {
    expect(
      announcesImminentAction("Let me check the artifacts directory first.")
    ).toBe(true)
    expect(announcesImminentAction("Next, I'll scan the repo for tests.")).toBe(
      true
    )
  })

  it("ignores completed answers", () => {
    expect(
      announcesImminentAction("报告已生成,内容保存在 artifacts/report.html。")
    ).toBe(false)
  })

  it("ignores closing idioms", () => {
    expect(
      announcesImminentAction("Done. Let me know if you need anything else.")
    ).toBe(false)
    expect(announcesImminentAction("完成了,有问题随时找我。")).toBe(false)
  })

  it("ignores advice directed at the user", () => {
    expect(
      announcesImminentAction("如果部署失败,你可以先检查环境变量配置。")
    ).toBe(false)
    expect(announcesImminentAction("建议先运行一次完整测试。")).toBe(false)
  })

  it("ignores empty text", () => {
    expect(announcesImminentAction("")).toBe(false)
  })
})
