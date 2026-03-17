import tailwindcss from "@tailwindcss/vite"
// this may be need electron-forge@8.x release with feature support full esm
// because `@tanstack/devtools-vite` is a full esm package but forge-vite plugin is not support full esm yet
// import { devtools } from "@tanstack/devtools-vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    // devtools(),
    tanstackRouter({
      generatedRouteTree: "./src/renderer/routeTree.gen.ts",
      routesDirectory: "./src/renderer/routes"
    }),
    react(),
    tailwindcss()
  ]
})
