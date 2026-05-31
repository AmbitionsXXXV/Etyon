import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vite-plus/test"

import {
  formatPromptTemplateInvocation,
  loadPromptTemplates,
  parseCommandArgs
} from "@/main/agents/prompt-templates"

const tempRoots: string[] = []

const createTempRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-prompts-"))
  tempRoots.push(root)

  return root
}

describe("agent prompt templates", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, {
        force: true,
        recursive: true
      })
    }
  })

  it("loads markdown templates from roots without recursing", () => {
    const root = createTempRoot()

    fs.writeFileSync(
      path.join(root, "review.md"),
      [
        "---",
        "name: Review Code",
        "description: Review a focused diff",
        "---",
        "Review $1 for regressions."
      ].join("\n")
    )
    fs.mkdirSync(path.join(root, "nested"))
    fs.writeFileSync(path.join(root, "nested", "ignored.md"), "Ignore me")

    expect(loadPromptTemplates([root])).toEqual([
      {
        body: "Review $1 for regressions.",
        description: "Review a focused diff",
        name: "Review Code",
        path: path.join(root, "review.md")
      }
    ])
  })

  it("uses the markdown file name when frontmatter is missing", () => {
    const root = createTempRoot()

    fs.writeFileSync(path.join(root, "quick-plan.md"), "Plan $1.")

    expect(loadPromptTemplates([root])).toEqual([
      {
        body: "Plan $1.",
        description: null,
        name: "quick-plan",
        path: path.join(root, "quick-plan.md")
      }
    ])
  })

  it("parses shell-style command arguments", () => {
    expect(
      parseCommandArgs("review \"src/main.ts\" 'risk notes' escaped\\ value")
    ).toEqual(["review", "src/main.ts", "risk notes", "escaped value"])
  })

  it("rejects unterminated quoted arguments", () => {
    expect(() => parseCommandArgs('review "missing end')).toThrow(
      "Unterminated quoted argument."
    )
  })

  it("formats a prompt template invocation with positional arguments", () => {
    const root = createTempRoot()
    const [template] = loadPromptTemplates([root])

    fs.writeFileSync(path.join(root, "unused.md"), "unused")

    expect(
      formatPromptTemplateInvocation(
        {
          body: "Review $1 against $2. Literal $$ stays.",
          description: "Review task",
          name: "review",
          path: "/templates/review.md"
        },
        ["current diff", "doc/agents.md"]
      )
    ).toBe(
      [
        "<prompt_template>",
        "<name>review</name>",
        "<description>Review task</description>",
        "<path>/templates/review.md</path>",
        "<content>",
        "Review current diff against doc/agents.md. Literal $ stays.",
        "</content>",
        "</prompt_template>"
      ].join("\n")
    )

    expect(template).toBeUndefined()
  })

  it("formats all positional arguments with the arguments placeholder", () => {
    expect(
      formatPromptTemplateInvocation(
        {
          body: "Review $1 with $ARGUMENTS. Literal $$ARGUMENTS stays.",
          description: null,
          name: "review",
          path: "/templates/review.md"
        },
        ["src/main.ts", "--strict", "check types"]
      )
    ).toContain(
      "Review src/main.ts with src/main.ts --strict check types. Literal $ARGUMENTS stays."
    )
  })
})
