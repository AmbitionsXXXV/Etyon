import { describe, expect, it } from "vite-plus/test"

import {
  resolveCookieImportErrorMessageKey,
  resolveCookieImportErrorReason
} from "@/renderer/lib/chat/cookie-import"

describe("resolveCookieImportErrorReason", () => {
  it("reads the reason off an rpc error payload", () => {
    expect(
      resolveCookieImportErrorReason({ data: { reason: "keychain-denied" } })
    ).toBe("keychain-denied")
  })

  it("ignores an unknown reason", () => {
    expect(
      resolveCookieImportErrorReason({ data: { reason: "meteor-strike" } })
    ).toBeNull()
  })

  it("ignores an error that carries no payload", () => {
    expect(resolveCookieImportErrorReason(new Error("boom"))).toBeNull()
    expect(resolveCookieImportErrorReason({ data: null })).toBeNull()
    expect(resolveCookieImportErrorReason(null)).toBeNull()
  })
})

describe("resolveCookieImportErrorMessageKey", () => {
  it("maps every typed reason to its own copy", () => {
    expect(
      resolveCookieImportErrorMessageKey({
        data: { reason: "keychain-denied" }
      })
    ).toBe("chat.projectPanel.cookieImportErrorKeychainDenied")
    expect(
      resolveCookieImportErrorMessageKey({
        data: { reason: "unsupported-platform" }
      })
    ).toBe("chat.projectPanel.cookieImportErrorUnsupportedPlatform")
  })

  it("falls back to the generic message for anything untyped", () => {
    expect(resolveCookieImportErrorMessageKey(new Error("boom"))).toBe(
      "chat.projectPanel.cookieImportErrorGeneric"
    )
  })
})
