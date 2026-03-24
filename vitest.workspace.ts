import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      "./apps/desktop/vitest.config.ts",
      "./packages/rpc/vitest.config.ts"
    ]
  }
})
