import { HEX_COLOR_REGEX } from "../constants/defaults"

export const getValidHexColor = (value: string, fallback: string) =>
  HEX_COLOR_REGEX.test(value) ? value : fallback

export const hexToRgb = (value: string) => ({
  b: Number.parseInt(value.slice(5, 7), 16),
  g: Number.parseInt(value.slice(3, 5), 16),
  r: Number.parseInt(value.slice(1, 3), 16)
})

export const rgbToHex = ({ b, g, r }: { b: number; g: number; r: number }) =>
  `#${[r, g, b]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`

export const mixHexColors = (
  foreground: string,
  background: string,
  ratio: number
) => {
  const backgroundRgb = hexToRgb(background)
  const foregroundRgb = hexToRgb(foreground)

  return rgbToHex({
    b: foregroundRgb.b * ratio + backgroundRgb.b * (1 - ratio),
    g: foregroundRgb.g * ratio + backgroundRgb.g * (1 - ratio),
    r: foregroundRgb.r * ratio + backgroundRgb.r * (1 - ratio)
  })
}

export const getReadableTextColor = (background: string) => {
  const { b, g, r } = hexToRgb(background)
  const luminance = (r * 299 + g * 587 + b * 114) / 1000

  return luminance >= 140 ? "#0f172a" : "#f8fafc"
}
