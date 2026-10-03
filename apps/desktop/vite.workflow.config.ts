import { defineConfig } from "vite-plus"

import { desktopAliases } from "./vite-aliases"

export default defineConfig({
  build: {
    lib: {
      entry: "src/main/agents/minimal/workflow/workflow-worker.ts",
      fileName: () => "workflow-worker.js",
      formats: ["es"]
    },
    outDir: ".vite/build",
    emptyOutDir: false,
    rolldownOptions: { external: ["node:vm", "node:worker_threads"] },
    target: "node22"
  },
  resolve: { alias: [...desktopAliases], tsconfigPaths: true }
})
