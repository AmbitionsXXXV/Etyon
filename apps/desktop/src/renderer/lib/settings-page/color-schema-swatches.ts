import type { DarkColorSchema, LightColorSchema } from "@etyon/rpc"

export const DARK_COLOR_SCHEMA_SWATCHES: Record<
  DarkColorSchema,
  readonly string[]
> = {
  default: [
    "oklch(0.145 0 0)",
    "oklch(0.205 0 0)",
    "oklch(0.269 0 0)",
    "oklch(0.488 0.243 264.376)",
    "oklch(0.704 0.191 22.216)"
  ],
  "tokyo-night": [
    "oklch(0.226 0.021 280.487)",
    "oklch(0.282 0.036 274.748)",
    "oklch(0.846 0.061 274.763)",
    "oklch(0.719 0.132 264.202)",
    "oklch(0.723 0.159 10.276)"
  ]
}

export const LIGHT_COLOR_SCHEMA_SWATCHES: Record<
  LightColorSchema,
  readonly string[]
> = {
  default: [
    "oklch(1 0 0)",
    "oklch(0.97 0 0)",
    "oklch(0.922 0 0)",
    "oklch(0.205 0 0)",
    "oklch(0.577 0.245 27.325)"
  ],
  "one-light": [
    "oklch(0.985 0 89.876)",
    "oklch(0.955 0.001 286.375)",
    "oklch(0.35 0.014 274.503)",
    "oklch(0.602 0.193 263.246)",
    "oklch(0.639 0.179 28.344)"
  ]
}
