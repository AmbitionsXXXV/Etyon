import { z } from "zod"

const EnvironmentKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z\d_]*$/u)
const HeaderKeySchema = z
  .string()
  .regex(/^[!#$%&'*+\-.^_`|~A-Za-z\d]+$/u)
  .refine(
    (value) =>
      ![
        "connection",
        "content-length",
        "host",
        "transfer-encoding",
        "upgrade"
      ].includes(value.toLowerCase()),
    "Transport headers cannot be overridden"
  )
const CredentialValueSchema = z
  .string()
  .max(8192)
  .regex(/^[^\r\n\0]*$/u)
const boundedCredentials = (key: z.ZodString) =>
  z
    .record(key, CredentialValueSchema)
    .refine(
      (value) => Object.keys(value).length <= 32,
      "At most 32 credential entries are allowed"
    )

const CommonServerFields = {
  enabled: z.boolean().default(false),
  encryptedCredentials: z
    .string()
    .max(512 * 1024)
    .optional(),
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(100),
  protocol: z.enum(["auto", "legacy", "modern"]).default("legacy")
}
export const McpServerSchema = z.discriminatedUnion("transport", [
  z.object({
    ...CommonServerFields,
    args: z.array(z.string().max(4096)).max(40).default([]),
    command: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .regex(/^[^\r\n\0]+$/u),
    env: boundedCredentials(EnvironmentKeySchema).default({}),
    transport: z.literal("stdio")
  }),
  z.object({
    ...CommonServerFields,
    headers: boundedCredentials(HeaderKeySchema).default({}),
    transport: z.literal("http"),
    url: z
      .url()
      .max(8192)
      .refine((value) => {
        const url = new URL(value)
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.hash
        )
      }, "Only HTTP(S) endpoints without embedded credentials or fragments are allowed")
  })
])
export const McpSettingsSchema = z.object({
  servers: z
    .array(McpServerSchema)
    .max(8)
    .default([])
    .refine(
      (servers) =>
        new Set(servers.map((server) => server.id)).size === servers.length,
      "MCP server IDs must be unique"
    )
})
export type McpServerConfig = z.infer<typeof McpServerSchema>
export type McpSettings = z.infer<typeof McpSettingsSchema>
export const McpServerInputSchema = z.object({ serverId: z.string().min(1) })
export const McpStatusOutputSchema = z.object({
  statuses: z.array(
    z.object({
      catalogTruncated: z.boolean(),
      descriptionBytes: z.number(),
      error: z.string().nullable(),
      serverId: z.string(),
      state: z.enum(["connected", "connecting", "disconnected", "error"]),
      toolCount: z.number(),
      tools: z.array(z.object({ description: z.string(), name: z.string() }))
    })
  )
})
