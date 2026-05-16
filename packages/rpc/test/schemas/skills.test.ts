import { describe, expect, it } from "vite-plus/test"

import {
  SkillsListOutputSchema,
  SkillsSettingsSchema
} from "../../src/schemas/skills"

describe("skills schemas", () => {
  it("fills skills settings defaults", () => {
    expect(SkillsSettingsSchema.parse({})).toEqual({
      enabled: true,
      includeGlobal: true,
      includeProject: true,
      maxContextSkills: 4
    })
  })

  it("validates parsed global and project skills", () => {
    const output = SkillsListOutputSchema.parse({
      skills: [
        {
          body: "Use project conventions.",
          description: "Use when editing this project.",
          name: "project-skill",
          path: "/tmp/project/.agents/skills/project-skill/SKILL.md",
          projectPath: "/tmp/project",
          scope: "project",
          shortDescription: "Project conventions"
        },
        {
          body: "Use global conventions.",
          description: "Use for global workflows.",
          name: "global-skill",
          path: "/tmp/home/.codex/skills/global-skill/SKILL.md",
          projectPath: null,
          scope: "global",
          shortDescription: null
        }
      ]
    })

    expect(output.skills.map((skill) => skill.scope)).toEqual([
      "project",
      "global"
    ])
  })
})
