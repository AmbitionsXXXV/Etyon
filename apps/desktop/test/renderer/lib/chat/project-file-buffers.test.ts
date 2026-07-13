import { describe, expect, it } from "vite-plus/test"

import {
  buildProjectBufferTabLabels,
  closeProjectFileBuffer,
  openProjectFileBuffer,
  retainProjectFileBuffers
} from "@/renderer/lib/chat/project-file-buffers"
import type { ProjectFileBuffersState } from "@/renderer/lib/chat/project-file-buffers"

const stateOf = (
  activePath: string | null,
  openPaths: string[]
): ProjectFileBuffersState => ({ activePath, openPaths })

describe("openProjectFileBuffer", () => {
  it("appends a new path and activates it", () => {
    const result = openProjectFileBuffer(stateOf(null, []), "src/a.ts")

    expect(result.openPaths).toEqual(["src/a.ts"])
    expect(result.activePath).toBe("src/a.ts")
  })

  it("only activates an already-open path without reordering it", () => {
    const state = stateOf("src/b.ts", ["src/a.ts", "src/b.ts"])
    const result = openProjectFileBuffer(state, "src/a.ts")

    expect(result.openPaths).toEqual(["src/a.ts", "src/b.ts"])
    expect(result.activePath).toBe("src/a.ts")
  })

  it("returns the same reference when re-opening the active path", () => {
    const state = stateOf("src/a.ts", ["src/a.ts"])

    expect(openProjectFileBuffer(state, "src/a.ts")).toBe(state)
  })
})

describe("closeProjectFileBuffer", () => {
  it("activates the right neighbor when closing the active buffer", () => {
    const state = stateOf("src/b.ts", ["src/a.ts", "src/b.ts", "src/c.ts"])
    const result = closeProjectFileBuffer(state, "src/b.ts")

    expect(result.openPaths).toEqual(["src/a.ts", "src/c.ts"])
    expect(result.activePath).toBe("src/c.ts")
  })

  it("activates the new last buffer when closing the active last tab", () => {
    const state = stateOf("src/c.ts", ["src/a.ts", "src/b.ts", "src/c.ts"])
    const result = closeProjectFileBuffer(state, "src/c.ts")

    expect(result.openPaths).toEqual(["src/a.ts", "src/b.ts"])
    expect(result.activePath).toBe("src/b.ts")
  })

  it("clears the active path when closing the only buffer", () => {
    const result = closeProjectFileBuffer(
      stateOf("src/a.ts", ["src/a.ts"]),
      "src/a.ts"
    )

    expect(result.openPaths).toEqual([])
    expect(result.activePath).toBeNull()
  })

  it("keeps the active path when closing a different buffer", () => {
    const state = stateOf("src/a.ts", ["src/a.ts", "src/b.ts", "src/c.ts"])
    const result = closeProjectFileBuffer(state, "src/b.ts")

    expect(result.openPaths).toEqual(["src/a.ts", "src/c.ts"])
    expect(result.activePath).toBe("src/a.ts")
  })

  it("returns the same reference when closing an unknown path", () => {
    const state = stateOf("src/a.ts", ["src/a.ts"])

    expect(closeProjectFileBuffer(state, "src/missing.ts")).toBe(state)
  })
})

describe("retainProjectFileBuffers", () => {
  it("drops buffers that are no longer available", () => {
    const state = stateOf("src/a.ts", ["src/a.ts", "src/b.ts"])
    const result = retainProjectFileBuffers(state, ["src/a.ts"])

    expect(result.openPaths).toEqual(["src/a.ts"])
    expect(result.activePath).toBe("src/a.ts")
  })

  it("keeps the active path when it survives", () => {
    const state = stateOf("src/a.ts", ["src/a.ts", "src/b.ts", "src/c.ts"])
    const result = retainProjectFileBuffers(state, ["src/a.ts", "src/c.ts"])

    expect(result.openPaths).toEqual(["src/a.ts", "src/c.ts"])
    expect(result.activePath).toBe("src/a.ts")
  })

  it("re-activates the nearest survivor when the active path is dropped", () => {
    const state = stateOf("src/b.ts", ["src/a.ts", "src/b.ts", "src/c.ts"])
    const result = retainProjectFileBuffers(state, ["src/a.ts", "src/c.ts"])

    expect(result.openPaths).toEqual(["src/a.ts", "src/c.ts"])
    expect(result.activePath).toBe("src/c.ts")
  })

  it("returns the same reference when every buffer is available", () => {
    const state = stateOf("src/a.ts", ["src/a.ts", "src/b.ts"])

    expect(
      retainProjectFileBuffers(state, ["src/a.ts", "src/b.ts", "src/c.ts"])
    ).toBe(state)
  })

  it("clears everything when nothing is available", () => {
    const state = stateOf("src/a.ts", ["src/a.ts", "src/b.ts"])
    const result = retainProjectFileBuffers(state, [])

    expect(result.openPaths).toEqual([])
    expect(result.activePath).toBeNull()
  })
})

describe("buildProjectBufferTabLabels", () => {
  it("uses a null disambiguator for unique basenames", () => {
    const labels = buildProjectBufferTabLabels(["src/a.ts", "src/b.ts"])

    expect(labels.get("src/a.ts")).toEqual({
      basename: "a.ts",
      disambiguator: null
    })
    expect(labels.get("src/b.ts")).toEqual({
      basename: "b.ts",
      disambiguator: null
    })
  })

  it("uses the parent directory name on a basename collision", () => {
    const labels = buildProjectBufferTabLabels([
      "src/a/util.ts",
      "src/b/util.ts"
    ])

    expect(labels.get("src/a/util.ts")).toEqual({
      basename: "util.ts",
      disambiguator: "a"
    })
    expect(labels.get("src/b/util.ts")).toEqual({
      basename: "util.ts",
      disambiguator: "b"
    })
  })

  it("falls back to the full parent path when parent names also collide", () => {
    const labels = buildProjectBufferTabLabels([
      "x/lib/index.ts",
      "y/lib/index.ts"
    ])

    expect(labels.get("x/lib/index.ts")).toEqual({
      basename: "index.ts",
      disambiguator: "x/lib"
    })
    expect(labels.get("y/lib/index.ts")).toEqual({
      basename: "index.ts",
      disambiguator: "y/lib"
    })
  })

  it("disambiguates a root-level file against a nested one", () => {
    const labels = buildProjectBufferTabLabels(["README.md", "docs/README.md"])

    expect(labels.get("README.md")).toEqual({
      basename: "README.md",
      disambiguator: "."
    })
    expect(labels.get("docs/README.md")).toEqual({
      basename: "README.md",
      disambiguator: "docs"
    })
  })
})
