import { platform } from "@electron-toolkit/utils"
/* eslint-disable unicorn/prefer-module -- Electron main process requires CommonJS */
import { app, Menu } from "electron"

import { createSettingsWindow } from "./window"

export const setupMenu = () => {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(platform.isMacOS
      ? [
          {
            label: app.name,
            submenu: [
              { label: `About ${app.name}`, role: "about" as const },
              { type: "separator" as const },
              {
                accelerator: "Cmd+,",
                click: () => createSettingsWindow(),
                label: "Settings..."
              },
              { type: "separator" as const },
              {
                label: `Hide ${app.name}`,
                role: "hide" as const
              },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const }
            ]
          }
        ]
      : []),
    {
      label: "File",
      submenu: [
        ...(platform.isMacOS
          ? []
          : [
              {
                accelerator: "Ctrl+,",
                click: () => createSettingsWindow(),
                label: "Settings"
              },
              { type: "separator" as const }
            ]),
        platform.isMacOS
          ? { role: "close" as const }
          : { role: "quit" as const }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        ...(platform.isMacOS
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }])
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
