import { describe, expect, it } from "vite-plus/test"

import { resolveFunctionCallingSupport } from "@/shared/providers/function-calling"

describe("resolveFunctionCallingSupport", () => {
  it("returns native when functionCalling is explicitly true", () => {
    expect(
      resolveFunctionCallingSupport({
        capabilities: { functionCalling: true },
        id: "some-model"
      })
    ).toBe("native")
  })

  it("returns xml-middleware when functionCalling is explicitly false", () => {
    expect(
      resolveFunctionCallingSupport({
        capabilities: { functionCalling: false },
        id: "some-model"
      })
    ).toBe("xml-middleware")
  })

  it("returns unknown when functionCalling is undefined in capabilities", () => {
    expect(
      resolveFunctionCallingSupport({
        capabilities: { vision: true },
        id: "some-model"
      })
    ).toBe("unknown")
  })

  it("returns unknown when there is no capabilities object", () => {
    expect(resolveFunctionCallingSupport({ id: "some-model" })).toBe("unknown")
  })

  it("never guesses from the model id (explicit flag only)", () => {
    // An id that sounds tool-capable must NOT be upgraded to native, and one
    // that sounds tool-less must NOT be downgraded to xml-middleware.
    expect(
      resolveFunctionCallingSupport({ id: "gpt-5.6-tools-function-calling" })
    ).toBe("unknown")
    expect(
      resolveFunctionCallingSupport({
        capabilities: {},
        id: "legacy-completion-only"
      })
    ).toBe("unknown")
  })
})
