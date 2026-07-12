import { defineConfig } from "vite-plus"

import { desktopAliases } from "./vite-aliases"

const ESM_SHIMS = [
  `import { createRequire as __etyonCreateRequire } from "node:module";`,
  `import { fileURLToPath as __etyonFileURLToPath } from "node:url";`,
  `import { dirname as __etyonDirname } from "node:path";`,
  `const require = __etyonCreateRequire(import.meta.url);`,
  `const __filename = __etyonFileURLToPath(import.meta.url);`,
  `const __dirname = __etyonDirname(__filename);`
].join(" ")

export default defineConfig({
  build: {
    lib: {
      entry: "src/main/index.ts",
      fileName: () => "[name].js",
      formats: ["es"]
    },
    rolldownOptions: {
      external: ["@vscode/ripgrep", "electron-liquid-glass", "font-list"],
      output: {
        banner: ESM_SHIMS
      }
    }
  },
  resolve: {
    alias: [...desktopAliases],
    tsconfigPaths: true
  }
})
