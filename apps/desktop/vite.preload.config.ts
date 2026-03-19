import { defineConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

export default defineConfig({
  build: {
    rolldownOptions: {
      input: { preload: "src/preload/index.ts" }
    }
  },
  plugins: [tsconfigPaths()]
})
