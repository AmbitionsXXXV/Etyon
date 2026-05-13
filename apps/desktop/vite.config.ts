import { defineProject } from "vite-plus/test/config"

import { desktopAliases } from "./vite-aliases"

export default defineProject({
  resolve: {
    alias: [...desktopAliases]
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    name: "desktop"
  }
})
