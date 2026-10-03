import { describe, expect, it } from "vite-plus/test"

import { McpSettingsSchema } from "../../src/schemas/mcp"
import { WebSearchInputSchema } from "../../src/schemas/web-tools"

const server = {
  enabled: false,
  headers: {},
  id: "test",
  name: "Test",
  transport: "http",
  url: "https://example.com/mcp"
}
describe("network tool settings schemas", () => {
  it("rejects duplicate server IDs, invalid auth URLs and transport header overrides", () => {
    expect(
      McpSettingsSchema.safeParse({ servers: [server, server] }).success
    ).toBe(false)
    expect(
      McpSettingsSchema.safeParse({
        servers: [{ ...server, url: "https://user:secret@example.com/mcp" }]
      }).success
    ).toBe(false)
    expect(
      McpSettingsSchema.safeParse({
        servers: [{ ...server, headers: { Host: "another.example" } }]
      }).success
    ).toBe(false)
    expect(
      McpSettingsSchema.safeParse({
        servers: [
          { ...server, headers: { Authorization: "Bearer valid-fixture" } }
        ]
      }).success
    ).toBe(true)
    expect(
      McpSettingsSchema.safeParse({
        servers: [
          { ...server, headers: { Authorization: "Bearer bad\r\nheader" } }
        ]
      }).success
    ).toBe(false)
  })
  it("enforces Brave's character and word limits", () => {
    expect(
      WebSearchInputSchema.safeParse({ query: "x".repeat(600) }).success
    ).toBe(true)
    expect(
      WebSearchInputSchema.safeParse({ query: "x".repeat(601) }).success
    ).toBe(false)
    expect(
      WebSearchInputSchema.safeParse({ query: "word ".repeat(76) }).success
    ).toBe(false)
    expect(WebSearchInputSchema.safeParse({ query: "  " }).success).toBe(false)
  })
})
