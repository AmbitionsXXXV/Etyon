import { describe, expect, it } from "vite-plus/test"

import {
  childWriteHolder,
  claimWrite,
  PARENT_WRITE_HOLDER,
  releaseRun,
  writeClaimConflictMessage
} from "@/main/agents/write-claims"

let nextRun = 0
const uniqueRun = (): string => {
  nextRun += 1

  return `top-run-${nextRun}`
}

describe("write claims", () => {
  it("grants a first claim and is idempotent for the same holder", () => {
    const topRunId = uniqueRun()

    expect(
      claimWrite({ holder: "child-a", path: "src/a.ts", topRunId })
    ).toEqual({ ok: true })
    // Re-claiming the same path as the same holder is allowed.
    expect(
      claimWrite({ holder: "child-a", path: "src/a.ts", topRunId })
    ).toEqual({ ok: true })
  })

  it("rejects a different holder and returns the current owner", () => {
    const topRunId = uniqueRun()

    claimWrite({ holder: "child-a", path: "src/a.ts", topRunId })

    expect(
      claimWrite({ holder: "child-b", path: "src/a.ts", topRunId })
    ).toEqual({ holder: "child-a", ok: false })
  })

  it("normalizes ./ and trailing-slash and separators to one key", () => {
    const topRunId = uniqueRun()

    claimWrite({ holder: "child-a", path: "src/a.ts", topRunId })

    expect(
      claimWrite({ holder: "child-b", path: "./src/a.ts", topRunId })
    ).toEqual({ holder: "child-a", ok: false })
    expect(
      claimWrite({ holder: "child-b", path: "src\\a.ts", topRunId })
    ).toEqual({ holder: "child-a", ok: false })
  })

  it("scopes claims per top-level run", () => {
    const runOne = uniqueRun()
    const runTwo = uniqueRun()

    claimWrite({ holder: "child-a", path: "src/a.ts", topRunId: runOne })

    // A different run's claim on the same path is independent.
    expect(
      claimWrite({ holder: "child-b", path: "src/a.ts", topRunId: runTwo })
    ).toEqual({ ok: true })
  })

  it("releases every claim for a run so paths free up", () => {
    const topRunId = uniqueRun()

    claimWrite({ holder: "child-a", path: "src/a.ts", topRunId })
    releaseRun(topRunId)

    expect(
      claimWrite({ holder: "child-b", path: "src/a.ts", topRunId })
    ).toEqual({ ok: true })
  })

  it("labels holders and messages usefully", () => {
    expect(childWriteHolder("abcdef0123456789", "coder")).toBe("abcdef01:coder")
    expect(PARENT_WRITE_HOLDER).toBe("parent")
    expect(writeClaimConflictMessage("src/a.ts", "child-a")).toContain(
      "src/a.ts"
    )
    expect(writeClaimConflictMessage("src/a.ts", "child-a")).toContain(
      "child-a"
    )
  })
})
