import { defineConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

const REQUIRE_POLYFILL = `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`

export default defineConfig({
  build: {
    lib: {
      entry: "src/main/index.ts",
      fileName: () => "[name].js",
      formats: ["es"]
    },
    rolldownOptions: {
      external: ["font-list"],
      output: {
        banner: REQUIRE_POLYFILL
      }
    }
  },
  plugins: [tsconfigPaths()]
})
