import tailwindcss from "@tailwindcss/vite"
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
