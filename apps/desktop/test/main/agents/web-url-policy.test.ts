import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import {
  isPublicAddress,
  parsePublicUrl,
  resolvePublicTarget
} from "@/main/agents/web/url-policy"

const state = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock("node:dns/promises", () => ({ lookup: state.lookup }))
beforeEach(() => {
  state.lookup.mockReset()
})

describe("public web URL policy", () => {
  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "1.1.1.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888"
  ])("allows public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.31.255.255",
    "192.168.1.1",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:192.168.1.1",
    "::ffff:c0a8:101",
    "64:ff9b::a00:1",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "2001:0db8::1",
    "2002:7f00:1::1",
    "3fff:1::1"
  ])("rejects private or reserved address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })
  it.each([
    "http://localhost/",
    "http://localhost./",
    "http://app.local/",
    "http://service.internal/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "https://user:password@example.com/",
    "file:///tmp/data",
    "http://[::ffff:7f00:1]/"
  ])("rejects URL %s before a request", (url) => {
    expect(() => parsePublicUrl(url)).toThrow()
  })
  it("rejects mixed DNS answers instead of choosing a public address", async () => {
    state.lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 }
    ])
    await expect(resolvePublicTarget("https://example.com")).rejects.toThrow(
      "private"
    )
  })
  it("pins a public DNS answer and removes the fragment", async () => {
    state.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }])
    expect(
      await resolvePublicTarget("https://example.com/article#section")
    ).toMatchObject({ address: "93.184.216.34" })
    expect(parsePublicUrl("https://example.com/article#section").href).toBe(
      "https://example.com/article"
    )
  })
  it("cancels a DNS lookup without waiting for it to finish", async () => {
    state.lookup.mockReturnValue(Promise.race([]))
    const controller = new AbortController()
    const pending = resolvePublicTarget(
      "https://example.com",
      controller.signal
    )
    controller.abort(new Error("DNS cancelled"))
    await expect(pending).rejects.toThrow("DNS cancelled")
  })
})
