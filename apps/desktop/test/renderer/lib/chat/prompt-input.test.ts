import { describe, expect, it, vi } from "vite-plus/test"

import {
  applyMentionSelection,
  createMentionFromProjectSnapshotItem,
  extractPromptEditorPayload,
  getActiveMentionMatch,
  getMentionTokenTypeLabel,
  getPromptEditorActiveMentionRange,
  replaceMentionQuery,
  splitPromptTextByMentions,
  scrollActiveMentionItemIntoView
} from "@/renderer/lib/chat/prompt-input"

describe("prompt input helpers", () => {
  it("detects an active mention query at the caret", () => {
    expect(
      getActiveMentionMatch("请查看 @src/main", "请查看 @src/main".length)
    ).toEqual({
      query: "src/main",
      startIndex: 4
    })
    expect(
      getActiveMentionMatch("hello@src/main", "hello@src/main".length)
    ).toBeNull()
  })

  it("detects an empty mention query for a bare @ trigger", () => {
    expect(getActiveMentionMatch("请查看 @", "请查看 @".length)).toEqual({
      query: "",
      startIndex: 4
    })
  })

  it("replaces the active mention query text", () => {
    expect(
      replaceMentionQuery({
        nextQuery: "src/renderer",
        selectionEnd: "请查看 @src".length,
        startIndex: 4,
        text: "请查看 @src"
      })
    ).toEqual({
      nextCaretIndex: 17,
      nextText: "请查看 @src/renderer"
    })
  })

  it("removes the inline mention query after selecting a file token", () => {
    expect(
      applyMentionSelection({
        selectionEnd: "请查看 @src/main".length,
        startIndex: 4,
        text: "请查看 @src/main"
      })
    ).toEqual({
      nextCaretIndex: 4,
      nextText: "请查看 "
    })
  })

  it("creates file and folder mentions from project snapshot items", () => {
    expect(
      createMentionFromProjectSnapshotItem({
        kind: "file",
        language: "typescript",
        mtimeMs: 100,
        path: "/project/src/main.ts",
        relativePath: "src/main.ts",
        size: 120,
        snapshotId: "snapshot-1"
      })
    ).toEqual({
      kind: "file",
      path: "/project/src/main.ts",
      relativePath: "src/main.ts",
      snapshotId: "snapshot-1"
    })
    expect(
      createMentionFromProjectSnapshotItem({
        fileCount: 2,
        kind: "folder",
        path: "/project/src",
        relativePath: "src",
        snapshotId: "snapshot-1"
      })
    ).toEqual({
      kind: "folder",
      path: "/project/src",
      relativePath: "src",
      snapshotId: "snapshot-1"
    })
  })

  it("scrolls the active mention candidate into the visible list range", () => {
    const scrollIntoView = vi.fn()

    scrollActiveMentionItemIntoView({
      scrollIntoView
    })

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest"
    })
  })

  it("formats inline mention token type labels", () => {
    expect(
      getMentionTokenTypeLabel({
        kind: "file",
        relativePath: "src/renderer/index.ts"
      })
    ).toBe("TS")
    expect(
      getMentionTokenTypeLabel({
        kind: "folder",
        relativePath: "src/renderer"
      })
    ).toBe("DIR")
  })

  it("extracts inline mention nodes back into text order and structured mentions", () => {
    expect(
      extractPromptEditorPayload({
        content: [
          {
            content: [
              {
                text: "请看 ",
                type: "text"
              },
              {
                attrs: {
                  kind: "file",
                  path: "/project/src/renderer/index.ts",
                  relativePath: "src/renderer/index.ts",
                  snapshotId: "snapshot-1"
                },
                type: "projectMention"
              },
              {
                text: " 这块",
                type: "text"
              }
            ],
            type: "paragraph"
          }
        ],
        type: "doc"
      })
    ).toEqual({
      mentions: [
        {
          kind: "file",
          path: "/project/src/renderer/index.ts",
          relativePath: "src/renderer/index.ts",
          snapshotId: "snapshot-1"
        }
      ],
      text: "请看 @src/renderer/index.ts 这块"
    })
  })

  it("maps the active mention query before the editor caret to a document range", () => {
    expect(
      getPromptEditorActiveMentionRange({
        selectionFrom: 9,
        textBeforeCaret: "请看 @src"
      })
    ).toEqual({
      from: 5,
      query: "src",
      to: 9
    })
  })

  it("splits prompt text into ordered inline mention display parts", () => {
    expect(
      splitPromptTextByMentions({
        mentions: [
          {
            kind: "file",
            path: "/project/src/index.ts",
            relativePath: "src/index.ts",
            snapshotId: "snapshot-1"
          }
        ],
        text: "请看 @src/index.ts 这块"
      })
    ).toEqual([
      {
        text: "请看 ",
        type: "text"
      },
      {
        mention: {
          kind: "file",
          path: "/project/src/index.ts",
          relativePath: "src/index.ts",
          snapshotId: "snapshot-1"
        },
        type: "mention"
      },
      {
        text: " 这块",
        type: "text"
      }
    ])
  })
})
