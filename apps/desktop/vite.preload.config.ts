import { defineConfig } from "vite-plus"

import { desktopAliases } from "./vite-aliases"

export default defineConfig({
  build: {
    rolldownOptions: {
      input: { preload: "src/preload/index.ts" }
    }
  },
  resolve: {
    alias: [...desktopAliases],
    tsconfigPaths: true
  }
})
