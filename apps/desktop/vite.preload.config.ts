import { defineConfig } from "vite"

export default defineConfig({
  build: {
    rolldownOptions: {
      input: { preload: "src/preload/index.ts" }
    }
  }
})
