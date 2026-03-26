import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vite-plus"
import type { DummyRuleMap, OxlintConfig } from "vite-plus/lint"

const rootDirectory = path.dirname(fileURLToPath(import.meta.url))

const parseJsonc = (value: string): unknown =>
  JSON.parse(value.replaceAll(/^\s*\/\/.*$/gmu, ""))

const readJsoncConfig = <T>(filePath: string): T =>
  parseJsonc(readFileSync(filePath, "utf8")) as T

const ultraciteCoreConfig = readJsoncConfig<OxlintConfig>(
  path.join(
    rootDirectory,
    "node_modules/ultracite/config/oxlint/core/.oxlintrc.json"
  )
)
const ultraciteReactConfig = readJsoncConfig<OxlintConfig>(
  path.join(
    rootDirectory,
    "node_modules/ultracite/config/oxlint/react/.oxlintrc.json"
  )
)

const lintPlugins = [
  ...new Set([
    ...(ultraciteCoreConfig.plugins ?? []),
    ...(ultraciteReactConfig.plugins ?? [])
  ])
]
const lintRules = {
  ...ultraciteCoreConfig.rules,
  ...ultraciteReactConfig.rules,
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
