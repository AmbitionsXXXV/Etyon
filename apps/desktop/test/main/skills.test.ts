import fs from "node:fs"
import path from "node:path"

import type { SkillsSettings } from "@etyon/rpc"
import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  buildSkillsSystemPrompt,
  listSkills,
  parseSkillFile
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
      description: "Use when editing React renderer code.",
      name: "react-patterns",
      path: skillPath,
      shortDescription: "Renderer React patterns"
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
          scope: "project"
        }),
        expect.objectContaining({
          name: "global-writing",
          projectPath: null,
          scope: "global"
        })
      ])
    )
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
})
