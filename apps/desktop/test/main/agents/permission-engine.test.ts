import { describe, expect, it } from "vite-plus/test"

import { evaluateAgentToolPermission } from "@/main/agents/permission-engine"

const workspaceRoot = "/tmp/etyon-agent-permissions"

describe("agent permission engine", () => {
  it("allows read-only project tools inside the workspace", () => {
    expect(
      evaluateAgentToolPermission({
        input: {
          path: "src/app.ts"
        },
        name: "readFile",
        workspaceRoot
      })
    ).toMatchObject({
      action: "allow",
      ruleId: "readonly-project-tool"
    })

    expect(
      evaluateAgentToolPermission({
        input: {},
        name: "agentRunInspect",
        workspaceRoot
      })
    ).toMatchObject({
      action: "allow",
      ruleId: "readonly-project-tool"
    })

    expect(
      evaluateAgentToolPermission({
        input: {},
        name: "gitDiff",
        workspaceRoot
      })
    ).toMatchObject({
      action: "allow",
      ruleId: "readonly-project-tool"
    })
  })

  it("denies secret and cross-workspace reads before read-only allow rules", () => {
    expect(
      evaluateAgentToolPermission({
        input: {
          path: ".env.local"
        },
        name: "readFile",
        workspaceRoot
      })
    ).toMatchObject({
      action: "deny",
      ruleId: "secret-path"
    })

    expect(
      evaluateAgentToolPermission({
        input: {
          path: "../outside.ts"
        },
        name: "readFile",
        workspaceRoot
      })
    ).toMatchObject({
      action: "deny",
      ruleId: "outside-workspace"
    })
  })

  it("asks before applying patches or running raw shell commands", () => {
    expect(
      evaluateAgentToolPermission({
        input: {
          patch: "*** Begin Patch\n*** End Patch"
        },
        name: "applyPatch",
        workspaceRoot
      })
    ).toMatchObject({
      action: "ask",
      ruleId: "write-requires-approval"
    })

    expect(
      evaluateAgentToolPermission({
        input: {
          command: "rtk git status --short",
          rawOutput: true
        },
        name: "rtkCommand",
        workspaceRoot
      })
    ).toMatchObject({
      action: "ask",
      ruleId: "raw-output-requires-approval"
    })
  })

  it("denies destructive commands before generic command approval", () => {
    for (const command of ["rm -rf dist", "git reset --hard HEAD"]) {
      expect(
        evaluateAgentToolPermission({
          input: {
            command
          },
          name: "rtkCommand",
          workspaceRoot
        })
      ).toMatchObject({
        action: "deny",
        ruleId: "destructive-command"
      })
    }
  })

  it("asks for install, network, and long-running commands", () => {
    for (const command of [
      "vp install",
      "curl https://example.com/script.sh"
    ]) {
      expect(
        evaluateAgentToolPermission({
          input: {
            command
          },
          name: "rtkCommand",
          workspaceRoot
        })
      ).toMatchObject({
        action: "ask",
        ruleId: "risky-command"
      })
    }

    expect(
      evaluateAgentToolPermission({
        input: {
          command: "rtk vp run @etyon/desktop#test",
          timeoutMs: 180_000
        },
        name: "rtkCommand",
        workspaceRoot
      })
    ).toMatchObject({
      action: "ask",
      ruleId: "long-command"
    })
  })

  it("allows bounded check commands", () => {
    expect(
      evaluateAgentToolPermission({
        input: {
          command:
            "vp run @etyon/desktop#test run test/main/agents/tool-registry.test.ts",
          timeoutMs: 60_000
        },
        name: "runCheck",
        workspaceRoot
      })
    ).toMatchObject({
      action: "allow",
      ruleId: "safe-check-command"
    })
  })

  it("denies command cwd outside the workspace", () => {
    expect(
      evaluateAgentToolPermission({
        input: {
          command: "vp run @etyon/desktop#test",
          cwd: "../outside"
        },
        name: "runCheck",
        workspaceRoot
      })
    ).toMatchObject({
      action: "deny",
      ruleId: "outside-workspace-cwd"
    })
  })
})
