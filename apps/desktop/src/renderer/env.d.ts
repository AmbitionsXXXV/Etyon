import type { EtyonElectronApi } from "@preload/index"

declare global {
  interface Window {
    // The preload exposes `@electron-toolkit/preload`'s `ElectronAPI` plus the
    // terminal data-channel bridge (`onTerminalData` / `sendTerminalInput`).
    electron: EtyonElectronApi
  }
}
