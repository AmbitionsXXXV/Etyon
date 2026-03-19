import type { CustomThemePreset, CustomThemeType } from "@etyon/rpc"

import type { CustomThemeFormValues } from "../types"

export const CUSTOM_THEME_PRESETS: readonly {
  colors: Record<
    CustomThemeType,
    Pick<CustomThemeFormValues, "accent" | "background" | "secondary" | "text">
  >
  key: Exclude<CustomThemePreset, "custom">
}[] = [
  {
    colors: {
      dark: {
        accent: "#4da3ff",
        background: "#1b263b",
        secondary: "#2ec4b6",
        text: "#e0e7ff"
      },
      light: {
        accent: "#2563eb",
        background: "#eff6ff",
        secondary: "#0f766e",
        text: "#0f172a"
      }
    },
    key: "ocean"
  },
  {
    colors: {
      dark: {
        accent: "#78c27d",
        background: "#1b2a1f",
        secondary: "#b6d27f",
        text: "#e7f4dd"
      },
      light: {
        accent: "#3f8f4f",
        background: "#f3faef",
        secondary: "#8cab4a",
        text: "#223322"
      }
    },
    key: "forest"
  },
  {
    colors: {
      dark: {
        accent: "#f08a5d",
        background: "#2a1f2d",
        secondary: "#f9c784",
        text: "#f7e8ff"
      },
      light: {
        accent: "#dd6b20",
        background: "#fff4eb",
        secondary: "#d97706",
        text: "#422006"
      }
    },
    key: "sunset"
  },
  {
    colors: {
      dark: {
        accent: "#88c0d0",
        background: "#2e3440",
        secondary: "#a3be8c",
        text: "#eceff4"
      },
      light: {
        accent: "#5e81ac",
        background: "#eceff4",
        secondary: "#8fbcbb",
        text: "#2e3440"
      }
    },
    key: "nord"
  },
  {
    colors: {
      dark: {
        accent: "#78dce8",
        background: "#2d2a2e",
        secondary: "#a9dc76",
        text: "#fcfcfa"
      },
      light: {
        accent: "#0ea5b7",
        background: "#fdf7f7",
        secondary: "#65a30d",
        text: "#27272a"
      }
    },
    key: "monokai"
  }
] as const

export type CustomThemePresetRow = (typeof CUSTOM_THEME_PRESETS)[number]
