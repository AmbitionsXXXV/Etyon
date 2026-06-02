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

    expect(
      evaluateAgentToolPermission({
        input: {
          path: "src/app.ts"
        },
        name: "stat",
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

  it("keeps LSP inspect inside read-only workspace permission boundaries", () => {
    expect(
      evaluateAgentToolPermission({
        input: {
          line: 12,
          match: "const value = <<<source",
          path: "src/source.ts"
        },
        name: "inspect",
        workspaceRoot
      })
    ).toMatchObject({
      action: "allow",
      ruleId: "readonly-project-tool"
    })

    expect(
      evaluateAgentToolPermission({
        input: {
          line: 1,
          match: "AWS_SECRET_ACCESS_KEY=<<<value",
          path: ".env.local"
        },
        name: "inspect",
        workspaceRoot
      })
    ).toMatchObject({
      action: "deny",
      ruleId: "secret-path"
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
          content: "export const value = 1\n",
          path: "src/generated.ts"
        },
        name: "writeFile",
        workspaceRoot
      })
    ).toMatchObject({
      action: "ask",
      ruleId: "write-requires-approval"
    })

    expect(
      evaluateAgentToolPermission({
        input: {
          path: "src/generated"
        },
        name: "mkdir",
        workspaceRoot
      })
    ).toMatchObject({
      action: "ask",
      ruleId: "write-requires-approval"
    })

    expect(
      evaluateAgentToolPermission({
        input: {
          path: "src/generated.ts",
          replacement: "export const value = 2",
          symbol: "value"
        },
        name: "smartEdit",
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

  it("denies secret and cross-workspace writes before approval", () => {
    expect(
      evaluateAgentToolPermission({
        input: {
          path: ".env.local"
        },
        name: "delete",
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
        name: "write",
        workspaceRoot
      })
    ).toMatchObject({
      action: "deny",
      ruleId: "outside-workspace"
    })
  })

  it("denies destructive commands before generic command approval", () => {
    for (const command of [
      "rm -rf dist",
      "git reset --hard HEAD",
      "rtk git reset --hard HEAD"
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
        action: "deny",
        ruleId: "destructive-command"
      })
    }
  })

  it("denies unsupported package manager commands before approval", () => {
    for (const command of [
      "npm install",
      "pnpm add lodash",
      "rtk yarn test",
      "bun run build",
      "deno task test"
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
        action: "deny",
        ruleId: "unsupported-package-manager"
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

  it("asks before running network tools", () => {
    for (const [name, input] of [
      ["webExtract", { url: "https://example.com" }],
      ["webSearch", { query: "latest vite release" }]
    ] as const) {
      expect(
        evaluateAgentToolPermission({
          input,
          name,
          workspaceRoot
        })
      ).toMatchObject({
        action: "ask",
        ruleId: "network-requires-approval"
      })
    }
  })

  it("asks before approving user access checkpoints", () => {
    expect(
      evaluateAgentToolPermission({
        input: {
          reason: "Need approval before delegating implementation.",
          scope: "current task"
        },
        name: "requestAccess",
        workspaceRoot
      })
    ).toMatchObject({
      action: "ask",
      ruleId: "ui-requires-approval"
    })
  })

  it("allows bounded check commands", () => {
    for (const command of [
      "vp check",
      "rtk vp check",
      "vp test run",
      "vp test run apps/desktop/test/main/agents/permission-engine.test.ts",
      "vp run @etyon/desktop#test run test/main/agents/tool-registry.test.ts"
    ]) {
      expect(
        evaluateAgentToolPermission({
          input: {
            command,
            timeoutMs: 60_000
          },
          name: "runCheck",
          workspaceRoot
        })
      ).toMatchObject({
        action: "allow",
        ruleId: "safe-check-command"
      })
    }
  })

  it("allows safe read-only git inspection commands", () => {
    for (const command of [
      "git diff --staged -- apps/desktop/src/main/agents/agent-runtime.ts",
      "git diff --cached --stat",
      "git status --short",
      "git log --oneline -n 5",
      "git show HEAD~1:doc/agents.md"
    ]) {
      expect(
        evaluateAgentToolPermission({
          input: {
            command
          },
          name: "bash",
          workspaceRoot
        })
      ).toMatchObject({
        action: "allow",
        ruleId: "safe-readonly-git-command"
      })
    }
  })

  it("allows wrapped read-only git inspection commands", () => {
    for (const [name, command] of [
      ["rtkCommand", "rtk git diff --cached --stat"],
      [
        "runCheck",
        "git diff --cached apps/desktop/src/main/agents/agent-runtime.ts"
      ]
    ] as const) {
      expect(
        evaluateAgentToolPermission({
          input: {
            command
          },
          name,
          workspaceRoot
        })
      ).toMatchObject({
        action: "allow",
        ruleId: "safe-readonly-git-command"
      })
    }
  })

  it("lets a remembered read-only git intent cover different argv for the same tool", () => {
    expect(
      evaluateAgentToolPermission({
        commandApprovalAllowlist: [
          {
            command: "git diff --cached --stat",
            createdAt: "2026-06-01T00:00:00.000Z",
            projectPath: workspaceRoot,
            toolName: "runCheck"
          }
        ],
        input: {
          command:
            "git diff --cached apps/desktop/src/main/agents/agent-runtime.ts"
        },
        name: "runCheck",
        workspaceRoot
      })
    ).toMatchObject({
      action: "allow",
      ruleId: "command-approval-allowlist"
    })
  })

  it("lets a remembered local command intent cover different argv and command tools", () => {
    expect(
      evaluateAgentToolPermission({
        commandApprovalAllowlist: [
          {
            command: "python scripts/check.py --file src/old.ts",
            createdAt: "2026-06-01T00:00:00.000Z",
            cwd: ".",
            projectPath: workspaceRoot,
            toolName: "bash"
          }
        ],
        input: {
          command: "python scripts/check.py --file src/new.ts",
          cwd: "."
        },
        name: "runCheck",
        workspaceRoot
      })
    ).toMatchObject({
      action: "allow",
      ruleId: "command-approval-allowlist"
    })

    expect(
      evaluateAgentToolPermission({
        commandApprovalAllowlist: [
          {
            command: "python scripts/check.py --file src/old.ts",
            createdAt: "2026-06-01T00:00:00.000Z",
            projectPath: workspaceRoot,
            toolName: "bash"
          }
        ],
        input: {
          command: "python scripts/other.py --file src/new.ts"
        },
        name: "bash",
        workspaceRoot
      })
    ).toMatchObject({
      action: "ask",
      ruleId: "command-requires-approval"
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
