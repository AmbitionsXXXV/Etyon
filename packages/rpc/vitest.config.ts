import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineProject } from "vitest/config"

const rootDirectory = path.dirname(fileURLToPath(import.meta.url))

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
