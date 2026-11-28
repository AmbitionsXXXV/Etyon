import type { CustomTheme } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import {
  buildCustomThemeCss,
  resolveActiveCustomTheme
} from "@/renderer/lib/color-schema/custom-theme"

const darkTheme: CustomTheme = {
  colors: {
    accent: "#4da3ff",
    background: "#1b263b",
    secondary: "#2ec4b6",
    text: "#e0e7ff"
  },
  createdAt: "2026-11-28T00:00:00.000Z",
  id: "dark-ocean",
  name: "Dark Ocean",
  preset: "ocean",
  type: "dark",
  updatedAt: "2026-11-28T00:00:00.000Z"
}

const lightTheme: CustomTheme = {
  ...darkTheme,
  colors: {
    accent: "#2563eb",
    background: "#eff6ff",
    secondary: "#0f766e",
    text: "#0f172a"
  },
  id: "light-ocean",
  name: "Light Ocean",
  type: "light"
}

const selection = {
  customDarkThemeId: darkTheme.id,
  customLightThemeId: lightTheme.id,
  customThemes: [darkTheme, lightTheme]
}

describe("resolveActiveCustomTheme", () => {
  it("picks the theme selected for the current appearance", () => {
    expect(resolveActiveCustomTheme(selection, true)).toBe(darkTheme)
    expect(resolveActiveCustomTheme(selection, false)).toBe(lightTheme)
  })

  it("returns null when nothing is selected", () => {
    expect(
      resolveActiveCustomTheme({ ...selection, customDarkThemeId: null }, true)
    ).toBeNull()
  })

  it("ignores a deleted theme", () => {
    expect(
      resolveActiveCustomTheme({ ...selection, customThemes: [] }, true)
    ).toBeNull()
  })

  it("ignores a theme whose type does not match the slot", () => {
    expect(
      resolveActiveCustomTheme(
        { ...selection, customDarkThemeId: lightTheme.id },
        true
      )
    ).toBeNull()
  })
})

describe("buildCustomThemeCss", () => {
  it("maps the four colors onto HeroUI tokens", () => {
    const css = buildCustomThemeCss(darkTheme)

    expect(css).toContain("color-scheme: dark;")
    expect(css).toContain("--background-opaque: #1b263b;")
    expect(css).toContain("--foreground: #e0e7ff;")
    expect(css).toContain("--accent: #4da3ff;")
    expect(css).toContain("#2ec4b6 18%")
    expect(css).toContain("--field-background: var(--surface);")
  })

  it("picks a readable accent foreground", () => {
    expect(buildCustomThemeCss(darkTheme)).toContain(
      "--accent-foreground: #0f172a;"
    )
    expect(buildCustomThemeCss(lightTheme)).toContain(
      "--accent-foreground: #f8fafc;"
    )
  })

  it("keeps liquid glass translucency", () => {
    expect(buildCustomThemeCss(lightTheme)).toContain(
      ":root[data-custom-theme][data-liquid-glass]"
    )
  })
})
