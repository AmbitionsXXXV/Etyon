import path from "node:path"

const rootDirectory = import.meta.dirname

const resolveFromDesktop = (targetPath: string): string =>
  path.resolve(rootDirectory, targetPath)

const resolveFromWorkspace = (targetPath: string): string =>
  path.resolve(rootDirectory, "../..", targetPath)

export const appAliases = [
  { find: /^@\//u, replacement: `${resolveFromDesktop("src")}/` },
  { find: /^@main\//u, replacement: `${resolveFromDesktop("src/main")}/` },
  {
    find: /^@preload\//u,
    replacement: `${resolveFromDesktop("src/preload")}/`
  },
  {
    find: /^@renderer\//u,
    replacement: `${resolveFromDesktop("src/renderer")}/`
  }
] as const

export const workspacePackageAliases = [
  {
    find: /^@etyon\/i18n$/u,
    replacement: resolveFromWorkspace("packages/i18n/src/index.ts")
  },
  {
    find: /^@etyon\/i18n\/react$/u,
    replacement: resolveFromWorkspace("packages/i18n/src/react.tsx")
  },
  {
    find: /^@etyon\/logger\/core$/u,
    replacement: resolveFromWorkspace("packages/logger/src/core.ts")
  },
  {
    find: /^@etyon\/logger\/renderer$/u,
    replacement: resolveFromWorkspace("packages/logger/src/renderer.ts")
  },
  {
    find: /^@etyon\/logger\/types$/u,
    replacement: resolveFromWorkspace("packages/logger/src/types.ts")
  },
  {
    find: /^@etyon\/rpc$/u,
    replacement: resolveFromWorkspace("packages/rpc/src/index.ts")
  },
  {
    find: /^@etyon\/rpc\/(.*)$/u,
    replacement: `${resolveFromWorkspace("packages/rpc/src")}/$1`
  },
  {
    find: /^@etyon\/ui\/components$/u,
    replacement: resolveFromWorkspace("packages/ui/src/components")
  },
  {
    find: /^@etyon\/ui\/components\/(.*)$/u,
    replacement: `${resolveFromWorkspace("packages/ui/src/components")}/$1`
  },
  {
    find: /^@etyon\/ui\/globals\.css$/u,
    replacement: resolveFromWorkspace("packages/ui/src/styles/globals.css")
  },
  {
    find: /^@etyon\/ui\/hooks\/(.*)$/u,
    replacement: `${resolveFromWorkspace("packages/ui/src/hooks")}/$1`
  },
  {
    find: /^@etyon\/ui\/lib\/(.*)$/u,
    replacement: `${resolveFromWorkspace("packages/ui/src/lib")}/$1`
  },
  {
    find: /^@etyon\/ui\/themes\/(.+?)(?:\.css)?(\?.*)?$/u,
    replacement: `${resolveFromWorkspace("packages/ui/src/styles/themes")}/$1.css$2`
  }
] as const

export const desktopAliases = [
  ...workspacePackageAliases,
  ...appAliases
] as const
