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

import { resolveBuildIdentifier } from "./forge/build-identifier"
import { copyPackagedRuntimeDependencies } from "./forge/packaged-dependencies"

const APP_CATEGORY_TYPE = "public.app-category.utilities"
const APP_COPYRIGHT_OWNER = "etcetera"

const buildIdentifier = resolveBuildIdentifier()
const isRelease = buildIdentifier === "release"
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
    // pnpm's hoisted layout defeats @electron/packager's dependency walker;
    // see forge/packaged-dependencies.ts for the how and why.
    packageAfterCopy: (
      _forgeConfig,
      buildPath,
      _electronVersion,
      platform,
      arch
    ) => {
      copyPackagedRuntimeDependencies({ arch, buildPath, platform })

      return Promise.resolve()
    }
  },
  rebuildConfig: {}
}

export default config
