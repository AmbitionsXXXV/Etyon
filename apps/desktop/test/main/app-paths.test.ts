import path from "node:path"

import { describe, expect, it } from "vite-plus/test"

import {
  getAppConfigDir,
  getAppDirectoryName,
  getAppLogDir,
  getElectronUserDataDir,
  getRuntimeBuildIdentifier
} from "@/main/app-paths"

describe("app paths", () => {
  it("defaults unbundled development code to isolated directories", () => {
    expect(getRuntimeBuildIdentifier()).toBe("development")
    expect(getAppConfigDir("/home/tester")).toBe(
      path.join("/home/tester", ".config", "etyon-dev")
    )
    expect(getAppLogDir("/home/tester")).toBe(
      path.join("/home/tester", ".etyon-dev", "logs")
    )
    expect(getElectronUserDataDir("/app-data")).toBe(
      path.join("/app-data", "etyon-dev")
    )
  })

  it("keeps release data in the existing production directories", () => {
    expect(getAppDirectoryName("release")).toBe("etyon")
    expect(getAppConfigDir("/home/tester", "release")).toBe(
      path.join("/home/tester", ".config", "etyon")
    )
    expect(getAppLogDir("/home/tester", "release")).toBe(
      path.join("/home/tester", ".etyon", "logs")
    )
    expect(getElectronUserDataDir("/app-data", "release")).toBe(
      path.join("/app-data", "etyon")
    )
  })
})
