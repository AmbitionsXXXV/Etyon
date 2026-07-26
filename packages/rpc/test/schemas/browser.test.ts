import { describe, expect, it } from "vite-plus/test"

import {
  BrowserCookieImportErrorReasonSchema,
  BrowserCookieSourcesOutputSchema,
  BrowserCookieSourceSchema,
  BrowserImportCookiesInputSchema,
  BrowserImportCookiesOutputSchema
} from "../../src/schemas/browser"

describe("browser cookie import schemas", () => {
  it("parses a source whose cookie count could not be read", () => {
    const source = BrowserCookieSourceSchema.parse({
      browser: "Chrome",
      cookieCount: null,
      id: "chrome:Default",
      profileDir: "Default",
      profileName: "Work"
    })

    expect(source.cookieCount).toBeNull()
    expect(source.id).toBe("chrome:Default")
  })

  it("parses a list of sources", () => {
    const output = BrowserCookieSourcesOutputSchema.parse({
      sources: [
        {
          browser: "Brave",
          cookieCount: 128,
          id: "brave:Profile 1",
          profileDir: "Profile 1",
          profileName: "Personal"
        }
      ]
    })

    expect(output.sources).toHaveLength(1)
    expect(output.sources[0]?.cookieCount).toBe(128)
  })

  it("treats the domain filter as optional", () => {
    expect(
      BrowserImportCookiesInputSchema.parse({
        sessionId: "session-1",
        sourceId: "chrome:Default"
      }).domainFilter
    ).toBeUndefined()
    expect(
      BrowserImportCookiesInputSchema.parse({
        domainFilter: "github.com",
        sessionId: "session-1",
        sourceId: "chrome:Default"
      }).domainFilter
    ).toBe("github.com")
  })

  it("rejects an empty source id", () => {
    expect(
      BrowserImportCookiesInputSchema.safeParse({
        sessionId: "session-1",
        sourceId: ""
      }).success
    ).toBe(false)
  })

  it("parses the import counts", () => {
    expect(
      BrowserImportCookiesOutputSchema.parse({
        failed: 2,
        imported: 40,
        total: 42
      })
    ).toEqual({ failed: 2, imported: 40, total: 42 })
  })

  it("accepts only the known failure reasons", () => {
    expect(BrowserCookieImportErrorReasonSchema.parse("keychain-denied")).toBe(
      "keychain-denied"
    )
    expect(
      BrowserCookieImportErrorReasonSchema.safeParse("something-else").success
    ).toBe(false)
  })
})
