import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    TanStackRouterVite(), // MUST come before react()
    react(),
  ],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
})
