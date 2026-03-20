import type { CustomThemeFormValues } from "../types"

export const HEX_COLOR_REGEX = /^#[0-9a-f]{6}$/

export const CREATE_THEME_DEFAULT_VALUES: CustomThemeFormValues = {
  accent: "#4da3ff",
  background: "#1b263b",
  name: "",
  preset: "ocean",
  secondary: "#2ec4b6",
  text: "#e0e7ff",
  type: "dark"
}
