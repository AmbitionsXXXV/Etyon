import { describe, expect, it } from "vite-plus/test"

import { splitAssistantTextSegments } from "@/renderer/lib/chat/tool-ui"

describe("chat tool ui helpers", () => {
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
