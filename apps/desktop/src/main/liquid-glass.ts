import { platform } from "@electron-toolkit/utils"
import type { BrowserWindow } from "electron"
import type liquidGlassDefault from "electron-liquid-glass"

let liquidGlassModule: typeof liquidGlassDefault | null = null

const loadModule = async (): Promise<typeof liquidGlassDefault> => {
  if (!liquidGlassModule) {
    const mod = await import("electron-liquid-glass")
    liquidGlassModule = mod.default
  }
  return liquidGlassModule
}

export const applyLiquidGlass = (win: BrowserWindow) => {
  if (!platform.isMacOS) {
    return
  }

  win.setWindowButtonVisibility(true)

  win.webContents.once("did-finish-load", async () => {
    try {
      const liquidGlass = await loadModule()
      liquidGlass.addView(win.getNativeWindowHandle())
      win.webContents.send("liquid-glass-active", true)
    } catch {
      // macOS < 26 or native module unavailable — fall back to opaque window
    }
  })
}
