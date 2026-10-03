import type { McpServerConfig } from "@etyon/rpc"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import {
  protectMcpCredentials,
  readMcpCredentials,
  redactMcpError
} from "@/main/agents/mcp/credentials"
import {
  protectWebToolsCredentials,
  readWebToolsApiKey
} from "@/main/agents/web/credentials"

const state = vi.hoisted(() => ({
  backend: "keyring",
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  isLinux: false,
  secure: true
}))
vi.mock("electron", () => ({
  safeStorage: {
    decryptString: state.decrypt,
    encryptString: state.encrypt,
    getSelectedStorageBackend: () => state.backend,
    isEncryptionAvailable: () => state.secure
  }
}))
vi.mock("@electron-toolkit/utils", () => ({
  platform: {
    get isLinux() {
      return state.isLinux
    }
  }
}))
vi.mock("@/main/agents/agent-event-store", () => ({
  redactSecretsFromJson: (value: string) => value
}))
const server: McpServerConfig = {
  enabled: false,
  headers: { Authorization: "Bearer fixture-secret" },
  id: "server",
  name: "Fixture",
  protocol: "legacy",
  transport: "http",
  url: "https://example.com/mcp"
}
beforeEach(() => {
  state.backend = "keyring"
  state.isLinux = false
  state.secure = true
  state.encrypt
    .mockReset()
    .mockImplementation((value: string) => Buffer.from(`cipher:${value}`))
  state.decrypt
    .mockReset()
    .mockImplementation((value: Buffer) => value.toString("utf-8").slice(7))
})

describe("network credential storage", () => {
  it("encrypts MCP headers and env and returns no plaintext in settings", () => {
    const protectedSettings = protectMcpCredentials({
      servers: [
        server,
        {
          args: [],
          command: "node",
          enabled: false,
          env: { FIXTURE_SECRET: "private-value" },
          id: "stdio",
          name: "Fixture",
          protocol: "legacy",
          transport: "stdio"
        }
      ]
    })
    expect(protectedSettings.servers[0]).toMatchObject({ headers: {} })
    expect(protectedSettings.servers[1]).toMatchObject({ env: {} })
    const [first] = protectedSettings.servers
    if (!first) {
      throw new Error("Expected server")
    }
    expect(readMcpCredentials(first)).toEqual(server.headers)
    expect(protectMcpCredentials(protectedSettings)).toEqual(protectedSettings)
  })
  it("encrypts the search key and reads it only on the main side", () => {
    const value = protectWebToolsCredentials({
      enabled: true,
      searchApiKey: "fixture-search-secret",
      searchProvider: "brave"
    })
    expect(value.searchApiKey).toBe("")
    expect(value.encryptedApiKey).toBeTruthy()
    expect(readWebToolsApiKey(value)).toBe("fixture-search-secret")
  })
  it("rejects unavailable secure storage and Linux basic_text for both kinds of credentials", () => {
    for (const failure of [
      { isLinux: false, secure: false },
      { isLinux: true, secure: true }
    ]) {
      Object.assign(state, failure, { backend: "basic_text" })
      expect(() => protectMcpCredentials({ servers: [server] })).toThrow(
        "keyring"
      )
      expect(() =>
        protectWebToolsCredentials({
          enabled: true,
          searchApiKey: "fixture-key",
          searchProvider: "brave"
        })
      ).toThrow("keyring")
    }
  })
  it("hides invalid ciphertext and exact configured credentials from errors", () => {
    state.decrypt.mockImplementation(() => {
      throw new Error("ciphertext-containing-secret")
    })
    expect(() =>
      readMcpCredentials({ ...server, encryptedCredentials: "invalid" })
    ).toThrow("MCP credentials are invalid")
    expect(() =>
      readWebToolsApiKey({
        enabled: true,
        encryptedApiKey: "invalid",
        searchApiKey: "",
        searchProvider: "brave"
      })
    ).toThrow("Save a new key")
    expect(
      redactMcpError(new Error("Error Bearer fixture-secret"), server)
    ).toBe("Error [REDACTED]")
  })
})
