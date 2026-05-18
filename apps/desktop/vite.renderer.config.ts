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
  "@heroui-pro/react",
  "@hugeicons/core-free-icons",
  "@hugeicons/react",
  "@orpc/client",
  "@orpc/client/message-port",
  "@orpc/tanstack-query",
  "@pierre/diffs",
  "@pierre/diffs/react",
  "@pierre/trees",
  "@pierre/trees/react",
  "@tanstack/react-devtools",
  "@tanstack/react-form",
  "@tanstack/react-form-devtools",
  "@tanstack/react-hotkeys",
  "@tanstack/react-hotkeys-devtools",
  "@tanstack/react-query",
  "@tanstack/react-query-devtools",
  "@tanstack/react-router",
  "@tanstack/react-router-devtools",
  "@tiptap/core",
  "@tiptap/extension-placeholder",
  "@tiptap/react",
  "@tiptap/starter-kit",
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
  "react-resizable-panels",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "shiki/bundle/web",
  "sonner",
  "tailwind-merge",
  "use-sync-external-store/shim",
  "use-sync-external-store/shim/index.js",
  "use-sync-external-store/shim/with-selector",
  "use-sync-external-store/shim/with-selector.js",
  "zod",
  "zod/mini"
] as const
const reactDedupeDependencies = [
  "react",
  "react-dom",
  "use-sync-external-store"
] as const
const useSyncExternalStoreAliases = [
  // Tiptap imports these CJS shims with explicit .js suffixes. Normalize them
  // before Vite serves the nested package copy directly in the browser.
  {
    find: /^use-sync-external-store\/shim\/index\.js$/u,
    replacement: "use-sync-external-store/shim"
  },
  {
    find: /^use-sync-external-store\/shim\/with-selector\.js$/u,
    replacement: "use-sync-external-store/shim/with-selector"
  }
] as const

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
    alias: [...useSyncExternalStoreAliases, ...desktopAliases],
    dedupe: [...reactDedupeDependencies],
    tsconfigPaths: true
  }
})
