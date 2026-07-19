import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vite-plus/test"

// AgentMarkdown (renderer/components/chat/agent-markdown.tsx) is the single
// sanctioned place to render Streamdown: it bakes in skipHtml, a safe
// urlTransform, and strict mermaid so untrusted agent output can't inject.
// A bare `Streamdown` value-import anywhere else silently drops those defenses,
// so this fitness test fails the build if one reappears. Type-only imports
// (`import type … from "streamdown"`) stay allowed — they carry no runtime.

const TEST_DIR = import.meta.dirname
const SRC_ROOT = path.resolve(TEST_DIR, "../../../../src")
const WRAPPER_RELATIVE_PATH = "renderer/components/chat/agent-markdown.tsx"

// A `from "streamdown"` import that is not `import type` and binds the
// `Streamdown` value.
const STREAMDOWN_VALUE_IMPORT =
  /import\s+(?!type\b)[\s\S]*?\bStreamdown\b[\s\S]*?from\s+["']streamdown["']/u

const collectSourceFiles = (dir: string): string[] => {
  const files: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
    } else if (/\.tsx?$/u.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

const toRelativePosix = (file: string): string =>
  path.relative(SRC_ROOT, file).split(path.sep).join("/")

describe("agent markdown wrapper", () => {
  it("is the only module that imports the Streamdown value", () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((file) => toRelativePosix(file) !== WRAPPER_RELATIVE_PATH)
      .filter((file) =>
        STREAMDOWN_VALUE_IMPORT.test(readFileSync(file, "utf-8"))
      )
      .map(toRelativePosix)

    expect(offenders).toEqual([])
  })
})
