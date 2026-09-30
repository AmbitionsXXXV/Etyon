import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { SkillsSettingsSchema } from "@etyon/rpc"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"

import {
  buildSkillTool,
  SkillInputSchema
} from "@/main/agents/minimal/skill-tool"
import { buildSkillsSystemPrompt } from "@/main/skills"

vi.mock("electron", () => ({
  app: { getPath: () => "/nonexistent-etyon-test-home" }
}))

const roots: string[] = []
const fixture = (frontmatter = "") => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-skills-"))
  roots.push(projectPath)
  const skillRoot = path.join(projectPath, ".agents", "skills", "review")
  fs.mkdirSync(skillRoot, { recursive: true })
  const skillPath = path.join(skillRoot, "SKILL.md")
  fs.writeFileSync(
    skillPath,
    `---\nname: review\ndescription: Use to review code.\n${frontmatter}---\nLoad references/guide.md and review the code.`
  )
  const settings = SkillsSettingsSchema.parse({ includeGlobal: false })
  const tool = buildSkillTool({ projectPath, settings })
  const execute = async (input: unknown) =>
    await tool.execute?.(SkillInputSchema.parse(input), {
      context: undefined as never,
      messages: [],
      toolCallId: "skill-1"
    })

  return { execute, projectPath, settings, skillPath, skillRoot, tool }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

describe("on-demand skill context", () => {
  it("catalogs automatic matches and loads explicitly selected instructions", () => {
    const { projectPath, settings, skillPath } = fixture()
    const options = {
      loadOnDemand: true,
      projectPath,
      query: "review code",
      settings
    }
    const prompt = buildSkillsSystemPrompt(options)
    expect(prompt).toContain("<available_skills>")
    expect(prompt).toContain(skillPath)
    expect(prompt).not.toContain("Load references/guide.md")

    const selected = buildSkillsSystemPrompt({
      ...options,
      selectedSkills: [
        {
          description: "Use to review code.",
          kind: "skill",
          name: "review",
          path: skillPath,
          projectPath,
          relativePath: ".agents/skills/review/SKILL.md",
          scope: "project",
          shortDescription: null
        }
      ]
    })
    expect(selected).toContain("Load references/guide.md")
  })

  it("discovers and pages a skill and its references without executing them", async () => {
    const { execute, skillPath, skillRoot } = fixture()
    fs.mkdirSync(path.join(skillRoot, "references"))
    fs.writeFileSync(
      path.join(skillRoot, "references", "guide.md"),
      "123456789"
    )
    expect(await execute({ action: "list" })).toMatchObject({
      skills: [expect.objectContaining({ path: skillPath })],
      total: 1
    })
    expect(await execute({ action: "load", path: skillPath })).toMatchObject({
      content: expect.stringContaining("Load references/guide.md"),
      referenceRoot: fs.realpathSync(skillRoot)
    })
    expect(
      await execute({
        action: "load",
        limit: 3,
        offset: 2,
        path: skillPath,
        reference: "references/guide.md"
      })
    ).toMatchObject({ content: "345", nextOffset: 5, totalChars: 9 })
  })

  it("rejects arbitrary skill paths, traversal, symlink escapes, and secrets", async () => {
    const { execute, projectPath, skillPath, skillRoot } = fixture()
    const outside = path.join(projectPath, "outside.md")
    fs.writeFileSync(outside, "private")
    fs.symlinkSync(outside, path.join(skillRoot, "escape.md"))
    fs.writeFileSync(path.join(skillRoot, ".env"), "secret")
    await expect(execute({ action: "load", path: outside })).rejects.toThrow(
      "unavailable"
    )
    await expect(
      execute({
        action: "load",
        path: skillPath,
        reference: "../../../outside.md"
      })
    ).rejects.toThrow("escapes")
    await expect(
      execute({ action: "load", path: skillPath, reference: "escape.md" })
    ).rejects.toThrow("escapes")
    await expect(
      execute({ action: "load", path: skillPath, reference: ".env" })
    ).rejects.toThrow("Secret")
  })

  it("honors model invocation and scope settings", async () => {
    const { execute, projectPath, settings, skillPath, tool } = fixture(
      "disable-model-invocation: true\n"
    )
    expect(await execute({ action: "list" })).toMatchObject({
      skills: [],
      total: 0
    })
    await expect(execute({ action: "load", path: skillPath })).rejects.toThrow(
      "unavailable"
    )
    const disabled = buildSkillTool({
      projectPath,
      settings: { ...settings, includeProject: false }
    })
    expect(
      await disabled.execute?.(
        { action: "list", limit: 20, offset: 0, query: "" },
        { context: undefined as never, messages: [], toolCallId: "x" }
      )
    ).toMatchObject({ skills: [] })
    expect(tool.execute).toBeDefined()
  })
})
