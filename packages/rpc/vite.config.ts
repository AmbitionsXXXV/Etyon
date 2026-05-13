import path from "node:path"

import { defineProject } from "vite-plus/test/config"

const rootDirectory = import.meta.dirname

export default defineProject({
  resolve: {
    alias: [
      {
        find: /^@etyon\/i18n$/u,
        replacement: path.resolve(rootDirectory, "../i18n/src/index.ts")
      }
    ]
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    name: "rpc"
  }
})
