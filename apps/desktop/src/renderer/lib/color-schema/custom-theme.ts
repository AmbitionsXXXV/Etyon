import type { AppSettings, CustomTheme } from "@etyon/rpc"

import { getReadableTextColor } from "@/renderer/components/settings/color-schema/utils/color"

export type CustomThemeSelection = Pick<
  AppSettings,
  "customDarkThemeId" | "customLightThemeId" | "customThemes"
>

export const resolveActiveCustomTheme = (
  { customDarkThemeId, customLightThemeId, customThemes }: CustomThemeSelection,
  prefersDark: boolean
): CustomTheme | null => {
  const themeId = prefersDark ? customDarkThemeId : customLightThemeId

  if (!themeId) {
    return null
  }

  return (
    customThemes.find(
      (theme) =>
        theme.id === themeId && theme.type === (prefersDark ? "dark" : "light")
    ) ?? null
  )
}

/**
 * Expands a custom theme's four colors into the HeroUI semantic tokens, the
 * same set the built-in schemas (see tokyo-night.css) override. Status colors
 * and the derived hover/soft tokens come from HeroUI's light or dark defaults,
 * which stay active because `data-theme` remains `light` / `dark`.
 */
export const buildCustomThemeCss = ({ colors, type }: CustomTheme): string => {
  const { accent, background, secondary, text } = colors

  return `:root[data-custom-theme] {
  color-scheme: ${type};
  --background-opaque: ${background};
  --background: var(--background-opaque);
  --foreground: ${text};
  --surface-opaque: color-mix(in oklab, ${text} 5%, var(--background-opaque));
  --surface: var(--surface-opaque);
  --surface-foreground: var(--foreground);
  --surface-secondary: color-mix(in oklab, ${text} 10%, var(--background-opaque));
  --surface-secondary-foreground: var(--foreground);
  --surface-tertiary: color-mix(in oklab, ${accent} 10%, var(--background-opaque));
  --surface-tertiary-foreground: var(--muted);
  --overlay-opaque: color-mix(in oklab, ${text} 8%, var(--background-opaque));
  --overlay: var(--overlay-opaque);
  --overlay-foreground: var(--foreground);
  --muted: color-mix(in oklab, var(--foreground) 60%, var(--background-opaque));
  --scrollbar: color-mix(in oklab, ${accent} 48%, var(--background-opaque));
  --default: color-mix(in oklab, ${secondary} 18%, var(--background-opaque));
  --default-foreground: var(--foreground);
  --accent: ${accent};
  --accent-foreground: ${getReadableTextColor(accent)};
  --field-background: var(--surface);
  --field-border: var(--border);
  --field-foreground: var(--foreground);
  --field-placeholder: var(--muted);
  --segment: var(--default);
  --segment-foreground: var(--foreground);
  --border: color-mix(in oklab, var(--foreground) 14%, var(--background-opaque));
  --separator: var(--border);
  --focus: var(--accent);
  --link: var(--accent);
}

:root[data-custom-theme][data-liquid-glass] {
  --background: color-mix(in oklab, var(--background-opaque) 80%, transparent);
  --overlay: color-mix(in oklab, var(--overlay-opaque) 90%, transparent);
  --sidebar: color-mix(in oklab, var(--surface-opaque) 60%, transparent);
  --surface: color-mix(in oklab, var(--surface-opaque) 85%, transparent);
}
`
}
