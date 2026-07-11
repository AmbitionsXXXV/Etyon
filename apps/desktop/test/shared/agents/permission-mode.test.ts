import { describe, expect, it } from "vite-plus/test"

import {
  DEFAULT_PERMISSION_MODE,
  getNextPermissionMode,
  isAgentPermissionMode,
  isDangerousShellCommand,
  needsFileEditApproval,
  needsShellApproval
} from "@/shared/agents/permission-mode"

describe("isAgentPermissionMode", () => {
  it("accepts the three modes and rejects everything else", () => {
    expect(isAgentPermissionMode("default")).toBe(true)
    expect(isAgentPermissionMode("acceptEdits")).toBe(true)
    expect(isAgentPermissionMode("bypass")).toBe(true)
    expect(isAgentPermissionMode("plan")).toBe(false)
    expect(isAgentPermissionMode("")).toBe(false)
    expect(isAgentPermissionMode(null)).toBe(false)
    expect(isAgentPermissionMode(42)).toBe(false)
  })
})

describe("getNextPermissionMode", () => {
  it("cycles default → acceptEdits → bypass → default", () => {
    expect(getNextPermissionMode("default")).toBe("acceptEdits")
    expect(getNextPermissionMode("acceptEdits")).toBe("bypass")
    expect(getNextPermissionMode("bypass")).toBe("default")
  })
})

describe("isDangerousShellCommand", () => {
  it("flags rm with recursive+force in any flag arrangement", () => {
    expect(isDangerousShellCommand("rm -rf build")).toBe(true)
    expect(isDangerousShellCommand("rm -fr build")).toBe(true)
    expect(isDangerousShellCommand("rm -r -f build")).toBe(true)
    expect(isDangerousShellCommand("rm -f -r build")).toBe(true)
    expect(isDangerousShellCommand("rm --recursive --force build")).toBe(true)
    expect(isDangerousShellCommand("sudo rm -rf /")).toBe(true)
    expect(isDangerousShellCommand("ls && rm -rf dist")).toBe(true)
  })

  it("does not flag safe rm or rm without both flags", () => {
    expect(isDangerousShellCommand("rm file.txt")).toBe(false)
    expect(isDangerousShellCommand("rm -r dir")).toBe(false)
    expect(isDangerousShellCommand("rm -f file")).toBe(false)
    expect(isDangerousShellCommand("rm -i file")).toBe(false)
  })

  it("flags git history/worktree wipes and force pushes", () => {
    expect(isDangerousShellCommand("git reset --hard")).toBe(true)
    expect(isDangerousShellCommand("git reset --hard HEAD~3")).toBe(true)
    expect(isDangerousShellCommand("git clean -fd")).toBe(true)
    expect(isDangerousShellCommand("git checkout -- .")).toBe(true)
    expect(isDangerousShellCommand("git push --force origin main")).toBe(true)
    expect(isDangerousShellCommand("git push -f")).toBe(true)
  })

  it("flags privilege escalation and disk/system ops", () => {
    expect(isDangerousShellCommand("sudo apt install foo")).toBe(true)
    expect(isDangerousShellCommand("shutdown -h now")).toBe(true)
    expect(isDangerousShellCommand("mkfs.ext4 /dev/sda1")).toBe(true)
    expect(isDangerousShellCommand("dd if=/dev/zero of=/dev/sda")).toBe(true)
    expect(isDangerousShellCommand(":(){ :|:& };:")).toBe(true)
  })

  it("does not flag ordinary commands or destructive-looking substrings", () => {
    expect(isDangerousShellCommand("git status --short")).toBe(false)
    expect(isDangerousShellCommand("git reset HEAD~1")).toBe(false)
    expect(isDangerousShellCommand("git log --oneline -5")).toBe(false)
    expect(isDangerousShellCommand("echo 'rm -rf is dangerous'")).toBe(false)
    expect(isDangerousShellCommand("grep -r --hard-tabs src")).toBe(false)
    expect(isDangerousShellCommand("vp test")).toBe(false)
    expect(isDangerousShellCommand("")).toBe(false)
  })
})

describe("needsFileEditApproval", () => {
  it("gates only in default mode", () => {
    expect(needsFileEditApproval("default")).toBe(true)
    expect(needsFileEditApproval("acceptEdits")).toBe(false)
    expect(needsFileEditApproval("bypass")).toBe(false)
  })
})

describe("needsShellApproval", () => {
  const safe = "git status --short"
  const dangerous = "rm -rf dist"

  it("bypass never gates, even destructive commands", () => {
    expect(
      needsShellApproval({
        command: dangerous,
        isRemembered: false,
        mode: "bypass"
      })
    ).toBe(false)
  })

  it("destructive commands gate outside bypass and ignore the allowlist", () => {
    expect(
      needsShellApproval({
        command: dangerous,
        isRemembered: true,
        mode: "default"
      })
    ).toBe(true)
    expect(
      needsShellApproval({
        command: dangerous,
        isRemembered: true,
        mode: "acceptEdits"
      })
    ).toBe(true)
  })

  it("safe commands gate unless remembered; acceptEdits does not auto-run shell", () => {
    expect(
      needsShellApproval({
        command: safe,
        isRemembered: false,
        mode: "default"
      })
    ).toBe(true)
    expect(
      needsShellApproval({
        command: safe,
        isRemembered: false,
        mode: "acceptEdits"
      })
    ).toBe(true)
    expect(
      needsShellApproval({ command: safe, isRemembered: true, mode: "default" })
    ).toBe(false)
  })
})

describe("DEFAULT_PERMISSION_MODE", () => {
  it("is the safest mode", () => {
    expect(DEFAULT_PERMISSION_MODE).toBe("default")
  })
})
