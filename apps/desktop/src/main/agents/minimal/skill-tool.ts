import fs from "node:fs"
import path from "node:path"

import type { SkillsSettings } from "@etyon/rpc"
import { tool } from "ai"
import { z } from "zod"

import { isSecretWorkspacePath } from "@/main/agents/minimal/workspace-core"
import { listSkills } from "@/main/skills"

const MAX_FILE_BYTES = 1_000_000
export const SkillInputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("list"),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
      query: z.string().default("")
    })
    .strict(),
  z
    .object({
      action: z.literal("load"),
      limit: z.number().int().min(1).max(12_000).default(12_000),
      offset: z.number().int().min(0).max(MAX_FILE_BYTES).default(0),
      path: z
        .string()
        .min(1)
        .describe("Exact SKILL.md path from the skill catalog."),
      reference: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Supporting file relative to the skill directory. Omit to load SKILL.md. Never executes scripts."
        )
    })
    .strict()
])

export const buildSkillTool = ({
  projectPath,
  settings
}: {
  projectPath: string
  settings: SkillsSettings
}) =>
  tool({
    description:
      "Discover skills by name/description with action=list, then load a relevant SKILL.md with action=load and its catalog path. Load referenced files using reference relative to that skill's directory; offset/limit page by characters. No slash command is required. These are instructions only: no execution, new tools, or permission changes. Model-disabled skills are unavailable.",
    execute: (input) => {
      const skills = settings.enabled
        ? listSkills({ projectPaths: [projectPath] }).filter(
            (skill) =>
              skill.modelVisible &&
              (skill.scope === "project"
                ? settings.includeProject
                : settings.includeGlobal)
          )
        : []
      if (input.action === "list") {
        const query = input.query.trim().toLowerCase()
        const matches = skills.filter((skill) =>
          `${skill.name} ${skill.description}`.toLowerCase().includes(query)
        )
        return {
          skills: matches
            .slice(input.offset, input.offset + input.limit)
            .map((skill) => ({
              description: skill.description,
              name: skill.name,
              path: skill.path,
              scope: skill.scope
            })),
          total: matches.length
        }
      }

      const skill = skills.find((entry) => entry.path === input.path)
      if (!skill) {
        throw new Error(
          "Skill is unavailable. Use skill action=list to discover an enabled, model-visible skill."
        )
      }
      const skillRoot = fs.realpathSync(path.dirname(skill.path))
      if (input.reference && path.isAbsolute(input.reference)) {
        throw new Error(
          "Skill references must be relative to the skill directory."
        )
      }
      const requestedPath = input.reference
        ? path.resolve(skillRoot, input.reference)
        : skill.path
      const resolvedPath = fs.realpathSync(requestedPath)
      const relativePath = path.relative(skillRoot, resolvedPath)
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
      ) {
        throw new Error("Skill reference escapes its directory.")
      }
      if (
        isSecretWorkspacePath(requestedPath) ||
        isSecretWorkspacePath(resolvedPath)
      ) {
        throw new Error("Secret files cannot be loaded through skills.")
      }
      const stat = fs.statSync(resolvedPath)
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        throw new Error("Skill content must be a text file smaller than 1 MB.")
      }
      const text = fs.readFileSync(resolvedPath, "utf-8")
      if (text.includes("\u0000")) {
        throw new Error("Skill content must be text.")
      }
      const end = input.offset + input.limit
      return {
        content: text.slice(input.offset, end),
        nextOffset: end < text.length ? end : null,
        path: resolvedPath,
        referenceRoot: skillRoot,
        skill: skill.name,
        totalChars: text.length
      }
    },
    inputSchema: SkillInputSchema
  })
