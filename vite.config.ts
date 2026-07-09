import ultracite from "ultracite/oxfmt"
import ultraciteCoreConfig from "ultracite/oxlint/core"
import ultraciteReactConfig from "ultracite/oxlint/react"
import ultraciteTanstackConfig from "ultracite/oxlint/tanstack"
import { defineConfig } from "vite-plus"

// ultracite 7.9.x enables these rules through oxlint JS plugins
// (eslint-plugin-github, eslint-plugin-sonarjs, react-doctor) that this
// toolchain does not install, so oxlint fails to resolve them at config parse.
// We only spread ultracite's `rules`/`overrides` (not its `jsPlugins`), so drop
// the corresponding rule prefixes to keep the rest of the 7.9 preset working.
const DISABLED_LINT_PLUGIN_PREFIXES = new Set([
  "github",
  "react-doctor",
  "sonarjs"
])

const isDisabledPluginRule = (ruleName: string): boolean =>
  DISABLED_LINT_PLUGIN_PREFIXES.has(ruleName.split("/")[0] ?? "")

const withoutDisabledPluginRules = (
  rules: Record<string, unknown>
): typeof ultraciteCoreConfig.rules =>
  // Cast back to the oxlint rule-map type: filtering only removes keys, so the
  // result stays assignable, but Object.fromEntries widens the value type.
  Object.fromEntries(
    Object.entries(rules).filter(
      ([ruleName]) => !isDisabledPluginRule(ruleName)
    )
  ) as typeof ultraciteCoreConfig.rules

const withoutDisabledPluginOverrides = <
  Override extends { rules?: Record<string, unknown> }
>(
  overrides: readonly Override[]
): Override[] =>
  overrides.map((override) =>
    override.rules
      ? { ...override, rules: withoutDisabledPluginRules(override.rules) }
      : override
  )

export default defineConfig({
  fmt: {
    ...ultracite,
    ignorePatterns: [
      ...(ultracite.ignorePatterns ?? []),
      ".agents/**/*",
      ".claude/**/*",
      ".cursor/**/*",
      "**/.vite/**",
      "**/dist/**",
      "**/out/**",
      "**/routeTree.gen.ts"
    ],
    semi: false,
    sortTailwindcss: {
      attributes: ["className"],
      stylesheet: "packages/ui/src/styles/globals.css"
    },
    trailingComma: "none"
  },
  lint: {
    env: ultraciteCoreConfig.env,
    ignorePatterns: [
      ...(ultraciteCoreConfig.ignorePatterns ?? []),
      ".agents/**/*",
      ".claude/**/*",
      ".cursor/**/*",
      "**/.vite/**",
      "**/dist/**",
      "**/out/**",
      "**/routeTree.gen.ts",
      "**/cursor-auth/proto/**"
    ],
    overrides: withoutDisabledPluginOverrides([
      ...(ultraciteCoreConfig.overrides ?? []),
      ...(ultraciteTanstackConfig.overrides ?? [])
    ]),
    plugins: [
      ...(ultraciteCoreConfig.plugins ?? []),
      ...(ultraciteReactConfig.plugins ?? [])
    ],
    rules: withoutDisabledPluginRules({
      ...ultraciteCoreConfig.rules,
      ...ultraciteReactConfig.rules,
      ...ultraciteTanstackConfig.rules,
      "eslint/func-style": "off",
      "eslint/no-use-before-define": "off",
      "eslint/sort-keys": "off",
      "eslint-plugin-unicorn/number-literal-case": "off",
      "unicorn/numeric-separators-style": "off",
      // ultracite 7.9 newly enables these rules; they flag long-standing
      // patterns across the codebase (sequential DB transactions, sync setState
      // in effects, ref writes during render, unnamed regex groups). Disabled
      // to match the pre-7.9 baseline. Re-enable and migrate incrementally;
      // react/react-compiler in particular flags real issues worth revisiting.
      "eslint/no-await-in-loop": "off",
      "eslint/no-nested-ternary": "off",
      "eslint/prefer-named-capture-group": "off",
      "node/callback-return": "off",
      "react/hook-use-state": "off",
      "react/no-clone-element": "off",
      "react/react-compiler": "off",
      "typescript/method-signature-style": "off",
      "unicorn/no-nested-ternary": "off",
      "unicorn/prefer-export-from": "off",
      "unicorn/prefer-number-coercion": "off"
    })
  },
  staged: {
    "*.{css,js,json,jsonc,jsx,ts,tsx}": "vp check --fix",
    "**/*.rs": "sh -c 'cargo fmt --all'"
  },
  test: {
    projects: ["./apps/desktop/vite.config.ts", "./packages/rpc/vite.config.ts"]
  }
})
