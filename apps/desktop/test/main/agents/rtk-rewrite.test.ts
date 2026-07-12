import { describe, expect, it } from "vite-plus/test"

import { rewriteCommandForRtk } from "@/main/agents/minimal/rtk-rewrite"

describe("rewriteCommandForRtk", () => {
  it("prefixes an allowlisted command", () => {
    expect(rewriteCommandForRtk("git status")).toEqual({
      executedCommand: "rtk git status",
      rtkApplied: true
    })
  })

  it("leaves a non-allowlisted command unchanged", () => {
    expect(rewriteCommandForRtk("vp check")).toEqual({
      executedCommand: "vp check",
      rtkApplied: false
    })
  })

  it("does not prefix an existing rtk command", () => {
    expect(rewriteCommandForRtk("rtk git status")).toEqual({
      executedCommand: "rtk git status",
      rtkApplied: false
    })
  })

  it("rewrites eligible && chain segments independently", () => {
    expect(
      rewriteCommandForRtk("git status && cargo test && vp check")
    ).toEqual({
      executedCommand: "rtk git status && rtk cargo test && vp check",
      rtkApplied: true
    })
  })

  it("skips pipelines", () => {
    expect(rewriteCommandForRtk("git status | cat")).toEqual({
      executedCommand: "git status | cat",
      rtkApplied: false
    })
  })

  it("skips redirections", () => {
    expect(rewriteCommandForRtk("cargo test > output.txt")).toEqual({
      executedCommand: "cargo test > output.txt",
      rtkApplied: false
    })
  })

  it("skips subshells, quoted chains, and standalone background operators", () => {
    for (const command of [
      "git status $(pwd)",
      "git status && echo 'done'",
      "git status & cargo test"
    ]) {
      expect(rewriteCommandForRtk(command)).toEqual({
        executedCommand: command,
        rtkApplied: false
      })
    }
  })

  it("skips commands containing a newline", () => {
    expect(rewriteCommandForRtk("git status\ncargo test")).toEqual({
      executedCommand: "git status\ncargo test",
      rtkApplied: false
    })
  })
})
