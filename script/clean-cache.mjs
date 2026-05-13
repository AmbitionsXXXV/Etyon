#!/usr/bin/env node

import { lstat, readdir, rm } from "node:fs/promises"
import path from "node:path"

const ROOT_DIR = path.resolve(import.meta.dirname, "..")

const DIRECTORY_PATTERNS = [
  ".cache",
  ".nyc_output",
  ".turbo",
  ".vite",
  "apps/*/.cache",
  "apps/*/.nyc_output",
  "apps/*/.turbo",
  "apps/*/.vite",
  "apps/*/coverage",
  "apps/*/dist",
  "apps/*/node_modules",
  "apps/*/out",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "packages/*/.cache",
  "packages/*/.nyc_output",
  "packages/*/.turbo",
  "packages/*/.vite",
  "packages/*/coverage",
  "packages/*/dist",
  "packages/*/node_modules",
  "packages/*/out"
]

const FILE_PATTERNS = [
  "*.tsbuildinfo",
  "apps/*/*.tsbuildinfo",
  "packages/*/*.tsbuildinfo"
]

const HELP_TEXT = `Usage: vp run clean:cache [-- --dry-run]

Removes dependency folders and generated caches from this workspace.

Options:
  --dry-run    Print matched paths without deleting them.
  --help       Show this help message.
`

const hasFlag = (flag) => process.argv.includes(flag)

const segmentToRegExp = (segment) =>
  new RegExp(
    `^${segment
      .split("*")
      .map((part) => part.replaceAll(/[|\\{}()[\]^$+?.]/gu, "\\$&"))
      .join(".*")}$`,
    "u"
  )

const pathExists = async (targetPath) => {
  try {
    await lstat(targetPath)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false
    }

    throw error
  }
}

const expandSegments = async (baseDir, segments) => {
  if (segments.length === 0) {
    return [baseDir]
  }

  const [segment, ...restSegments] = segments

  if (!segment.includes("*")) {
    return expandSegments(path.join(baseDir, segment), restSegments)
  }

  if (!(await pathExists(baseDir))) {
    return []
  }

  const segmentRegExp = segmentToRegExp(segment)
  const entries = await readdir(baseDir, { withFileTypes: true })
  const matches = entries.filter((entry) => segmentRegExp.test(entry.name))
  const expandedPaths = []

  for (const entry of matches) {
    if (restSegments.length > 0 && !entry.isDirectory()) {
      continue
    }

    const nextBaseDir = path.join(baseDir, entry.name)
    expandedPaths.push(...(await expandSegments(nextBaseDir, restSegments)))
  }

  return expandedPaths
}

const expandPattern = (pattern) => expandSegments(ROOT_DIR, pattern.split("/"))

const collectTargets = async () => {
  const targetPaths = new Set()
  const patterns = [...DIRECTORY_PATTERNS, ...FILE_PATTERNS]

  for (const pattern of patterns) {
    const expandedPaths = await expandPattern(pattern)

    for (const targetPath of expandedPaths) {
      if (await pathExists(targetPath)) {
        targetPaths.add(targetPath)
      }
    }
  }

  return [...targetPaths].toSorted((left, right) => left.localeCompare(right))
}

const formatRelativePath = (targetPath) => path.relative(ROOT_DIR, targetPath)

const clean = async () => {
  if (hasFlag("--help")) {
    console.log(HELP_TEXT.trimEnd())
    return
  }

  const dryRun = hasFlag("--dry-run")
  const targets = await collectTargets()

  if (targets.length === 0) {
    console.log("No cache targets found.")
    return
  }

  for (const targetPath of targets) {
    const relativePath = formatRelativePath(targetPath)

    if (dryRun) {
      console.log(`[dry-run] ${relativePath}`)
      continue
    }

    await rm(targetPath, { force: true, recursive: true })
    console.log(`removed ${relativePath}`)
  }
}

try {
  await clean()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
