import type { DarkColorSchema, LightColorSchema } from "@etyon/rpc"

export const DARK_COLOR_SCHEMA_SWATCHES: Record<
  DarkColorSchema,
  readonly string[]
> = {
  aquarium: [
    "oklch(28.9% 0.0181 285deg)",
    "oklch(89.1% 0.0454 266deg)",
    "oklch(84.8% 0.0862 138deg)",
    "oklch(83% 0.058 18.4deg)",
    "oklch(85.9% 0.0882 336deg)",
    "oklch(86.8% 0.017 259deg)"
  ],
  "chadracula-evondev": [
    "oklch(27% 0.0479 283deg)",
    "oklch(78.9% 0.142 226deg)",
    "oklch(87.1% 0.22 148deg)",
    "oklch(68.2% 0.206 24.4deg)",
    "oklch(74.2% 0.149 302deg)",
    "oklch(97.7% 0.00791 107deg)"
  ],
  default: [
    "oklch(0.145 0 0)",
    "oklch(0.205 0 0)",
    "oklch(0.269 0 0)",
    "oklch(0.488 0.243 264.376)",
    "oklch(0.704 0.191 22.216)"
  ],
  poimandres: [
    "oklch(31.1% 0.0297 271deg)",
    "oklch(85.6% 0.0929 225deg)",
    "oklch(70.9% 0.0868 178deg)",
    "oklch(65.4% 0.146 350deg)",
    "oklch(75% 0.0464 277deg)",
    "oklch(94.9% 0.0203 243deg)"
  ],
  "tokyo-night": [
    "oklch(28.2% 0.0355 275deg)",
    "oklch(72% 0.132 265deg)",
    "oklch(79.5% 0.14 130deg)",
    "oklch(72.1% 0.16 9.95deg)",
    "oklch(75.1% 0.134 299deg)",
    "oklch(84.6% 0.0611 275deg)"
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
    "oklch(98.5% 0.000000000000000508 0deg)",
    "oklch(60.2% 0.193 263deg)",
    "oklch(63.8% 0.141 144deg)",
    "oklch(60.4% 0.18 28.7deg)",
    "oklch(68.6% 0.095 299deg)",
    "oklch(45.1% 0.00979 278deg)"
  ],
  paper: [
    "oklch(96.5% 0.00454 78.3deg)",
    "oklch(66.2% 0.0419 160deg)",
    "oklch(66.2% 0.0419 160deg)",
    "oklch(57.7% 0.145 22.7deg)",
    "oklch(56.6% 0.0723 321deg)",
    "oklch(35.2% 0.0017 106deg)"
  ]
}
