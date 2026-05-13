import { defineProject } from "vite-plus/test/config"

import { desktopAliases } from "./vite-aliases"

export default defineProject({
  resolve: {
    alias: [...desktopAliases]
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    name: "desktop"
  }
})
