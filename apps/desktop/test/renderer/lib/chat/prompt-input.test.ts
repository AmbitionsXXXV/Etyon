import { describe, expect, it } from "vite-plus/test"

import {
  applyMentionSelection,
  createMentionFromProjectSnapshotItem,
  getActiveMentionMatch,
  replaceMentionQuery
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
})
