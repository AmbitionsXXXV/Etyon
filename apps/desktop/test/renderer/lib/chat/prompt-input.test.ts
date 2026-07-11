import type { ParsedSkill, PromptTemplate } from "@etyon/rpc"
import { describe, expect, it, vi } from "vite-plus/test"

import type { PromptCommandPaletteItem } from "@/renderer/lib/chat/prompt-input"
import {
  PERMISSION_MODE_OPTIONS,
  applyMentionSelection,
  applyPlanCommandPrefixToPromptEditorJson,
  buildPromptEditorJsonFromMessage,
  createPromptTemplateCommandText,
  createMentionFromProjectSnapshotItem,
  extractPromptEditorPayload,
  filterPromptCommandPaletteItems,
  filterPromptTemplateItems,
  filterPromptSkillMentionItems,
  getActiveMentionMatch,
  getMentionTokenTypeLabel,
  getPromptEditorActiveCommandPaletteRange,
  getPromptEditorActiveMentionRange,
  getPromptEditorActivePromptTemplateCommandRange,
  getPromptTemplateArgumentHints,
  isPromptImeConfirmKeyDown,
  isPromptNativeCompositionKeyDown,
  isPlanModeKeyboardShortcut,
  isPromptSubmitKeyDown,
  replaceMentionQuery,
  splitPromptTextByMentions,
  scrollActiveMentionItemIntoView
} from "@/renderer/lib/chat/prompt-input"
import {
  PERMISSION_MODES,
  getNextPermissionMode
} from "@/shared/agents/permission-mode"

describe("prompt input helpers", () => {
  it("detects an active mention query at the caret", () => {
    expect(
      getActiveMentionMatch("请查看 @src/main", "请查看 @src/main".length)
    ).toEqual({
      query: "src/main",
      startIndex: 4,
      trigger: "project"
    })
    expect(
      getActiveMentionMatch("hello@src/main", "hello@src/main".length)
    ).toBeNull()
  })

  it("detects an empty mention query for a bare @ trigger", () => {
    expect(getActiveMentionMatch("请查看 @", "请查看 @".length)).toEqual({
      query: "",
      startIndex: 4,
      trigger: "project"
    })
  })

  it("detects a skill mention query for a $ trigger", () => {
    expect(getActiveMentionMatch("使用 $rust", "使用 $rust".length)).toEqual({
      query: "rust",
      startIndex: 3,
      trigger: "skill"
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

  it("prefixes prompt editor content with the plan command without losing mentions", () => {
    const documentNode = {
      content: [
        {
          content: [
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
              text: " 这块怎么改",
              type: "text"
            }
          ],
          type: "paragraph"
        }
      ],
      type: "doc"
    }

    expect(
      extractPromptEditorPayload(
        applyPlanCommandPrefixToPromptEditorJson(documentNode)
      )
    ).toEqual({
      mentions: [
        {
          kind: "file",
          path: "/project/src/renderer/index.ts",
          relativePath: "src/renderer/index.ts",
          snapshotId: "snapshot-1"
        }
      ],
      text: "/plan @src/renderer/index.ts 这块怎么改"
    })
  })

  it("does not duplicate an existing plan command prefix", () => {
    const documentNode = {
      content: [
        {
          content: [
            {
              text: "/plan 调整 agent runtime",
              type: "text"
            }
          ],
          type: "paragraph"
        }
      ],
      type: "doc"
    }

    expect(
      extractPromptEditorPayload(
        applyPlanCommandPrefixToPromptEditorJson(documentNode)
      ).text
    ).toBe("/plan 调整 agent runtime")
  })

  it("detects the plan mode keyboard shortcut", () => {
    expect(
      isPlanModeKeyboardShortcut({
        altKey: true,
        ctrlKey: true,
        key: "p",
        metaKey: false,
        shiftKey: false
      })
    ).toBe(true)
    expect(
      isPlanModeKeyboardShortcut({
        altKey: true,
        ctrlKey: false,
        key: "p",
        metaKey: true,
        shiftKey: false
      })
    ).toBe(false)
    expect(
      isPlanModeKeyboardShortcut({
        altKey: true,
        ctrlKey: true,
        key: "x",
        metaKey: false,
        shiftKey: false
      })
    ).toBe(false)
  })

  it("detects plain Enter as prompt submit but keeps Shift Enter editable", () => {
    expect(
      isPromptSubmitKeyDown({
        key: "Enter"
      })
    ).toBe(true)
    expect(
      isPromptSubmitKeyDown({
        key: "Enter",
        shiftKey: true
      })
    ).toBe(false)
  })

  it("detects IME composition Enter without treating it as submit", () => {
    expect(
      isPromptNativeCompositionKeyDown({
        key: "Enter",
        nativeEvent: {
          isComposing: true
        }
      })
    ).toBe(true)
    expect(
      isPromptNativeCompositionKeyDown({
        key: "Enter",
        nativeEvent: {
          keyCode: 229
        }
      })
    ).toBe(true)
    expect(
      isPromptImeConfirmKeyDown({
        event: {
          key: "Enter",
          nativeEvent: {
            isComposing: true
          }
        },
        isCompositionActive: false,
        isCompositionEndGuardActive: false
      })
    ).toBe(true)
    expect(
      isPromptImeConfirmKeyDown({
        event: {
          key: "Enter"
        },
        isCompositionActive: true,
        isCompositionEndGuardActive: false
      })
    ).toBe(true)
    expect(
      isPromptImeConfirmKeyDown({
        event: {
          key: "Enter"
        },
        isCompositionActive: false,
        isCompositionEndGuardActive: true
      })
    ).toBe(true)
    expect(
      isPromptImeConfirmKeyDown({
        event: {
          key: "Enter"
        },
        isCompositionActive: false,
        isCompositionEndGuardActive: false
      })
    ).toBe(false)
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
      to: 9,
      trigger: "project"
    })
  })

  it("maps the active prompt template command before the editor caret", () => {
    expect(
      getPromptEditorActivePromptTemplateCommandRange({
        selectionFrom: "/prompt review".length,
        textBeforeCaret: "/prompt review"
      })
    ).toEqual({
      from: 0,
      query: "review",
      to: 14
    })
    expect(
      getPromptEditorActivePromptTemplateCommandRange({
        selectionFrom: "/prompt review src".length,
        textBeforeCaret: "/prompt review src"
      })
    ).toBeNull()
  })

  it("maps the active slash command palette query before the editor caret", () => {
    expect(
      getPromptEditorActiveCommandPaletteRange({
        selectionFrom: "/pr".length,
        textBeforeCaret: "/pr"
      })
    ).toEqual({
      from: 0,
      query: "pr",
      to: 3
    })
    expect(
      getPromptEditorActiveCommandPaletteRange({
        selectionFrom: "/prompt review".length,
        textBeforeCaret: "/prompt review"
      })
    ).toBeNull()
  })

  it("filters slash command palette items", () => {
    const items: PromptCommandPaletteItem[] = [
      {
        command: "/plan",
        description: "Plan mode",
        id: "plan",
        insertText: "/plan ",
        label: "Plan"
      },
      {
        command: "/prompt",
        description: "Prompt template",
        id: "prompt",
        insertText: "/prompt ",
        label: "Prompt"
      }
    ]

    expect(
      filterPromptCommandPaletteItems({
        items,
        limit: 10,
        query: "tem"
      }).map((item) => item.id)
    ).toEqual(["prompt"])
  })

  it("filters and formats prompt template commands", () => {
    const templates: PromptTemplate[] = [
      {
        body: "Review $1",
        description: "Review a focused diff.",
        name: "review",
        path: "/project/.agents/skills/reviewer/prompts/review.md"
      },
      {
        body: "Plan $1",
        description: null,
        name: "quick plan",
        path: "/project/.agents/skills/planner/prompts/quick-plan.md"
      }
    ]

    expect(
      filterPromptTemplateItems({
        limit: 10,
        query: "diff",
        templates
      }).map((template) => template.name)
    ).toEqual(["review"])
    expect(createPromptTemplateCommandText(templates[1])).toBe(
      '/prompt "quick plan" '
    )
    expect(
      getPromptTemplateArgumentHints({
        body: "Review $2 then $1. Keep $$3 literal and reuse $2."
      })
    ).toEqual(["$1", "$2"])
  })

  it("filters skill suggestions by title only when requested", () => {
    const skills: ParsedSkill[] = [
      {
        body: "Use when working on Rust ownership and lifetimes.",
        capabilities: [],
        commands: [],
        description: "Rust code style guidance.",
        extensions: [],
        modelVisible: true,
        name: "coding-guidelines",
        path: "/project/.agents/skills/coding-guidelines/SKILL.md",
        projectPath: "/project",
        scope: "project",
        shortDescription: "Rust style",
        visible: true
      },
      {
        body: "Drizzle relations and schema examples.",
        capabilities: [],
        commands: [],
        description: "Type-safe SQL ORM.",
        extensions: [],
        modelVisible: true,
        name: "drizzle-orm",
        path: "/project/.agents/skills/drizzle-orm/SKILL.md",
        projectPath: "/project",
        scope: "project",
        shortDescription: "Database ORM",
        visible: true
      }
    ]

    expect(
      filterPromptSkillMentionItems({
        limit: 10,
        projectPath: "/project",
        query: "rust",
        searchMode: "title",
        skills: [...skills]
      })
    ).toEqual([])
    expect(
      filterPromptSkillMentionItems({
        limit: 10,
        projectPath: "/project",
        query: "coding guidelines",
        searchMode: "title",
        skills: [...skills]
      }).map((skill) => skill.name)
    ).toEqual(["coding-guidelines"])
    expect(
      filterPromptSkillMentionItems({
        limit: 10,
        projectPath: "/project",
        query: "rust",
        searchMode: "full",
        skills: [...skills]
      }).map((skill) => skill.name)
    ).toEqual(["coding-guidelines"])
  })

  it("rebuilds editor document json from a queued message and round-trips", () => {
    const message = {
      mentions: [
        {
          kind: "file" as const,
          path: "/project/src/renderer/index.ts",
          relativePath: "src/renderer/index.ts",
          snapshotId: "snapshot-1"
        }
      ],
      text: "请看 @src/renderer/index.ts 这块"
    }

    const documentNode = buildPromptEditorJsonFromMessage(message)

    expect(documentNode).toEqual({
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
    expect(extractPromptEditorPayload(documentNode)).toEqual(message)
  })

  it("rebuilds editor document json for plain text without mentions", () => {
    expect(
      buildPromptEditorJsonFromMessage({
        mentions: [],
        text: "重构 agent runtime"
      })
    ).toEqual({
      content: [
        {
          content: [
            {
              text: "重构 agent runtime",
              type: "text"
            }
          ],
          type: "paragraph"
        }
      ],
      type: "doc"
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

  it("maps every permission mode to a composer option and cycles in order", () => {
    expect(PERMISSION_MODE_OPTIONS.map((option) => option.id)).toEqual([
      ...PERMISSION_MODES
    ])

    for (const option of PERMISSION_MODE_OPTIONS) {
      expect(option.icon).toBeTruthy()
    }

    expect(PERMISSION_MODES.map((mode) => getNextPermissionMode(mode))).toEqual(
      ["acceptEdits", "bypass", "default"]
    )
  })
})
