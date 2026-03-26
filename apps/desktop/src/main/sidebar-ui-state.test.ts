import fs from "node:fs"

import { afterAll, describe, expect, it, vi } from "vitest"

import {
  getSidebarUiState,
  setCollapsedProjectPaths,
  setSidebarWidthPx
} from "@/main/sidebar-ui-state"

const { mockedHomeDir } = vi.hoisted(() => ({
  mockedHomeDir: `/tmp/etyon-sidebar-ui-state-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`
}))

vi.mock("@electron-toolkit/utils", () => ({
  is: {
    dev: true
  },
  optimizer: {
    watchWindowShortcuts: vi.fn()
  },
  platform: {
    isLinux: true,
    isMacOS: false,
    isWindows: false
  }
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => []
  },
  app: {
    getLocale: () => "en-US",
    getPath: () => mockedHomeDir,
    getVersion: () => "0.1.0-test"
  },
  ipcMain: {
    on: vi.fn()
  }
}))

describe("sidebar ui state", () => {
  afterAll(() => {
    fs.rmSync(mockedHomeDir, { force: true, recursive: true })
  })

  it("defaults to no collapsed project paths", () => {
    expect(getSidebarUiState()).toEqual({
      collapsedProjectPaths: [],
      sidebarWidthPx: 272
    })
  })

  it("persists deduplicated collapsed project paths", () => {
    const nextState = setCollapsedProjectPaths([
      "/tmp/b-project",
      "/tmp/a-project",
      "/tmp/a-project"
    ])

    expect(nextState).toEqual({
      collapsedProjectPaths: ["/tmp/a-project", "/tmp/b-project"],
      sidebarWidthPx: 272
    })
    expect(getSidebarUiState()).toEqual(nextState)
  })

  it("persists clamped sidebar width while preserving collapsed paths", () => {
    setCollapsedProjectPaths(["/tmp/a-project"])

    expect(setSidebarWidthPx(999)).toEqual({
      collapsedProjectPaths: ["/tmp/a-project"],
      sidebarWidthPx: 420
    })
    expect(setSidebarWidthPx(120)).toEqual({
      collapsedProjectPaths: ["/tmp/a-project"],
      sidebarWidthPx: 240
    })
  })
})
