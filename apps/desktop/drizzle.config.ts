import { homedir } from "node:os"

import { defineConfig } from "drizzle-kit"

import { getDatabaseUrl } from "./src/main/db/libsql-paths"

export default defineConfig({
  dbCredentials: {
    url: getDatabaseUrl(homedir())
  },
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/main/db/schema.ts"
})
