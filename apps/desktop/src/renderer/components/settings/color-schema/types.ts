import type { CustomThemePreset, CustomThemeType } from "@etyon/rpc"

export interface CustomThemeFormValues {
  accent: string
  background: string
  name: string
  preset: CustomThemePreset
  secondary: string
  text: string
  type: CustomThemeType
}

export type CustomThemeColorFields = Pick<
  CustomThemeFormValues,
  "accent" | "background" | "secondary" | "text"
>
