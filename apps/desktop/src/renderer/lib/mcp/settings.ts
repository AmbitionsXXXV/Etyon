import { McpServerSchema } from "@etyon/rpc"
import type { McpServerConfig } from "@etyon/rpc"

export const updateMcpServerFromEditor = (
  editor: string,
  servers: McpServerConfig[],
  editingId: string | null
): McpServerConfig[] => {
  const input: unknown = JSON.parse(editor)
  const parsed = McpServerSchema.parse(input)
  if (editingId !== null && parsed.id !== editingId) {
    throw new Error("A server ID cannot be changed while editing")
  }
  if (editingId === null && servers.some((server) => server.id === parsed.id)) {
    throw new Error("A server with this ID already exists")
  }
  const original = servers.find((server) => server.id === parsed.id)
  const { encryptedCredentials: _credentials, ...configuration } = parsed
  const server: McpServerConfig = original?.encryptedCredentials
    ? { ...configuration, encryptedCredentials: original.encryptedCredentials }
    : configuration
  return original
    ? servers.map((entry) => (entry.id === server.id ? server : entry))
    : [...servers, server]
}

export const removeMcpCredentials = (
  server: McpServerConfig
): McpServerConfig => {
  const { encryptedCredentials: _credentials, ...configuration } = server
  return configuration.transport === "stdio"
    ? { ...configuration, env: {} }
    : { ...configuration, headers: {} }
}
