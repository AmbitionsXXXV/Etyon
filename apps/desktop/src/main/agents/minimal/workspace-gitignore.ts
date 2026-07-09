import fs from "node:fs/promises"
import path from "node:path"

/**
 * Best-effort auto-ignore for files Etyon generates inside the user's project
 * (e.g. generated-images/). When a tool writes derived output into the work
 * folder it registers the output path here, so those generated files never show
 * up as untracked/committable noise. Failing to update .gitignore must never
 * fail the generation that triggered it, so the I/O here is fully swallowed.
 *
 * fs/path only — no electron or rpc imports — so it stays node-testable and safe
 * to pull into the image-generation code path (see repo memory on lib files that
 * load `window`/electron at import time).
 */

const GITIGNORE_FILENAME = ".gitignore"
const GENERATED_SECTION_HEADER = "# Etyon-generated files (auto-added)"
const TRAILING_SLASH_PATTERN = /\/+$/u

const normalizeEntry = (entry: string): string =>
  entry.trim().replace(TRAILING_SLASH_PATTERN, "")

const isEntryIgnored = (contents: string, entry: string): boolean => {
  const target = normalizeEntry(entry)

  return contents.split("\n").some((line) => normalizeEntry(line) === target)
}

/**
 * Pure computation of the next .gitignore contents after ensuring `entry` is
 * present. Returns null when no change is needed (entry already ignored).
 * A `generated-images` line and a `generated-images/` line count as the same
 * entry. Exported for unit tests.
 */
export const buildNextGitignoreContents = (
  contents: string,
  entry: string
): null | string => {
  if (isEntryIgnored(contents, entry)) {
    return null
  }

  const base =
    contents.length === 0 || contents.endsWith("\n")
      ? contents
      : `${contents}\n`
  const header = base.includes(GENERATED_SECTION_HEADER)
    ? ""
    : `${base.length === 0 ? "" : "\n"}${GENERATED_SECTION_HEADER}\n`

  return `${base}${header}${entry}\n`
}

const isGitRepository = async (projectPath: string): Promise<boolean> => {
  try {
    // `.git` is a directory in a normal clone, a file in worktrees/submodules.
    await fs.stat(path.join(projectPath, ".git"))

    return true
  } catch {
    return false
  }
}

/**
 * Ensure `entry` is listed in the project's .gitignore, creating the file if the
 * project is a git repository and it does not exist yet. No-ops when the project
 * is not a git repo or the entry is already ignored. Never throws.
 */
export const ensureGitignored = async ({
  entry,
  projectPath
}: {
  entry: string
  projectPath: string
}): Promise<void> => {
  try {
    if (!(await isGitRepository(projectPath))) {
      return
    }

    const gitignorePath = path.join(projectPath, GITIGNORE_FILENAME)
    let contents = ""

    try {
      contents = await fs.readFile(gitignorePath, "utf-8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }

    const nextContents = buildNextGitignoreContents(contents, entry)

    if (nextContents !== null) {
      await fs.writeFile(gitignorePath, nextContents, "utf-8")
    }
  } catch {
    // Best-effort: a failure to update .gitignore must not fail generation.
  }
}
