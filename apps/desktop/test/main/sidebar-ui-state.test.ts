import fs from "node:fs"

import { afterAll, describe, expect, it, vi } from "vite-plus/test"

import {
  getSidebarUiState,
  removeProjectUiState,
  setCollapsedProjectPaths,
  setProjectDisplayName,
  setProjectPinned,
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
      projectDisplayNames: {},
      projectPins: {},
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
      projectDisplayNames: {},
      projectPins: {},
      sidebarWidthPx: 272
    })
    expect(getSidebarUiState()).toEqual(nextState)
  })

  it("persists clamped sidebar width while preserving collapsed paths", () => {
    setCollapsedProjectPaths(["/tmp/a-project"])

    expect(setSidebarWidthPx(999)).toEqual({
      collapsedProjectPaths: ["/tmp/a-project"],
      projectDisplayNames: {},
      projectPins: {},
      sidebarWidthPx: 420
    })
    expect(setSidebarWidthPx(120)).toEqual({
      collapsedProjectPaths: ["/tmp/a-project"],
      projectDisplayNames: {},
      projectPins: {},
      sidebarWidthPx: 240
    })
  })

  it("persists normalized project display names and pins", () => {
    const namedState = setProjectDisplayName({
      displayName: " Project B ",
      projectPath: " /tmp/b-project "
    })
    const pinnedState = setProjectPinned({
      pinned: true,
      projectPath: " /tmp/b-project "
    })

    expect(namedState.projectDisplayNames).toEqual({
      "/tmp/b-project": "Project B"
    })
    expect(pinnedState.projectPins["/tmp/b-project"]).toBeTruthy()
  })

  it("removes project-specific sidebar state", () => {
    removeProjectUiState("/tmp/b-project")
    setCollapsedProjectPaths(["/tmp/remove-project"])
    setProjectDisplayName({
      displayName: "Remove Me",
      projectPath: "/tmp/remove-project"
    })
    setProjectPinned({
      pinned: true,
      projectPath: "/tmp/remove-project"
    })

    expect(removeProjectUiState("/tmp/remove-project")).toMatchObject({
      collapsedProjectPaths: [],
      projectDisplayNames: {},
      projectPins: {}
    })
  })
})
