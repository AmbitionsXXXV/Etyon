import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import type { ForgePlatform } from "@electron-forge/shared-types"

const projectDir = path.resolve(import.meta.dirname, "..")
const workspaceRoot = path.resolve(projectDir, "..", "..")
const buildScriptPath = path.join(
  workspaceRoot,
  "native",
  "screen-awareness-macos",
  "build-app.sh"
)

export const buildScreenAwarenessHelper = ({
  isRelease,
  platform
}: {
  isRelease: boolean
  platform: ForgePlatform
}): void => {
  if (platform !== "darwin") {
    return
  }

  const result = spawnSync("bash", [buildScriptPath], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      ETYON_RELEASE: isRelease ? "true" : "false"
    },
    stdio: "inherit"
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `Screen Awareness helper build failed with exit code ${result.status ?? "unknown"}`
    )
  }
}

export const signPackagedScreenAwarenessApp = ({
  outputPaths,
  platform
}: {
  outputPaths: string[]
  platform: ForgePlatform
}): void => {
  if (platform !== "darwin") {
    return
  }

  const signIdentity = process.env.ETYON_MACOS_SIGN_IDENTITY?.trim() || "-"

  for (const outputPath of outputPaths) {
    const appBundleNames = fs
      .readdirSync(outputPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
      .map((entry) => entry.name)

    for (const appBundleName of appBundleNames) {
      const appBundlePath = path.join(outputPath, appBundleName)
      const result = spawnSync(
        "/usr/bin/codesign",
        ["--force", "--deep", "--sign", signIdentity, appBundlePath],
        { stdio: "inherit" }
      )

      if (result.error) {
        throw result.error
      }

      if (result.status !== 0) {
        throw new Error(
          `Packaged macOS app signing failed with exit code ${result.status ?? "unknown"}`
        )
      }
    }
  }
}
