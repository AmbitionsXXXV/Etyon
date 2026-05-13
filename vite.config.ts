import ultraciteCoreConfig from "ultracite/oxlint/core"
import ultraciteReactConfig from "ultracite/oxlint/react"
import { defineConfig } from "vite-plus"
import type { DummyRuleMap } from "vite-plus/lint"

const unsupportedLintRules = new Set([
  "func-name-matching",
  "jsx-a11y/interactive-supports-focus",
  "logical-assignment-operators",
  "no-restricted-properties",
  "no-underscore-dangle",
  "react/forbid-component-props",
  "require-unicode-regexp"
])

const omitUnsupportedRules = (rules: DummyRuleMap | undefined): DummyRuleMap =>
  Object.fromEntries(
    Object.entries(rules ?? {}).filter(
      ([ruleName]) => !unsupportedLintRules.has(ruleName)
    )
  ) as DummyRuleMap

const lintPlugins = [
  ...new Set([
    ...(ultraciteCoreConfig.plugins ?? []),
    ...(ultraciteReactConfig.plugins ?? [])
  ])
]
const lintRules = {
  ...omitUnsupportedRules(ultraciteCoreConfig.rules),
  ...omitUnsupportedRules(ultraciteReactConfig.rules),
  "eslint/func-style": "off",
  "eslint/no-use-before-define": "off",
  "eslint/sort-keys": "off",
  "eslint-plugin-unicorn/number-literal-case": "off"
} satisfies DummyRuleMap

export default defineConfig({
  // Preserve the existing Ultracite formatter behavior inside Vite+.
  fmt: {
    arrowParens: "always",
    bracketSameLine: false,
    bracketSpacing: true,
    endOfLine: "lf",
    experimentalSortImports: {
      ignoreCase: true,
      newlinesBetween: true,
      order: "asc"
    },
    experimentalSortPackageJson: true,
    ignorePatterns: [
      ".agents/**/*",
      ".claude/**/*",
      ".cursor/**/*",
      "**/.vite/**",
      "**/dist/**",
      "**/out/**",
      "**/routeTree.gen.ts"
    ],
    jsxSingleQuote: false,
    printWidth: 80,
    quoteProps: "as-needed",
    semi: false,
    singleQuote: false,
    sortTailwindcss: {
      attributes: ["className"],
      stylesheet: "packages/ui/src/styles/globals.css"
    },
    tabWidth: 2,
    trailingComma: "none",
    useTabs: false
  },
  lint: {
    categories: ultraciteCoreConfig.categories,
    env: ultraciteCoreConfig.env,
    ignorePatterns: [
      ".agents/**/*",
      ".claude/**/*",
      ".cursor/**/*",
      "**/.vite/**",
      "**/dist/**",
      "**/out/**",
      "**/routeTree.gen.ts"
    ],
    overrides: ultraciteCoreConfig.overrides,
    plugins: lintPlugins,
    rules: lintRules
  },
  staged: {
    "*.{css,js,json,jsonc,jsx,ts,tsx}": "vp check --fix"
  },
  test: {
    projects: [
      "./apps/desktop/vitest.config.ts",
      "./packages/rpc/vitest.config.ts"
    ]
  }
})
