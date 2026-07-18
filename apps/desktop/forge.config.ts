import { cpSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { MakerDeb } from "@electron-forge/maker-deb"
import { MakerDMG } from "@electron-forge/maker-dmg"
import { MakerRpm } from "@electron-forge/maker-rpm"
import { MakerSquirrel } from "@electron-forge/maker-squirrel"
import { MakerZIP } from "@electron-forge/maker-zip"
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives"
import { FusesPlugin } from "@electron-forge/plugin-fuses"
import { VitePlugin } from "@electron-forge/plugin-vite"
import type { ForgeConfig } from "@electron-forge/shared-types"
import { FuseV1Options, FuseVersion } from "@electron/fuses"

const DEVELOPMENT_BUILD_IDENTIFIER = "development" as const
const RELEASE_BUILD_IDENTIFIER = "release" as const
const RELEASE_COMMANDS = new Set([
  "build",
  "make",
  "package",
  "publish",
  "release"
])
const RELEASE_ENV_VALUES = new Set(["1", "production", "release", "true"])
const APP_CATEGORY_TYPE = "public.app-category.utilities"
const APP_COPYRIGHT_OWNER = "etcetera"

const normalizeEnvValue = (value: string | undefined): string | undefined =>
  value?.trim().toLowerCase()

const hasReleaseCommandArg = (): boolean => {
  for (const arg of process.argv) {
    if (RELEASE_COMMANDS.has(arg)) {
      return true
    }
  }

  return false
}

const resolveBuildIdentifier = ():
  | typeof DEVELOPMENT_BUILD_IDENTIFIER
  | typeof RELEASE_BUILD_IDENTIFIER => {
  const explicitBuildIdentifier = normalizeEnvValue(
    process.env.ELECTRON_FORGE_BUILD_IDENTIFIER ??
      process.env.ETYON_BUILD_IDENTIFIER
  )

  if (explicitBuildIdentifier === DEVELOPMENT_BUILD_IDENTIFIER) {
    return DEVELOPMENT_BUILD_IDENTIFIER
  }

  if (explicitBuildIdentifier === RELEASE_BUILD_IDENTIFIER) {
    return RELEASE_BUILD_IDENTIFIER
  }

  const explicitReleaseFlag = normalizeEnvValue(
    process.env.ETYON_RELEASE ?? process.env.RELEASE
  )

  if (explicitReleaseFlag && RELEASE_ENV_VALUES.has(explicitReleaseFlag)) {
    return RELEASE_BUILD_IDENTIFIER
  }

  if (normalizeEnvValue(process.env.NODE_ENV) === "production") {
    return RELEASE_BUILD_IDENTIFIER
  }

  const lifecycleEvent = normalizeEnvValue(process.env.npm_lifecycle_event)

  if (lifecycleEvent && RELEASE_COMMANDS.has(lifecycleEvent)) {
    return RELEASE_BUILD_IDENTIFIER
  }

  return hasReleaseCommandArg()
    ? RELEASE_BUILD_IDENTIFIER
    : DEVELOPMENT_BUILD_IDENTIFIER
}

// Packages the packaged main process needs in `node_modules` at runtime but
// that `@electron/packager` prunes away — pnpm's hoisted layout keeps them at
// the WORKSPACE ROOT, not in `apps/desktop/node_modules`, so the packager's
// dependency walker never finds them. We copy the closure ourselves in a
// `packageAfterCopy` hook. Two flavors:
//   * `EXTERNAL_MAIN_PACKAGES` — marked `external` in vite.main.config.ts
//     (they ship `.node` addons or execFile'd helpers that can't be bundled);
//   * arch-specific native sub-packages that BUNDLED code loads by name at
//     runtime (node-pty / ripgrep prebuilds, and libsql's `@libsql/<target>`
//     binding pulled in via `@neon-rs/load`).
const EXTERNAL_MAIN_PACKAGES = [
  "font-list",
  "@lydell/node-pty",
  "@vscode/ripgrep",
  "electron-liquid-glass"
] as const

// App-root directories the main process reads at runtime via `app.getAppPath()`
// (i.e. from inside the asar). Vite bundles only `.vite`, and the plugin's
// packager `ignore` drops everything else, so these must be copied in too.
// `drizzle/` holds the migration journal + SQL that `db/migrate.ts` loads.
const APP_ASSET_DIRS = ["drizzle"] as const

const projectDir = import.meta.dirname
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

const buildIdentifier = resolveBuildIdentifier()
const isRelease = buildIdentifier === RELEASE_BUILD_IDENTIFIER
const appBundleId = isRelease ? "com.etcetera.etyon" : "com.etcetera.etyon.dev"
const appDescription = isRelease
  ? "Etyon desktop application"
  : "Etyon desktop application (development build)"
const appName = isRelease ? "Etyon" : "Etyon Dev"
const currentYear = new Date().getFullYear()
const executableName = isRelease ? "etyon" : "etyon-dev"
const helperBundleId = `${appBundleId}.helper`
const originalFilename = `${appName}.exe`

const config: ForgeConfig = {
  buildIdentifier,
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
    new MakerDMG({
      icon: "resources/icon.icns"
    })
  ],
  packagerConfig: {
    appBundleId,
    appCategoryType: APP_CATEGORY_TYPE,
    appCopyright: `Copyright © ${currentYear} ${APP_COPYRIGHT_OWNER}`,
    asar: {
      // font-list execFile's its bundled `fontlist` helper, and node-pty /
      // ripgrep load native binaries — all must sit OUTSIDE the asar. (.node
      // addons are additionally handled by AutoUnpackNativesPlugin.)
      unpack:
        "{**/node_modules/@lydell/node-pty-*/prebuilds/**,**/node_modules/@vscode/ripgrep-*/bin/**,**/node_modules/font-list/libs/**}"
    },
    darwinDarkModeSupport: true,
    executableName,
    extraResource: [
      "resources/icon.icns",
      "resources/icon.ico",
      "resources/tray.png"
    ],
    helperBundleId,
    icon: "resources/icon",
    name: appName,
    win32metadata: {
      CompanyName: APP_COPYRIGHT_OWNER,
      FileDescription: appDescription,
      InternalName: executableName,
      OriginalFilename: originalFilename,
      ProductName: appName,
      "requested-execution-level": "asInvoker"
    }
  },
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          config: "vite.main.config.ts",
          entry: "src/main/index.ts",
          target: "main"
        },
        {
          config: "vite.preload.config.ts",
          entry: "src/preload/index.ts",
          target: "preload"
        }
      ],
      renderer: [
        {
          config: "vite.renderer.config.ts",
          name: "main_window"
        }
      ]
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ],
  hooks: {
    // The Vite plugin bundles the app and lets `@electron/packager` prune
    // node_modules, but pnpm's hoisted layout defeats the packager's dependency
    // walker, so the externalized main-process packages never make it into the
    // build. Copy their resolved closure from the workspace root — plus the
    // runtime app-asset dirs the plugin's `ignore` drops — into the packaged
    // app (deref symlinks) before the asar is sealed.
    packageAfterCopy: (
      _forgeConfig,
      buildPath,
      _electronVersion,
      platform,
      arch
    ) => {
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

      return Promise.resolve()
    }
  },
  rebuildConfig: {}
}

export default config
