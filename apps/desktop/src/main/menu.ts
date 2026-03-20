import { platform } from "@electron-toolkit/utils"
import { Menu } from "electron"

import { t } from "./localization"
import { createSettingsWindow } from "./window"

export const setupMenu = (appName: string) => {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(platform.isMacOS
      ? [
          {
            label: appName,
            submenu: [
              {
                label: t("menu.app.about", { appName }),
                role: "about" as const
              },
              { type: "separator" as const },
              {
                accelerator: "Cmd+,",
                click: () => createSettingsWindow(),
                label: t("menu.app.settings")
              },
              { type: "separator" as const },
              {
                label: t("menu.app.hide", { appName }),
                role: "hide" as const
              },
              {
                label: t("menu.app.hideOthers"),
                role: "hideOthers" as const
              },
              { label: t("menu.app.showAll"), role: "unhide" as const },
              { type: "separator" as const },
              {
                label: t("menu.app.quit", { appName }),
                role: "quit" as const
              }
            ]
          }
        ]
      : []),
    {
      label: t("menu.file.label"),
      submenu: [
        ...(platform.isMacOS
          ? []
          : [
              {
                accelerator: "Ctrl+,",
                click: () => createSettingsWindow(),
                label: t("menu.file.settings")
              },
              { type: "separator" as const }
            ]),
        platform.isMacOS
          ? { label: t("menu.file.close"), role: "close" as const }
          : { label: t("menu.file.quit"), role: "quit" as const }
      ]
    },
    {
      label: t("menu.edit.label"),
      submenu: [
        { label: t("menu.edit.undo"), role: "undo" as const },
        { label: t("menu.edit.redo"), role: "redo" as const },
        { type: "separator" as const },
        { label: t("menu.edit.cut"), role: "cut" as const },
        { label: t("menu.edit.copy"), role: "copy" as const },
        { label: t("menu.edit.paste"), role: "paste" as const },
        { label: t("menu.edit.selectAll"), role: "selectAll" as const }
      ]
    },
    {
      label: t("menu.view.label"),
      submenu: [
        { label: t("menu.view.reload"), role: "reload" as const },
        { label: t("menu.view.reload"), role: "forceReload" as const },
        {
          label: t("menu.view.toggleDevTools"),
          role: "toggleDevTools" as const
        },
        { type: "separator" as const },
        { label: t("menu.view.actualSize"), role: "resetZoom" as const },
        { label: t("menu.view.zoomIn"), role: "zoomIn" as const },
        { label: t("menu.view.zoomOut"), role: "zoomOut" as const },
        { type: "separator" as const },
        {
          label: t("menu.view.toggleFullScreen"),
          role: "togglefullscreen" as const
        }
      ]
    },
    {
      label: t("menu.window.label"),
      submenu: [
        { label: t("menu.window.minimize"), role: "minimize" as const },
        { label: t("menu.window.zoom"), role: "zoom" as const },
        ...(platform.isMacOS
          ? [
              { type: "separator" as const },
              {
                label: t("menu.window.bringAllToFront"),
                role: "front" as const
              }
            ]
          : [{ label: t("menu.window.close"), role: "close" as const }])
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
