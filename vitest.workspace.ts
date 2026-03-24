import { defineConfig } from "vite-plus/test/config"

export default defineConfig({
  test: {
    projects: [
      "./apps/desktop/vitest.config.ts",
      "./packages/rpc/vitest.config.ts"
    ]
  }
})
