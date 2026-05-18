import type { FileDiffMetadata } from "@pierre/diffs"
import { describe, expect, it } from "vite-plus/test"

import {
  buildProjectGitStatusSummary,
  buildProjectTreeDirectoryPaths,
  formatProjectDiffCount,
  getProjectDiffFileStats,
  getProjectDiffSummary
} from "@/renderer/lib/chat/project-context-panel"
import { resolveProjectFileViewerLanguage } from "@/renderer/lib/chat/project-file-code-viewer"

describe("project context panel helpers", () => {
  it("builds ordered git status summary items with display prefixes", () => {
    expect(
      buildProjectGitStatusSummary({
        added: 2,
        changedFileCount: 8,
        deleted: 1,
        files: [],
        isRepository: true,
        modified: 3,
        projectPath: "/tmp/project-a",
        renamed: 1,
        untracked: 1
      })
    ).toEqual([
      {
        count: 2,
        prefix: "+",
        status: "added"
      },
      {
        count: 3,
        prefix: "~",
        status: "modified"
      },
      {
        count: 1,
        prefix: "-",
        status: "deleted"
      },
      {
        count: 1,
        prefix: "R",
        status: "renamed"
      },
      {
        count: 1,
        prefix: "?",
        status: "untracked"
      }
    ])
  })

  it("counts additions and deletions across parsed diff hunks", () => {
    const fileDiff: FileDiffMetadata = {
      additionLines: [],
      cacheKey: "fixture",
      deletionLines: [],
      hunks: [
        {
          additionCount: 5,
          additionLineIndex: 0,
          additionLines: 3,
          additionStart: 1,
          collapsedBefore: 0,
          deletionCount: 4,
          deletionLineIndex: 0,
          deletionLines: 2,
          deletionStart: 1,
          hunkContent: [],
          noEOFCRAdditions: false,
          noEOFCRDeletions: false,
          splitLineCount: 5,
          splitLineStart: 0,
          unifiedLineCount: 5,
          unifiedLineStart: 0
        },
        {
          additionCount: 2,
          additionLineIndex: 5,
          additionLines: 1,
          additionStart: 10,
          collapsedBefore: 4,
          deletionCount: 3,
          deletionLineIndex: 4,
          deletionLines: 2,
          deletionStart: 9,
          hunkContent: [],
          noEOFCRAdditions: false,
          noEOFCRDeletions: false,
          splitLineCount: 3,
          splitLineStart: 5,
          unifiedLineCount: 3,
          unifiedLineStart: 5
        }
      ],
      isPartial: true,
      name: "src/app.tsx",
      splitLineCount: 8,
      type: "change",
      unifiedLineCount: 8
    }

    expect(getProjectDiffFileStats(fileDiff)).toEqual({
      additions: 4,
      deletions: 4
    })
    expect(
      getProjectDiffSummary({
        diffFiles: [fileDiff],
        fallbackChangedFileCount: 10
      })
    ).toEqual({
      additions: 4,
      changedFileCount: 1,
      deletions: 4
    })
  })

  it("formats diff counts with grouping separators", () => {
    expect(formatProjectDiffCount(2937)).toBe("2,937")
  })

  it("builds deepest-first directory paths for tree collapse actions", () => {
    expect(
      buildProjectTreeDirectoryPaths([
        "README.md",
        "apps/desktop/src/index.ts",
        "apps/desktop/src/renderer/index.tsx",
        "packages/ui/src/button.tsx"
      ])
    ).toEqual([
      "apps/desktop/src/renderer/",
      "apps/desktop/src/",
      "packages/ui/src/",
      "apps/desktop/",
      "packages/ui/",
      "apps/",
      "packages/"
    ])
  })

  it("resolves Shiki viewer languages from snapshot language and extension", () => {
    expect(
      resolveProjectFileViewerLanguage({
        language: "typescriptreact",
        relativePath: "apps/desktop/src/app.tsx"
      })
    ).toBe("tsx")
    expect(
      resolveProjectFileViewerLanguage({
        language: null,
        relativePath: "apps/desktop/src/app.jsx"
      })
    ).toBe("jsx")
    expect(
      resolveProjectFileViewerLanguage({
        language: undefined,
        relativePath: "README"
      })
    ).toBe("plaintext")
  })
})
