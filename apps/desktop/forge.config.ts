import { MakerDeb } from "@electron-forge/maker-deb"
import { MakerDMG } from "@electron-forge/maker-dmg"
import { MakerRpm } from "@electron-forge/maker-rpm"
import { MakerSquirrel } from "@electron-forge/maker-squirrel"
import { MakerZIP } from "@electron-forge/maker-zip"
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
    asar: true,
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
  rebuildConfig: {}
}

export default config
