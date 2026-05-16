import { describe, expect, it } from "vite-plus/test"

import { parseGitStatusPorcelain } from "@/main/git-project-status"

const NULL_BYTE = String.fromCodePoint(0)

describe("git project status", () => {
  it("parses porcelain status into compact counts and tree entries", () => {
    const status = parseGitStatusPorcelain({
      projectPath: "/tmp/project-a",
      stdout: [
        " M src/app.tsx",
        "A  src/new-file.ts",
        "D  src/old-file.ts",
        "R  src/new-name.ts",
        "src/old-name.ts",
        "?? README.md",
        ""
      ].join(NULL_BYTE)
    })

    expect(status).toEqual({
      added: 1,
      changedFileCount: 5,
      deleted: 1,
      error: undefined,
      files: [
        {
          path: "src/app.tsx",
          status: "modified"
        },
        {
          path: "src/new-file.ts",
          status: "added"
        },
        {
          path: "src/old-file.ts",
          status: "deleted"
        },
        {
          path: "src/new-name.ts",
          status: "renamed"
        },
        {
          path: "README.md",
          status: "untracked"
        }
      ],
      isRepository: true,
      modified: 1,
      projectPath: "/tmp/project-a",
      renamed: 1,
      untracked: 1
    })
  })
})
