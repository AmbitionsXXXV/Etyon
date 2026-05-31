import fs from "node:fs"
import path from "node:path"

import type { SkillsSettings } from "@etyon/rpc"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  buildSkillsSystemPrompt,
  formatSkillInvocation,
  formatModelDisabledSkillReferencesForSystemPrompt,
  formatSkillsForSystemPrompt,
  listSkillPromptTemplates,
  listSkills,
  parseSkillFile,
  resolveSelectedSkillCapabilities,
  resolveSelectedSkillExtensionPaths
} from "@/main/skills"

const { mockedHomeDir } = vi.hoisted(() => ({
  mockedHomeDir: `/tmp/etyon-skills-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedHomeDir
  }
}))

const enabledSkillsSettings: SkillsSettings = {
  enabled: true,
  includeGlobal: true,
  includeProject: true,
  maxContextSkills: 4
}

const writeSkill = ({
  body = "Follow these instructions.",
  description,
  name,
  root
}: {
  body?: string
  description: string
  name: string
  root: string
}) => {
  const skillDir = path.join(root, name)

  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "metadata:",
      `  short-description: ${description.slice(0, 24)}`,
      "---",
      "",
      body
    ].join("\n")
  )
}

describe("skills", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("parses SKILL.md frontmatter and body", () => {
    const skillPath = path.join(mockedHomeDir, "parse-skill", "SKILL.md")

    fs.mkdirSync(path.dirname(skillPath), { recursive: true })
    fs.writeFileSync(
      skillPath,
      [
        "---",
        "name: react-patterns",
        "description: Use when editing React renderer code.",
        "capabilities:",
        "  - tools",
        "  - context-loaders",
        "commands:",
        "  - name: review",
        "    description: Review current diff",
        "    flags:",
        "      - --strict",
        "      - --write",
        "  - inspect",
        "extensions:",
        "  - ./agent-extension.mjs",
        "  - extensions/code-tool.mjs",
        "metadata:",
        "  short-description: Renderer React patterns",
        "---",
        "",
        "# React Patterns",
        "",
        "Keep components outside other components."
      ].join("\n")
    )

    expect(parseSkillFile(skillPath)).toEqual({
      body: "# React Patterns\n\nKeep components outside other components.",
      capabilities: ["tools", "context-loaders"],
      commands: [
        {
          description: "Review current diff",
          flags: ["--strict", "--write"],
          name: "review"
        },
        {
          description: null,
          flags: [],
          name: "inspect"
        }
      ],
      description: "Use when editing React renderer code.",
      extensions: ["./agent-extension.mjs", "extensions/code-tool.mjs"],
      modelVisible: true,
      name: "react-patterns",
      path: skillPath,
      shortDescription: "Renderer React patterns",
      visible: true
    })
  })

  it("lists project and global skills from known roots", () => {
    const projectPath = path.join(mockedHomeDir, "project-a")

    writeSkill({
      description: "Use when editing the current project.",
      name: "project-editing",
      root: path.join(projectPath, ".agents", "skills")
    })
    writeSkill({
      description: "Use when doing reusable global writing work.",
      name: "global-writing",
      root: path.join(mockedHomeDir, ".codex", "skills")
    })

    const skills = listSkills({
      projectPaths: [projectPath]
    })

    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "project-editing",
          projectPath,
          scope: "project",
          source: {
            kind: "project",
            root: path.join(projectPath, ".agents", "skills")
          }
        }),
        expect.objectContaining({
          name: "global-writing",
          projectPath: null,
          scope: "global",
          source: {
            kind: "user",
            root: path.join(mockedHomeDir, ".codex", "skills")
          }
        })
      ])
    )
  })

  it("resolves capabilities from explicitly selected skill mentions", () => {
    const projectPath = path.join(mockedHomeDir, "project-capabilities")
    const skillDir = path.join(projectPath, ".agents", "skills", "write-skill")
    const skillPath = path.join(skillDir, "SKILL.md")

    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      skillPath,
      [
        "---",
        "name: write-skill",
        "description: Use when editing files.",
        "capabilities:",
        "  - write-fs",
        "  - shell",
        "---",
        "",
        "Use write tools carefully."
      ].join("\n")
    )

    expect(
      resolveSelectedSkillCapabilities({
        projectPath,
        selectedSkills: [
          {
            description: "Use when editing files.",
            kind: "skill",
            name: "write-skill",
            path: skillPath,
            projectPath,
            relativePath: "write-skill",
            scope: "project",
            shortDescription: null
          }
        ]
      })
    ).toEqual(["write-fs", "shell"])
  })

  it("resolves selected skill extension modules inside the skill directory", () => {
    const projectPath = path.join(mockedHomeDir, "project-extensions")
    const skillDir = path.join(projectPath, ".agents", "skills", "tool-skill")
    const skillPath = path.join(skillDir, "SKILL.md")

    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      skillPath,
      [
        "---",
        "name: tool-skill",
        "description: Use when binding custom tools.",
        "extensions:",
        "  - ./agent-extension.mjs",
        "  - extensions/reviewer.mjs",
        "  - ../escape.mjs",
        `  - ${path.join(mockedHomeDir, "external.mjs")}`,
        "---",
        "",
        "Register custom tools."
      ].join("\n")
    )

    expect(
      resolveSelectedSkillExtensionPaths({
        projectPath,
        selectedSkills: [
          {
            description: "Use when binding custom tools.",
            kind: "skill",
            name: "tool-skill",
            path: skillPath,
            projectPath,
            relativePath: ".agents/skills/tool-skill/SKILL.md",
            scope: "project",
            shortDescription: null
          }
        ]
      })
    ).toEqual([
      path.join(skillDir, "agent-extension.mjs"),
      path.join(skillDir, "extensions", "reviewer.mjs")
    ])
  })

  it("builds a skill prompt from matching project and global skills", () => {
    const projectPath = path.join(mockedHomeDir, "project-b")

    writeSkill({
      body: "Use the project renderer conventions.",
      description: "Use when editing renderer code.",
      name: "renderer-project",
      root: path.join(projectPath, ".agents", "skills")
    })
    writeSkill({
      body: "Use concise user-facing copy.",
      description: "Use when improving copy and wording.",
      name: "copy-global",
      root: path.join(mockedHomeDir, ".codex", "skills")
    })

    const prompt = buildSkillsSystemPrompt({
      projectPath,
      query: "Please improve renderer code and copy",
      settings: enabledSkillsSettings
    })

    expect(prompt).toContain("renderer-project")
    expect(prompt).toContain("copy-global")
    expect(prompt).toContain("Use the project renderer conventions.")
    expect(prompt).toContain("Use concise user-facing copy.")
    expect(prompt).toContain("<skills>")
    expect(prompt).toContain("<skill>")
  })

  it("respects project and global skill settings", () => {
    const projectPath = path.join(mockedHomeDir, "project-c")

    writeSkill({
      description: "Use when editing project code.",
      name: "project-only",
      root: path.join(projectPath, ".agents", "skills")
    })
    writeSkill({
      description: "Use when editing project code globally.",
      name: "global-only",
      root: path.join(mockedHomeDir, ".agents", "skills")
    })

    const prompt = buildSkillsSystemPrompt({
      projectPath,
      query: "project code",
      settings: {
        ...enabledSkillsSettings,
        includeGlobal: false
      }
    })

    expect(prompt).toContain("project-only")
    expect(prompt).not.toContain("global-only")
  })

  it("keeps model-invisible skills listable but skips them in the system prompt", () => {
    const projectPath = path.join(mockedHomeDir, "project-d")
    const skillDir = path.join(projectPath, ".agents", "skills", "hidden-skill")
    const skillPath = path.join(skillDir, "SKILL.md")

    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      skillPath,
      [
        "---",
        "name: hidden-skill",
        "description: Use when the model should not see this.",
        "visible: true",
        "model-visible: false",
        "---",
        "",
        "Do not inject this body."
      ].join("\n")
    )

    const skills = listSkills({
      projectPaths: [projectPath]
    })

    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelVisible: false,
          name: "hidden-skill",
          visible: true
        })
      ])
    )
    expect(
      formatSkillsForSystemPrompt(
        skills.filter((skill) => skill.name === "hidden-skill")
      )
    ).toBe("")
  })

  it("formats model-visible skills as escaped XML", () => {
    expect(
      formatSkillsForSystemPrompt([
        {
          body: 'Use <button> & "quotes".',
          capabilities: ["tools"],
          commands: [
            {
              description: "Review renderer code.",
              flags: ["--strict"],
              name: "review"
            }
          ],
          description: "Renderer <rules>",
          extensions: [],
          modelVisible: true,
          name: "renderer",
          path: "/tmp/SKILL.md",
          projectPath: "/tmp/project",
          scope: "project",
          shortDescription: "Renderer rules",
          visible: true
        }
      ])
    ).toContain("Use &lt;button&gt; &amp; &quot;quotes&quot;.")
    expect(
      formatSkillsForSystemPrompt([
        {
          body: 'Use <button> & "quotes".',
          capabilities: ["tools"],
          commands: [
            {
              description: "Review renderer code.",
              flags: ["--strict"],
              name: "review"
            }
          ],
          description: "Renderer <rules>",
          extensions: [],
          modelVisible: true,
          name: "renderer",
          path: "/tmp/SKILL.md",
          projectPath: "/tmp/project",
          scope: "project",
          shortDescription: "Renderer rules",
          visible: true
        }
      ])
    ).toContain("<flag>--strict</flag>")
    expect(
      formatSkillsForSystemPrompt([
        {
          body: 'Use <button> & "quotes".',
          capabilities: ["tools"],
          commands: [],
          description: "Renderer <rules>",
          extensions: [],
          modelVisible: true,
          name: "renderer",
          path: "/tmp/SKILL.md",
          projectPath: "/tmp/project",
          scope: "project",
          shortDescription: "Renderer rules",
          visible: true
        }
      ])
    ).toContain("<capability>tools</capability>")
  })

  it("formats a direct skill invocation with additional instructions", () => {
    expect(
      formatSkillInvocation(
        {
          body: 'Use <inspection> tools & "quote" findings.',
          capabilities: ["read-fs"],
          commands: [],
          description: "Inspect things.",
          extensions: [],
          modelVisible: true,
          name: "inspect",
          path: "/tmp/project/.agents/skills/inspect/SKILL.md",
          projectPath: "/tmp/project",
          scope: "project",
          shortDescription: "Inspect",
          visible: true
        },
        "Check errors."
      )
    ).toBe(
      [
        "<skill_invocation>",
        "<skill>",
        "<name>inspect</name>",
        "<description>Inspect things.</description>",
        "<short_description>Inspect</short_description>",
        "<path>/tmp/project/.agents/skills/inspect/SKILL.md</path>",
        "<scope>project</scope>",
        "<reference_root>/tmp/project/.agents/skills/inspect</reference_root>",
        "<capabilities>",
        "<capability>read-fs</capability>",
        "</capabilities>",
        "<instructions>",
        "Use &lt;inspection&gt; tools &amp; &quot;quote&quot; findings.",
        "</instructions>",
        "</skill>",
        "<additional_instructions>",
        "Check errors.",
        "</additional_instructions>",
        "</skill_invocation>"
      ].join("\n")
    )
  })

  it("formats model-disabled skills as references without instructions", () => {
    const references = formatModelDisabledSkillReferencesForSystemPrompt([
      {
        body: "Hidden implementation details.",
        capabilities: ["context-loaders"],
        commands: [],
        description: "Use when a hidden skill is explicitly selected.",
        extensions: [],
        modelVisible: false,
        name: "hidden-reference",
        path: "/tmp/hidden-reference/SKILL.md",
        projectPath: "/tmp/project",
        scope: "project",
        shortDescription: "Hidden reference",
        visible: true
      }
    ])

    expect(references).toContain("<skill_references>")
    expect(references).toContain("<name>hidden-reference</name>")
    expect(references).toContain("<capability>context-loaders</capability>")
    expect(references).toContain("<model_visible>false</model_visible>")
    expect(references).not.toContain("Hidden implementation details.")
  })

  it("includes selected model-disabled skills as references in the prompt", () => {
    const projectPath = path.join(mockedHomeDir, "project-e")
    const skillDir = path.join(
      projectPath,
      ".agents",
      "skills",
      "hidden-selected"
    )
    const skillPath = path.join(skillDir, "SKILL.md")

    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(
      skillPath,
      [
        "---",
        "name: hidden-selected",
        "description: Use when explicitly selected.",
        "model-disabled: true",
        "---",
        "",
        "Do not reveal this body."
      ].join("\n")
    )

    const prompt = buildSkillsSystemPrompt({
      projectPath,
      query: "",
      selectedSkills: [
        {
          description: "Use when explicitly selected.",
          kind: "skill",
          name: "hidden-selected",
          path: skillPath,
          projectPath,
          relativePath: ".agents/skills/hidden-selected/SKILL.md",
          scope: "project",
          shortDescription: null
        }
      ],
      settings: enabledSkillsSettings
    })

    expect(prompt).toContain("<skill_references>")
    expect(prompt).toContain("<name>hidden-selected</name>")
    expect(prompt).not.toContain("Do not reveal this body.")
  })

  it("loads prompt templates from skill prompt directories", () => {
    const projectPath = path.join(mockedHomeDir, "project-f")
    const skillDir = path.join(projectPath, ".agents", "skills", "review-skill")
    const promptsDir = path.join(skillDir, "prompts")

    writeSkill({
      description: "Use when reviewing code.",
      name: "review-skill",
      root: path.join(projectPath, ".agents", "skills")
    })
    fs.mkdirSync(promptsDir, { recursive: true })
    fs.writeFileSync(
      path.join(promptsDir, "review.md"),
      [
        "---",
        "name: Review Current Diff",
        "description: Review the current diff",
        "---",
        "Review $1 for regressions."
      ].join("\n")
    )
    fs.mkdirSync(path.join(promptsDir, "nested"))
    fs.writeFileSync(path.join(promptsDir, "nested", "ignored.md"), "Ignore")

    expect(
      listSkillPromptTemplates({
        projectPaths: [projectPath]
      })
    ).toEqual([
      {
        body: "Review $1 for regressions.",
        description: "Review the current diff",
        name: "Review Current Diff",
        path: path.join(promptsDir, "review.md")
      }
    ])
  })
})
