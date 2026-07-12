import { describe, expect, it } from "vite-plus/test"

import {
  SETTINGS_NAV_ENTRIES,
  SETTINGS_NAV_LABEL_KEY_BY_SECTION
} from "@/renderer/lib/settings-page/nav-config"

describe("settings nav config", () => {
  it("assigns a distinct icon to every section", () => {
    const icons = SETTINGS_NAV_ENTRIES.map((entry) => entry.icon)

    expect(new Set(icons).size).toBe(SETTINGS_NAV_ENTRIES.length)
  })

  it("lists every labeled section exactly once", () => {
    const ids = SETTINGS_NAV_ENTRIES.map((entry) => entry.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.toSorted()).toEqual(
      Object.keys(SETTINGS_NAV_LABEL_KEY_BY_SECTION).toSorted()
    )
  })
})
