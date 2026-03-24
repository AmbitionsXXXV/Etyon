import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineProject } from "vitest/config"

const rootDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineProject({
  resolve: {
    alias: [
      {
        find: /^@etyon\/i18n$/u,
        replacement: path.resolve(
          rootDirectory,
          "../../packages/i18n/src/index.ts"
        )
      },
      {
        find: /^@etyon\/rpc$/u,
        replacement: path.resolve(
          rootDirectory,
          "../../packages/rpc/src/index.ts"
        )
      },
      {
        find: /^@main\/(.*)$/u,
        replacement: `${path.resolve(rootDirectory, "src/main")}/$1`
      },
      {
        find: /^@renderer\/(.*)$/u,
        replacement: `${path.resolve(rootDirectory, "src/renderer")}/$1`
      },
      {
        find: /^@\/(.*)$/u,
        replacement: `${path.resolve(rootDirectory, "src")}/$1`
      }
    ]
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    name: "desktop"
  }
})
