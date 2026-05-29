import ultracite from "ultracite/oxfmt"
import ultraciteCoreConfig from "ultracite/oxlint/core"
import ultraciteReactConfig from "ultracite/oxlint/react"
import ultraciteTanstackConfig from "ultracite/oxlint/tanstack"
import { defineConfig } from "vite-plus"

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
    overrides: [
      ...(ultraciteCoreConfig.overrides ?? []),
      ...(ultraciteTanstackConfig.overrides ?? [])
    ],
    plugins: [
      ...(ultraciteCoreConfig.plugins ?? []),
      ...(ultraciteReactConfig.plugins ?? [])
    ],
    rules: {
      ...ultraciteCoreConfig.rules,
      ...ultraciteReactConfig.rules,
      ...ultraciteTanstackConfig.rules,
      "eslint/func-style": "off",
      "eslint/no-use-before-define": "off",
      "eslint/sort-keys": "off",
      "eslint-plugin-unicorn/number-literal-case": "off",
      "unicorn/numeric-separators-style": "off"
    }
  },
  staged: {
    "*.{css,js,json,jsonc,jsx,ts,tsx}": "vp check --fix",
    "**/*.rs": "sh -c 'cargo fmt --all'"
  },
  test: {
    projects: ["./apps/desktop/vite.config.ts", "./packages/rpc/vite.config.ts"]
  }
})
