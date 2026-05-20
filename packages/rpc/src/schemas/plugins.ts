import * as z from "zod"

export const BuiltInPluginIdSchema = z.enum(["cursor-auth"])

export const PluginCapabilitySchema = z.enum([
  "provider-auth",
  "provider-models"
])

export const PluginPermissionSchema = z.enum([
  "network:api2.cursor.sh",
  "network:cursor.com",
  "os:open-external-url",
  "storage:secrets"
])

export const BuiltInPluginSchema = z.object({
  capabilities: z.array(PluginCapabilitySchema),
  description: z.string(),
  enabled: z.boolean(),
  id: BuiltInPluginIdSchema,
  name: z.string(),
  permissions: z.array(PluginPermissionSchema)
})

export const PluginsListOutputSchema = z.object({
  plugins: z.array(BuiltInPluginSchema)
})

export const PluginsSetEnabledInputSchema = z.object({
  enabled: z.boolean(),
  pluginId: BuiltInPluginIdSchema
})

export const PluginsSetEnabledOutputSchema = PluginsListOutputSchema

export type BuiltInPlugin = z.infer<typeof BuiltInPluginSchema>
export type BuiltInPluginId = z.infer<typeof BuiltInPluginIdSchema>
export type PluginCapability = z.infer<typeof PluginCapabilitySchema>
export type PluginPermission = z.infer<typeof PluginPermissionSchema>
export type PluginsListOutput = z.infer<typeof PluginsListOutputSchema>
export type PluginsSetEnabledInput = z.infer<
  typeof PluginsSetEnabledInputSchema
>
export type PluginsSetEnabledOutput = z.infer<
  typeof PluginsSetEnabledOutputSchema
>
