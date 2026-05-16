import * as z from "zod"

export const SkillScopeSchema = z.enum(["global", "project"])

export const SkillsSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  includeGlobal: z.boolean().default(true),
  includeProject: z.boolean().default(true),
  maxContextSkills: z.number().int().min(1).max(12).default(4)
})

export const ParsedSkillSchema = z.object({
  body: z.string(),
  description: z.string(),
  name: z.string(),
  path: z.string(),
  projectPath: z.string().nullable(),
  scope: SkillScopeSchema,
  shortDescription: z.string().nullable()
})

export const SkillsListOutputSchema = z.object({
  skills: z.array(ParsedSkillSchema)
})

export type ParsedSkill = z.infer<typeof ParsedSkillSchema>
export type SkillScope = z.infer<typeof SkillScopeSchema>
export type SkillsListOutput = z.infer<typeof SkillsListOutputSchema>
export type SkillsSettings = z.infer<typeof SkillsSettingsSchema>
