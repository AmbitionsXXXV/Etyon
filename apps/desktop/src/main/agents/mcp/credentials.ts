import { platform } from "@electron-toolkit/utils"
import type { McpServerConfig, McpSettings } from "@etyon/rpc"
import { safeStorage } from "electron"

import { redactSecretsFromJson } from "@/main/agents/agent-event-store"

export const protectMcpCredentials = (settings: McpSettings): McpSettings => ({
  servers: settings.servers.map((server) => {
    const secrets = server.transport === "stdio" ? server.env : server.headers
    if (Object.keys(secrets).length === 0) {
      return server
    }
    if (
      !safeStorage.isEncryptionAvailable() ||
      (platform.isLinux &&
        safeStorage.getSelectedStorageBackend() === "basic_text")
    ) {
      throw new Error(
        "Secure credential storage is unavailable. Configure the system keyring before saving MCP credentials."
      )
    }
    const encryptedCredentials = safeStorage
      .encryptString(JSON.stringify(secrets))
      .toString("base64")
    return server.transport === "stdio"
      ? { ...server, encryptedCredentials, env: {} }
      : { ...server, encryptedCredentials, headers: {} }
  })
})

export const readMcpCredentials = (
  server: McpServerConfig
): Record<string, string> => {
  if (!server.encryptedCredentials) {
    return server.transport === "stdio" ? server.env : server.headers
  }
  try {
    const value: unknown = JSON.parse(
      safeStorage.decryptString(
        Buffer.from(server.encryptedCredentials, "base64")
      )
    )
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.values(value).some((entry) => typeof entry !== "string")
    ) {
      throw new Error("MCP credentials are invalid")
    }
    return value as Record<string, string>
  } catch {
    throw new Error("MCP credentials are invalid")
  }
}

export const redactMcpError = (
  error: unknown,
  server: McpServerConfig
): string => {
  let message = error instanceof Error ? error.message : "MCP connection failed"
  try {
    for (const secret of Object.values(readMcpCredentials(server))) {
      if (secret) {
        message = message.replaceAll(secret, "[REDACTED]")
      }
    }
  } catch {
    return "MCP credentials are invalid"
  }
  return redactSecretsFromJson(message).slice(0, 300)
}
