import type { McpServerConfig, WebToolsSettings } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  removeMcpCredentials,
  updateMcpServerFromEditor
} from "@/renderer/lib/mcp/settings"
import { updateWebToolsCredentials } from "@/renderer/lib/web-tools/settings"

const server: McpServerConfig = {
  enabled: false,
  encryptedCredentials: "saved-cipher",
  headers: {},
  id: "existing",
  name: "Fixture",
  protocol: "legacy",
  transport: "http",
  url: "https://example.com/mcp"
}
describe("network settings updates", () => {
  it("preserves credentials on edits, ignores editor ciphertext and rejects ID changes", () => {
    expect(
      updateMcpServerFromEditor(
        JSON.stringify({
          ...server,
          encryptedCredentials: "untrusted-cipher",
          name: "Updated"
        }),
        [server],
        server.id
      )[0]
    ).toMatchObject({ encryptedCredentials: "saved-cipher", name: "Updated" })
    expect(() =>
      updateMcpServerFromEditor(
        JSON.stringify({ ...server, id: "changed" }),
        [server],
        server.id
      )
    ).toThrow("ID")
    expect(() =>
      updateMcpServerFromEditor(JSON.stringify(server), [server], null)
    ).toThrow("already exists")
    expect(removeMcpCredentials(server)).not.toHaveProperty(
      "encryptedCredentials"
    )
  })
  it("keeps a key on same-provider edits and clears it on provider switches", () => {
    const current: WebToolsSettings = {
      enabled: true,
      encryptedApiKey: "saved-key",
      searchApiKey: "",
      searchProvider: "brave"
    }
    expect(updateWebToolsCredentials(current, "brave", "")).toHaveProperty(
      "encryptedApiKey",
      "saved-key"
    )
    expect(updateWebToolsCredentials(current, "tavily", "")).not.toHaveProperty(
      "encryptedApiKey"
    )
    expect(
      updateWebToolsCredentials(current, "tavily", " new-key ")
    ).toMatchObject({ searchApiKey: "new-key", searchProvider: "tavily" })
    expect(
      updateWebToolsCredentials(current, "brave", "new-key")
    ).not.toHaveProperty("encryptedApiKey")
  })
})
