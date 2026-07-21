import { describe, expect, it } from "vite-plus/test"

import { buildRendererContentSecurityPolicy } from "@/main/content-security-policy"

const LOCAL_CHAT_SERVER_SOURCE = "http://127.0.0.1:*"

describe("renderer content security policy", () => {
  it("allows only the dynamic loopback chat server in production", () => {
    const policy = buildRendererContentSecurityPolicy()

    expect(policy).toContain(`connect-src 'self' ${LOCAL_CHAT_SERVER_SOURCE}`)
    expect(policy).not.toContain("connect-src 'self' https:")
  })

  it("keeps the loopback chat server allowed alongside the Vite dev origin", () => {
    const policy = buildRendererContentSecurityPolicy("http://localhost:5173")

    expect(policy).toContain(
      `connect-src 'self' ${LOCAL_CHAT_SERVER_SOURCE} http://localhost:5173 ws: wss:`
    )
  })
})
