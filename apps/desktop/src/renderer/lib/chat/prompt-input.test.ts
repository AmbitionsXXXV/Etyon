import { describe, expect, it } from "vitest"

import {
  applyMentionSelection,
  getActiveMentionMatch,
  replaceMentionQuery
} from "./prompt-input"

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
})
