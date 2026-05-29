import { describe, expect, it } from "vite-plus/test"

import {
  mapAssistantToolPartStateToChatToolState,
  splitAssistantRenderableTextSegments,
  shouldRenderAssistantToolPart,
  splitAssistantTextSegments
} from "@/renderer/lib/chat/tool-ui"

describe("chat tool ui helpers", () => {
  it("keeps approval tool parts visible when regular tool traces are hidden", () => {
    expect(
      shouldRenderAssistantToolPart({
        showToolTraces: false,
        state: "approval-requested"
      })
    ).toBe(true)
    expect(
      shouldRenderAssistantToolPart({
        showToolTraces: false,
        state: "output-available"
      })
    ).toBe(false)
    expect(
      shouldRenderAssistantToolPart({
        showToolTraces: true,
        state: "output-available"
      })
    ).toBe(true)
  })

  it("maps approval tool parts to HeroUI Pro requires-action state", () => {
    expect(mapAssistantToolPartStateToChatToolState("approval-requested")).toBe(
      "requires-action"
    )
    expect(mapAssistantToolPartStateToChatToolState("input-streaming")).toBe(
      "input-streaming"
    )
    expect(mapAssistantToolPartStateToChatToolState("output-denied")).toBe(
      "output-error"
    )
  })

  it("extracts thinking blocks from assistant text", () => {
    expect(
      splitAssistantTextSegments(
        "Before\n<antThinking>\nNeed to inspect files.\n</antThinking>\nAfter"
      )
    ).toEqual([
      {
        text: "Before",
        type: "text"
      },
      {
        text: "Need to inspect files.",
        type: "thinking"
      },
      {
        text: "After",
        type: "text"
      }
    ])
  })

  it("hides parsed transcript segments when regular tool traces are hidden", () => {
    expect(
      splitAssistantRenderableTextSegments({
        showToolTraces: false,
        text: [
          "Before",
          "<antThinking>internal plan</antThinking>",
          "Executed in /repo",
          "bash",
          "git status",
          "0",
          "<function_calls>",
          '<invoke name="bash">',
          '<parameter name="command">git diff</parameter>',
          "</invoke>",
          "</function_calls>",
          "After"
        ].join("\n")
      })
    ).toEqual([
      {
        text: "Before",
        type: "text"
      },
      {
        text: "After",
        type: "text"
      }
    ])
  })

  it("extracts executed command transcript blocks", () => {
    expect(
      splitAssistantTextSegments(
        [
          "Running check:",
          "Executed in /Users/example/project",
          "bash",
          "git status --short",
          " M src/main.ts",
          "0",
          "Done."
        ].join("\n")
      )
    ).toEqual([
      {
        text: "Running check:",
        type: "text"
      },
      {
        command: "git status --short",
        cwd: "/Users/example/project",
        exitCode: 0,
        output: " M src/main.ts",
        repeatCount: 1,
        shell: "bash",
        type: "executed-command"
      },
      {
        text: "Done.",
        type: "text"
      }
    ])
  })

  it("extracts function call transcript blocks", () => {
    expect(
      splitAssistantTextSegments(
        [
          "我来查看一下当前项目的 Git 状态：",
          "",
          "<function_calls>",
          '<invoke name="bash">',
          '<parameter name="command">git status &amp;&amp; git diff --stat</parameter>',
          '<parameter name="cwd">/Users/example/project</parameter>',
          "</invoke>",
          "</function_calls>",
          "",
          "Done."
        ].join("\n")
      )
    ).toEqual([
      {
        text: "我来查看一下当前项目的 Git 状态：",
        type: "text"
      },
      {
        name: "bash",
        parameters: [
          {
            name: "command",
            value: "git status && git diff --stat"
          },
          {
            name: "cwd",
            value: "/Users/example/project"
          }
        ],
        type: "function-call"
      },
      {
        text: "Done.",
        type: "text"
      }
    ])
  })

  it("does not leak malformed function call closing tags", () => {
    expect(
      splitAssistantTextSegments(
        [
          "<function_calls>",
          '<invoke name="bash">',
          '<parameter name="command">git diff --stat</parameter>',
          "</invoke>",
          "</invoke>",
          "After"
        ].join("\n")
      )
    ).toEqual([
      {
        name: "bash",
        parameters: [
          {
            name: "command",
            value: "git diff --stat"
          }
        ],
        type: "function-call"
      },
      {
        text: "After",
        type: "text"
      }
    ])
  })

  it("compacts repeated command transcripts", () => {
    const repeatedTranscript = [
      "I will inspect git.",
      "Executed in /repo",
      "bash",
      "git status",
      "0"
    ].join("\n")

    expect(
      splitAssistantTextSegments(
        [repeatedTranscript, repeatedTranscript, repeatedTranscript].join("\n")
      )
    ).toEqual([
      {
        text: "I will inspect git.",
        type: "text"
      },
      {
        command: "git status",
        cwd: "/repo",
        exitCode: 0,
        output: "",
        repeatCount: 3,
        shell: "bash",
        type: "executed-command"
      }
    ])
  })
})
