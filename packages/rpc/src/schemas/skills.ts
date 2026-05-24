import * as z from "zod"

export const SkillScopeSchema = z.enum(["global", "project"])
export const SkillSourceSchema = z.object({
  kind: z.enum(["app", "project", "user"]),
  root: z.string()
})

export const SkillsSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  includeGlobal: z.boolean().default(true),
  includeProject: z.boolean().default(true),
  maxContextSkills: z.number().int().min(1).max(12).default(4)
})

export const ParsedSkillSchema = z.object({
  body: z.string(),
  capabilities: z.array(z.string()).default([]),
  description: z.string(),
  modelVisible: z.boolean().default(true),
  name: z.string(),
  path: z.string(),
  projectPath: z.string().nullable(),
  scope: SkillScopeSchema,
  shortDescription: z.string().nullable(),
  source: SkillSourceSchema.optional(),
  visible: z.boolean().default(true)
})

export const PromptTemplateSchema = z.object({
  body: z.string(),
  description: z.string().nullable(),
  name: z.string(),
  path: z.string()
})

export const SkillsListOutputSchema = z.object({
  skills: z.array(ParsedSkillSchema)
})

export const PromptTemplatesListOutputSchema = z.object({
  templates: z.array(PromptTemplateSchema)
})

export type ParsedSkill = z.infer<typeof ParsedSkillSchema>
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>
export type PromptTemplatesListOutput = z.infer<
  typeof PromptTemplatesListOutputSchema
>
export type SkillScope = z.infer<typeof SkillScopeSchema>
export type SkillSource = z.infer<typeof SkillSourceSchema>
export type SkillsListOutput = z.infer<typeof SkillsListOutputSchema>
export type SkillsSettings = z.infer<typeof SkillsSettingsSchema>
