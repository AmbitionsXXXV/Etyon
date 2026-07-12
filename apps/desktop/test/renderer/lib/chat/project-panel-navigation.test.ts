import { afterEach, describe, expect, it } from "vite-plus/test"

import {
  clearProjectPanelReveal,
  getProjectPanelRevealSnapshot,
  requestProjectPanelReveal,
  resolveProjectRelativePath
} from "@/renderer/lib/chat/project-panel-navigation"

afterEach(() => {
  clearProjectPanelReveal()
})

describe("requestProjectPanelReveal", () => {
  it("stores the latest request with a monotonically increasing id", () => {
    requestProjectPanelReveal({ path: "src/a.ts", view: "file" })
    const first = getProjectPanelRevealSnapshot()

    requestProjectPanelReveal({ line: 12, path: "src/b.ts", view: "diff" })
    const second = getProjectPanelRevealSnapshot()

    expect(first?.path).toBe("src/a.ts")
    expect(first?.view).toBe("file")
    expect(first?.line).toBeUndefined()
    expect(second?.path).toBe("src/b.ts")
    expect(second?.view).toBe("diff")
    expect(second?.line).toBe(12)
    expect((second?.requestId ?? 0) > (first?.requestId ?? 0)).toBe(true)
  })

  it("re-triggers with a fresh id when the same file is requested twice", () => {
    requestProjectPanelReveal({ path: "src/same.ts", view: "file" })
    const firstId = getProjectPanelRevealSnapshot()?.requestId

    requestProjectPanelReveal({ path: "src/same.ts", view: "file" })
    const secondId = getProjectPanelRevealSnapshot()?.requestId

    expect(firstId).toBeDefined()
    expect(secondId).toBeDefined()
    expect(secondId).not.toBe(firstId)
  })

  it("clears the pending request", () => {
    requestProjectPanelReveal({ path: "src/a.ts", view: "file" })
    expect(getProjectPanelRevealSnapshot()).not.toBeNull()

    clearProjectPanelReveal()
    expect(getProjectPanelRevealSnapshot()).toBeNull()
  })
})

describe("resolveProjectRelativePath", () => {
  const projectPath = "/Users/dev/Etyon"

  it("returns project-relative paths unchanged", () => {
    expect(
      resolveProjectRelativePath({ path: "apps/desktop/src/a.ts", projectPath })
    ).toBe("apps/desktop/src/a.ts")
  })

  it("strips a leading ./ from relative paths", () => {
    expect(
      resolveProjectRelativePath({ path: "./src/a.ts", projectPath })
    ).toBe("src/a.ts")
  })

  it("strips the project root from an absolute path inside the project", () => {
    expect(
      resolveProjectRelativePath({
        path: "/Users/dev/Etyon/apps/desktop/src/a.ts",
        projectPath
      })
    ).toBe("apps/desktop/src/a.ts")
  })

  it("tolerates a trailing slash on the project root", () => {
    expect(
      resolveProjectRelativePath({
        path: "/Users/dev/Etyon/src/a.ts",
        projectPath: "/Users/dev/Etyon/"
      })
    ).toBe("src/a.ts")
  })

  it("returns null for an absolute path outside the project", () => {
    expect(
      resolveProjectRelativePath({ path: "/etc/hosts", projectPath })
    ).toBeNull()
  })

  it("returns null for a sibling directory that only shares a prefix", () => {
    expect(
      resolveProjectRelativePath({
        path: "/Users/dev/Etyon-other/src/a.ts",
        projectPath
      })
    ).toBeNull()
  })

  it("returns null for the project root itself", () => {
    expect(
      resolveProjectRelativePath({ path: "/Users/dev/Etyon", projectPath })
    ).toBeNull()
  })

  it("returns null for empty input", () => {
    expect(resolveProjectRelativePath({ path: "   ", projectPath })).toBeNull()
  })

  it("handles Windows-style absolute paths on a best-effort basis", () => {
    expect(
      resolveProjectRelativePath({
        path: "C:\\work\\Etyon\\src\\a.ts",
        projectPath: "C:\\work\\Etyon"
      })
    ).toBe("src/a.ts")
  })
})
