import { describe, expect, it } from "vite-plus/test"

import { SidebarUiStateSchema } from "../../src/schemas/sidebar-state"

describe("SidebarUiStateSchema", () => {
  it("defaults collapsed project paths to an empty array", () => {
    expect(SidebarUiStateSchema.parse({})).toEqual({
      collapsedProjectPaths: [],
      projectDisplayNames: {},
      projectOrder: [],
      projectPins: {},
      sidebarWidthPx: 272
    })
  })

  it("accepts project display names and pins", () => {
    expect(
      SidebarUiStateSchema.parse({
        projectDisplayNames: {
          "/tmp/project-a": "Project A"
        },
        projectOrder: ["/tmp/project-b", "/tmp/project-a"],
        projectPins: {
          "/tmp/project-a": "2026-05-14T00:00:00.000Z"
        }
      })
    ).toEqual({
      collapsedProjectPaths: [],
      projectDisplayNames: {
        "/tmp/project-a": "Project A"
      },
      projectOrder: ["/tmp/project-b", "/tmp/project-a"],
      projectPins: {
        "/tmp/project-a": "2026-05-14T00:00:00.000Z"
      },
      sidebarWidthPx: 272
    })
  })
})
