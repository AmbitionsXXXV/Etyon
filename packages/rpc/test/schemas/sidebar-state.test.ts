import { describe, expect, it } from "vite-plus/test"

import { SidebarUiStateSchema } from "../../src/schemas/sidebar-state"

describe("SidebarUiStateSchema", () => {
  it("defaults collapsed project paths to an empty array", () => {
    expect(SidebarUiStateSchema.parse({})).toEqual({
      collapsedProjectPaths: [],
      sidebarWidthPx: 272
    })
  })
})
