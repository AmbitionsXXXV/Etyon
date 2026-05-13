import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite-plus"

import { desktopAliases } from "./vite-aliases"

const optimizedDependencies = [
  "@ai-sdk/react",
  "@base-ui/react",
  "@base-ui/react/dialog",
  "@base-ui/react/merge-props",
  "@base-ui/react/scroll-area",
  "@base-ui/react/select",
  "@base-ui/react/tooltip",
  "@base-ui/react/use-render",
  "@heroui/react",
  "@hugeicons/core-free-icons",
  "@hugeicons/react",
  "@orpc/client",
  "@orpc/client/message-port",
  "@orpc/tanstack-query",
  "@tanstack/react-devtools",
  "@tanstack/react-form",
  "@tanstack/react-form-devtools",
  "@tanstack/react-hotkeys",
  "@tanstack/react-hotkeys-devtools",
  "@tanstack/react-query",
  "@tanstack/react-query-devtools",
  "@tanstack/react-router",
  "@tanstack/react-router-devtools",
  "ai",
  "class-variance-authority",
  "clsx",
  "i18next",
  "motion/react",
  "next-themes",
  "react",
  "react-dom",
  "react-dom/client",
  "react-i18next",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "sonner",
  "tailwind-merge",
  "use-sync-external-store/shim",
  "use-sync-external-store/shim/with-selector",
  "zod",
  "zod/mini"
] as const
const reactDedupeDependencies = ["react", "react-dom"] as const

export default defineConfig({
  optimizeDeps: {
    include: [...optimizedDependencies],
    noDiscovery: true
  },
  plugins: [
    devtools(),
    tanstackRouter({
      generatedRouteTree: "./src/renderer/routeTree.gen.ts",
      routesDirectory: "./src/renderer/routes"
    }),
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: [...desktopAliases],
    dedupe: [...reactDedupeDependencies],
    tsconfigPaths: true
  }
})
