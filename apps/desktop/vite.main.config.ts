import { defineConfig } from "vite-plus"

import { desktopAliases } from "./vite-aliases"

const REQUIRE_POLYFILL = `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`

export default defineConfig({
  build: {
    lib: {
      entry: "src/main/index.ts",
      fileName: () => "[name].js",
      formats: ["es"]
    },
    rolldownOptions: {
      external: ["electron-liquid-glass", "font-list"],
      output: {
        banner: REQUIRE_POLYFILL
      }
    }
  },
  resolve: {
    alias: [...desktopAliases],
    tsconfigPaths: true
  }
})
