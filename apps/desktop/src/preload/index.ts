import { electronAPI } from "@electron-toolkit/preload"
import { contextBridge, ipcRenderer } from "electron"

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electron", electronAPI)
} else {
  window.electron = electronAPI
}

window.addEventListener("message", (event) => {
  if (event.data === "start-orpc-client") {
    const [serverPort] = event.ports
    ipcRenderer.postMessage("start-orpc-server", null, [serverPort])
  }
})
