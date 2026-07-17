import { describe, expect, it } from "vite-plus/test"

import {
  commandMatchesApprovalRule,
  deriveCommandApprovalPattern
} from "@/shared/agents/command-allowlist"

describe("deriveCommandApprovalPattern", () => {
  it("keeps the binary and a non-flag subcommand", () => {
    expect(deriveCommandApprovalPattern('git commit -m "xxx"')).toBe(
      "git commit"
    )
    expect(deriveCommandApprovalPattern("rtk git status")).toBe("rtk git")
    expect(deriveCommandApprovalPattern("vp test run apps/desktop")).toBe(
      "vp test"
    )
  })

  it("skips leading VAR=value environment assignments", () => {
    expect(deriveCommandApprovalPattern("FOO=1 git push origin")).toBe(
      "git push"
    )
    expect(deriveCommandApprovalPattern("A=1 B=2 npm run build")).toBe(
      "npm run"
    )
  })

  it("collapses to the binary when the second token is a flag", () => {
    expect(deriveCommandApprovalPattern("tsc --noEmit")).toBe("tsc")
    expect(deriveCommandApprovalPattern("git -C x commit")).toBe("git")
  })

  it("returns the binary alone for a single-token command", () => {
    expect(deriveCommandApprovalPattern("ls")).toBe("ls")
  })

  it("keeps a quoted argument whole even with inner spaces and operators", () => {
    expect(deriveCommandApprovalPattern('git commit -m "fix: a | b > c"')).toBe(
      "git commit"
    )
  })

  it("trims surrounding whitespace before deriving", () => {
    expect(deriveCommandApprovalPattern("   git   status  ")).toBe("git status")
  })

  it("returns null for an empty or whitespace-only command", () => {
    expect(deriveCommandApprovalPattern("")).toBeNull()
    expect(deriveCommandApprovalPattern("   ")).toBeNull()
  })

  it("returns null for compound and control-structure commands", () => {
    expect(deriveCommandApprovalPattern("git add . && git commit")).toBeNull()
    expect(deriveCommandApprovalPattern("test -f x || echo no")).toBeNull()
    expect(deriveCommandApprovalPattern("ls; pwd")).toBeNull()
    expect(deriveCommandApprovalPattern("cat a | grep b")).toBeNull()
    expect(deriveCommandApprovalPattern("echo hi > out.txt")).toBeNull()
    expect(deriveCommandApprovalPattern("cat < in.txt")).toBeNull()
    expect(deriveCommandApprovalPattern("echo `whoami`")).toBeNull()
    expect(deriveCommandApprovalPattern("echo $(whoami)")).toBeNull()
    expect(deriveCommandApprovalPattern("git\ncommit")).toBeNull()
  })

  it("returns null when command substitution hides inside quotes", () => {
    expect(
      deriveCommandApprovalPattern('git commit -m "$(rm -rf /)"')
    ).toBeNull()
  })
})

describe("commandMatchesApprovalRule", () => {
  it("matches a legacy full command only exactly", () => {
    expect(
      commandMatchesApprovalRule({
        command: 'git commit -m "hello"',
        ruleCommand: 'git commit -m "hello"'
      })
    ).toBe(true)
    expect(
      commandMatchesApprovalRule({
        command: 'git commit -m "goodbye"',
        ruleCommand: 'git commit -m "hello"'
      })
    ).toBe(false)
  })

  it("matches same-pattern variants of a derived-pattern rule", () => {
    expect(
      commandMatchesApprovalRule({
        command: 'git commit -m "anything"',
        ruleCommand: "git commit"
      })
    ).toBe(true)
    expect(
      commandMatchesApprovalRule({
        command: "git commit",
        ruleCommand: "git commit"
      })
    ).toBe(true)
  })

  it("does not match a different subcommand", () => {
    expect(
      commandMatchesApprovalRule({
        command: "git push origin main",
        ruleCommand: "git commit"
      })
    ).toBe(false)
  })

  it("trims both the rule and the incoming command before comparing", () => {
    expect(
      commandMatchesApprovalRule({
        command: "  git commit -m x  ",
        ruleCommand: "  git commit  "
      })
    ).toBe(true)
  })

  it("never matches an empty rule", () => {
    expect(
      commandMatchesApprovalRule({ command: "git status", ruleCommand: "" })
    ).toBe(false)
  })
})
