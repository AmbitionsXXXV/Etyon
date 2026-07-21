import { defineConfig } from "vite-plus"

import { resolveBuildIdentifier } from "./forge/build-identifier"
import { desktopAliases } from "./vite-aliases"

const ESM_SHIMS = [
  `import { createRequire as __etyonCreateRequire } from "node:module";`,
  `import { fileURLToPath as __etyonFileURLToPath } from "node:url";`,
  `import { dirname as __etyonDirname } from "node:path";`,
  `const require = __etyonCreateRequire(import.meta.url);`,
  `const __filename = __etyonFileURLToPath(import.meta.url);`,
  `const __dirname = __etyonDirname(__filename);`
].join(" ")

const buildIdentifier = resolveBuildIdentifier()

export default defineConfig({
  build: {
    lib: {
      entry: "src/main/index.ts",
      fileName: () => "[name].js",
      formats: ["es"]
    },
    rolldownOptions: {
      external: [
        "@lydell/node-pty",
        "@vscode/ripgrep",
        "electron-liquid-glass",
        "font-list"
      ],
      output: {
        banner: ESM_SHIMS
      }
    }
  },
  define: {
    "process.env.ETYON_BUILD_IDENTIFIER": JSON.stringify(buildIdentifier)
  },
  resolve: {
    alias: [...desktopAliases],
    tsconfigPaths: true
  }
})
