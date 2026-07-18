import { cpSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"

/**
 * Ships the packaged main process's runtime dependencies. The Forge Vite
 * plugin bundles the app and lets `@electron/packager` prune node_modules, but
 * pnpm's hoisted layout keeps third-party deps at the WORKSPACE ROOT — not in
 * `apps/desktop/node_modules` — so the packager's dependency walker never
 * finds them and the packaged app would crash on its first external require.
 * `copyPackagedRuntimeDependencies` (wired into the `packageAfterCopy` hook in
 * forge.config.ts) copies the resolved closure — plus the runtime app-asset
 * dirs the Vite plugin's packager `ignore` drops — into the build before the
 * asar is sealed.
 */

// Marked `external` in vite.main.config.ts: they ship `.node` addons or
// execFile'd helper binaries that cannot survive bundling.
const EXTERNAL_MAIN_PACKAGES = [
  "font-list",
  "@lydell/node-pty",
  "@vscode/ripgrep",
  "electron-liquid-glass"
] as const

// App-root directories the main process reads at runtime via `app.getAppPath()`
// (i.e. from inside the asar). `drizzle/` holds the migration journal + SQL
// that `db/migrate.ts` loads.
const APP_ASSET_DIRS = ["drizzle"] as const

const projectDir = path.resolve(import.meta.dirname, "..")
const workspaceRootModules = path.resolve(
  projectDir,
  "..",
  "..",
  "node_modules"
)

// A malformed or unreadable package.json here means a broken install — let it
// throw so the build fails loudly instead of silently dropping transitive deps.
const readPackageDependencies = (packageDir: string): string[] => {
  const manifest = JSON.parse(
    readFileSync(path.join(packageDir, "package.json"), "utf-8")
  ) as { dependencies?: Record<string, string> }

  return Object.keys(manifest.dependencies ?? {})
}

// libsql's platform binding names are irregular — `@libsql/darwin-arm64` but
// `@libsql/linux-x64-gnu|-musl` and `@libsql/win32-x64-msvc` — so enumerate
// them from the `libsql` package's own optionalDependencies instead of
// guessing `@libsql/<platform>-<arch>` (which only matches on darwin). The
// suffix guard keeps arch "arm" from matching "arm64" packages.
const collectLibsqlBindingSeeds = (
  platform: string,
  arch: string
): string[] => {
  const manifestPath = path.join(workspaceRootModules, "libsql", "package.json")

  if (!existsSync(manifestPath)) {
    return []
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    optionalDependencies?: Record<string, string>
  }
  const bindingPrefix = `@libsql/${platform}-${arch}`

  return Object.keys(manifest.optionalDependencies ?? {}).filter(
    (name) => name === bindingPrefix || name.startsWith(`${bindingPrefix}-`)
  )
}

// Breadth-first over the externalized packages plus their arch-specific native
// sub-packages, following `dependencies` so transitive runtime deps (e.g.
// electron-liquid-glass → bindings → file-uri-to-path) come along. Missing
// packages are only tolerated for OTHER platforms' native sub-packages (cross
// builds); the base packages — and, when packaging for the host platform, its
// own native sub-packages — must resolve or the build fails loudly, because a
// silent skip here ships an app that crashes on its first external require.
const collectExternalPackageClosure = (
  platform: string,
  arch: string
): string[] => {
  const platformSeeds = [
    `@lydell/node-pty-${platform}-${arch}`,
    `@vscode/ripgrep-${platform}-${arch}`,
    ...collectLibsqlBindingSeeds(platform, arch)
  ]
  const queue = [...EXTERNAL_MAIN_PACKAGES, ...platformSeeds]
  const resolved = new Set<string>()

  while (queue.length > 0) {
    const name = queue.shift()

    if (name === undefined || resolved.has(name)) {
      continue
    }

    const packageDir = path.join(workspaceRootModules, name)

    if (!existsSync(packageDir)) {
      continue
    }

    resolved.add(name)
    queue.push(...readPackageDependencies(packageDir))
  }

  const isHostTarget = platform === process.platform && arch === process.arch
  const requiredPackages = isHostTarget
    ? [...EXTERNAL_MAIN_PACKAGES, ...platformSeeds]
    : [...EXTERNAL_MAIN_PACKAGES]
  const missingPackages = requiredPackages.filter((name) => !resolved.has(name))

  if (missingPackages.length > 0) {
    throw new Error(
      `Packaged main-process dependencies missing from ${workspaceRootModules}: ` +
        `${missingPackages.join(", ")} — run \`vp install\` before packaging.`
    )
  }

  return [...resolved]
}

/** Copies the runtime dependency closure and app assets into `buildPath`. */
export const copyPackagedRuntimeDependencies = ({
  arch,
  buildPath,
  platform
}: {
  arch: string
  buildPath: string
  platform: string
}): void => {
  for (const name of collectExternalPackageClosure(platform, arch)) {
    cpSync(
      path.join(workspaceRootModules, name),
      path.join(buildPath, "node_modules", name),
      { dereference: true, recursive: true }
    )
  }

  for (const dir of APP_ASSET_DIRS) {
    cpSync(path.join(projectDir, dir), path.join(buildPath, dir), {
      dereference: true,
      recursive: true
    })
  }
}
