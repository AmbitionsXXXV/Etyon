import { describe, expect, it } from "vitest"

import { SidebarUiStateSchema } from "./sidebar-state"

describe("SidebarUiStateSchema", () => {
  it("defaults collapsed project paths to an empty array", () => {
    expect(SidebarUiStateSchema.parse({})).toEqual({
      collapsedProjectPaths: []
    })
  })
})
