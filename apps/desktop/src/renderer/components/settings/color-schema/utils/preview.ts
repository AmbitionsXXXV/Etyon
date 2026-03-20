import { CREATE_THEME_DEFAULT_VALUES } from "../constants/defaults"
import type { CustomThemeColorFields } from "../types"
import { getReadableTextColor, getValidHexColor, mixHexColors } from "./color"

export const createPreviewPalette = ({
  accent,
  background,
  secondary,
  text
}: CustomThemeColorFields) => {
  const accentColor = getValidHexColor(
    accent,
    CREATE_THEME_DEFAULT_VALUES.accent
  )
  const backgroundColor = getValidHexColor(
    background,
    CREATE_THEME_DEFAULT_VALUES.background
  )
  const secondaryColor = getValidHexColor(
    secondary,
    CREATE_THEME_DEFAULT_VALUES.secondary
  )
  const textColor = getValidHexColor(text, CREATE_THEME_DEFAULT_VALUES.text)

  return {
    accent: accentColor,
    accentSurface: mixHexColors(accentColor, backgroundColor, 0.18),
    accentText: getReadableTextColor(accentColor),
    background: backgroundColor,
    border: mixHexColors(textColor, backgroundColor, 0.18),
    card: mixHexColors(textColor, backgroundColor, 0.08),
    chrome: mixHexColors(textColor, backgroundColor, 0.04),
    code: mixHexColors(textColor, backgroundColor, 0.1),
    mutedText: mixHexColors(textColor, backgroundColor, 0.45),
    secondary: secondaryColor,
    secondaryText: getReadableTextColor(secondaryColor),
    sidebar: mixHexColors(textColor, backgroundColor, 0.05),
    text: textColor
  }
}
