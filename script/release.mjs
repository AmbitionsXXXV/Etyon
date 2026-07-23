#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT_DIR = path.resolve(import.meta.dirname, "..")

const RELEASE_PACKAGE_NAMES = ["etyon", "@etyon/desktop"]
const RELEASE_PACKAGE_JSON_PATHS = ["package.json", "apps/desktop/package.json"]
const BUMP_KEYWORDS = new Set([
  "major",
  "minor",
  "patch",
  "premajor",
  "preminor",
  "prepatch",
  "prerelease"
])
const EXPLICIT_VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u

const HELP_TEXT = `Usage: vp run release -- <patch|minor|major|X.Y.Z> [options]

Bump the product version (root etyon + @etyon/desktop), refresh CHANGELOG.md
with git-cliff, then create a release commit and annotated tag.

Uses Vite+ package-manager forwarding (vp pm version → packageManager pnpm).
Does not introduce Changesets.

Arguments:
  patch|minor|major   Semver keyword bump
  X.Y.Z               Explicit version (optional leading v)

Options:
  --dry-run           Print the plan without changing files or git state
  --push              Push the release commit and tag to origin
  --skip-changelog    Skip regenerating CHANGELOG.md
  --help              Show this help message

Examples:
  vp run release -- patch
  vp run release -- patch -- --dry-run
  vp run release -- 0.2.0 -- --push
`

const fail = (message) => {
  console.error(`error: ${message}`)
  process.exit(1)
}

const hasFlag = (args, flag) => args.includes(flag)

const removeFlags = (args, flags) => args.filter((arg) => !flags.includes(arg))

const run = (command, args, { allowFail = false } = {}) => {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: "utf-8",
    stdio: "pipe"
  })

  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`)
  }

  if (result.status !== 0 && !allowFail) {
    const stderr = result.stderr?.trim()
    const stdout = result.stdout?.trim()
    const detail = stderr || stdout || `exit ${result.status ?? "unknown"}`
    fail(`${command} ${args.join(" ")}\n${detail}`)
  }

  return result
}

const runInherit = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: "inherit"
  })

  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`)
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit ${result.status}`)
  }
}

const readPackageVersion = (relativePath) => {
  const absolutePath = path.join(ROOT_DIR, relativePath)
  const packageJson = JSON.parse(readFileSync(absolutePath, "utf-8"))

  if (
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    fail(`${relativePath} is missing a version field`)
  }

  return packageJson.version
}

const assertReleaseVersionsAligned = () => {
  const versions = RELEASE_PACKAGE_JSON_PATHS.map((relativePath) => ({
    path: relativePath,
    version: readPackageVersion(relativePath)
  }))
  const [first, ...rest] = versions
  const mismatched = rest.filter((entry) => entry.version !== first.version)

  if (mismatched.length > 0) {
    const details = versions
      .map((entry) => `  ${entry.path}: ${entry.version}`)
      .join("\n")
    fail(`release package versions are not aligned:\n${details}`)
  }

  return first.version
}

const isWorkingTreeClean = () => {
  const result = run("git", ["status", "--porcelain"])
  return result.stdout.trim().length === 0
}

const parseBumpTarget = (rawValue) => {
  if (!rawValue) {
    return null
  }

  if (BUMP_KEYWORDS.has(rawValue)) {
    return { kind: "keyword", value: rawValue }
  }

  const match = EXPLICIT_VERSION_PATTERN.exec(rawValue)
  if (!match) {
    return null
  }

  return {
    kind: "explicit",
    value: rawValue.startsWith("v") ? rawValue.slice(1) : rawValue
  }
}

const parseSemverCore = (version) => {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
      version
    )

  if (!match) {
    fail(`unsupported current version: ${version}`)
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null
  }
}

const formatSemver = ({ major, minor, patch, prerelease }) => {
  const core = `${major}.${minor}.${patch}`
  return prerelease ? `${core}-${prerelease}` : core
}

const computeNextVersion = (currentVersion, bumpTarget) => {
  if (bumpTarget.kind === "explicit") {
    return bumpTarget.value
  }

  const current = parseSemverCore(currentVersion)

  switch (bumpTarget.value) {
    case "major": {
      return formatSemver({
        major: current.major + 1,
        minor: 0,
        patch: 0,
        prerelease: null
      })
    }
    case "minor": {
      return formatSemver({
        major: current.major,
        minor: current.minor + 1,
        patch: 0,
        prerelease: null
      })
    }
    case "patch": {
      return formatSemver({
        major: current.major,
        minor: current.minor,
        patch: current.patch + 1,
        prerelease: null
      })
    }
    case "premajor": {
      return formatSemver({
        major: current.major + 1,
        minor: 0,
        patch: 0,
        prerelease: "0"
      })
    }
    case "preminor": {
      return formatSemver({
        major: current.major,
        minor: current.minor + 1,
        patch: 0,
        prerelease: "0"
      })
    }
    case "prepatch": {
      return formatSemver({
        major: current.major,
        minor: current.minor,
        patch: current.patch + 1,
        prerelease: "0"
      })
    }
    case "prerelease": {
      if (current.prerelease) {
        const parts = current.prerelease.split(".")
        const last = parts.at(-1)
        if (last && /^\d+$/u.test(last)) {
          parts[parts.length - 1] = String(Number(last) + 1)
          return formatSemver({ ...current, prerelease: parts.join(".") })
        }
        return formatSemver({
          ...current,
          prerelease: `${current.prerelease}.0`
        })
      }

      return formatSemver({
        major: current.major,
        minor: current.minor,
        patch: current.patch + 1,
        prerelease: "0"
      })
    }
    default: {
      fail(`unsupported bump keyword: ${bumpTarget.value}`)
    }
  }
}

const tagExists = (tagName) => {
  const result = run("git", ["rev-parse", "--verify", `refs/tags/${tagName}`], {
    allowFail: true
  })
  return result.status === 0
}

const normalizeArgv = (rawArgv) =>
  // `vp run release -- patch -- --dry-run` forwards bare `--` tokens; drop them.
  rawArgv.filter((arg) => arg !== "--")

const main = () => {
  const argv = normalizeArgv(process.argv.slice(2))

  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    console.log(HELP_TEXT)
    return
  }

  const dryRun = hasFlag(argv, "--dry-run")
  const push = hasFlag(argv, "--push")
  const skipChangelog = hasFlag(argv, "--skip-changelog")
  const positional = removeFlags(argv, [
    "--dry-run",
    "--push",
    "--skip-changelog",
    "--help",
    "-h"
  ])

  if (positional.length !== 1) {
    fail(`expected exactly one bump target.\n\n${HELP_TEXT}`)
  }

  const bumpTarget = parseBumpTarget(positional[0])
  if (!bumpTarget) {
    fail(
      `invalid bump target "${positional[0]}". Use patch|minor|major or X.Y.Z.\n\n${HELP_TEXT}`
    )
  }

  const currentVersion = assertReleaseVersionsAligned()
  const plannedVersion = computeNextVersion(currentVersion, bumpTarget)
  const tagName = `v${plannedVersion}`
  const commitMessage = `chore(release): v${plannedVersion}`

  console.log("Release plan")
  console.log(`  packages : ${RELEASE_PACKAGE_NAMES.join(", ")}`)
  console.log(`  current  : ${currentVersion}`)
  console.log(`  next     : ${plannedVersion}`)
  console.log(`  tag      : ${tagName}`)
  console.log(`  commit   : ${commitMessage}`)
  console.log(
    `  changelog: ${
      skipChangelog ? "skip" : `git-cliff --tag ${tagName} -o CHANGELOG.md`
    }`
  )
  console.log(`  push     : ${push ? "yes" : "no"}`)

  if (plannedVersion === currentVersion) {
    fail(
      `next version ${plannedVersion} is identical to the current version; nothing to release`
    )
  }

  if (dryRun) {
    console.log("\nDry run only. No files or git state were changed.")
    return
  }

  if (!isWorkingTreeClean()) {
    fail("working tree is not clean. Commit or stash changes before releasing.")
  }

  if (tagExists(tagName)) {
    fail(`tag ${tagName} already exists`)
  }

  const versionArgs = [
    "pm",
    "version",
    bumpTarget.value,
    "--",
    "-r",
    ...RELEASE_PACKAGE_NAMES.flatMap((name) => ["--filter", name])
  ]

  console.log(`\n> vp ${versionArgs.join(" ")}`)
  runInherit("vp", versionArgs)

  const bumpedVersion = assertReleaseVersionsAligned()
  if (bumpedVersion !== plannedVersion) {
    fail(
      `version after bump is ${bumpedVersion}, expected ${plannedVersion}. Aborting before commit/tag.`
    )
  }

  if (!skipChangelog) {
    const cliffArgs = ["--tag", tagName, "-o", "CHANGELOG.md"]
    console.log(`\n> git-cliff ${cliffArgs.join(" ")}`)
    runInherit("git-cliff", cliffArgs)
  }

  const filesToStage = [...RELEASE_PACKAGE_JSON_PATHS]
  if (!skipChangelog) {
    filesToStage.push("CHANGELOG.md")
  }

  console.log(`\n> git add ${filesToStage.join(" ")}`)
  runInherit("git", ["add", ...filesToStage])

  console.log(`\n> git commit -m "${commitMessage}"`)
  runInherit("git", ["commit", "-m", commitMessage])

  console.log(`\n> git tag -a ${tagName} -m "${tagName}"`)
  runInherit("git", ["tag", "-a", tagName, "-m", tagName])

  if (push) {
    console.log("\n> git push")
    runInherit("git", ["push"])
    console.log(`\n> git push origin ${tagName}`)
    runInherit("git", ["push", "origin", tagName])
  }

  console.log(`\nReleased ${tagName}`)
  if (!push) {
    console.log(
      `Tag is local only. Push when ready:\n  git push && git push origin ${
        tagName
      }`
    )
  }
}

main()
