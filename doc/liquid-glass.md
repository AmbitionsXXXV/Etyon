# Liquid Glass

macOS 26 (Tahoe) 原生毛玻璃效果集成，使用 `electron-liquid-glass` 提供真实的 `NSGlassEffectView`。

## 依赖与要求

- `electron-liquid-glass@1.1.1`（production dependency）
- macOS 26+（Tahoe or later）
- Electron 30+

非 macOS 平台自动跳过，无需条件编译。

## 架构

```text
Main Process (window.ts)
  ↓ BrowserWindow({ transparent: true })
  ↓ applyLiquidGlass(win)
    ↓ setWindowButtonVisibility(true)
    ↓ webContents.once("did-finish-load")
      ↓ liquidGlass.addView(nativeHandle)
      ↓ webContents.send("liquid-glass-active")
Renderer (index.tsx)
  ↓ ipcRenderer.on("liquid-glass-active")
  ↓ document.documentElement.dataset.liquidGlass = ""
CSS (globals.css)
  ↓ :root[data-liquid-glass] body { background: transparent }
  ↓ :root[data-liquid-glass] { --background / --sidebar / --card / --popover 半透明 }
```

## Main Process 集成

### `liquid-glass.ts`

封装为 `applyLiquidGlass(win: BrowserWindow)`：

- 仅 `platform.isMacOS` 时执行
- `setWindowButtonVisibility(true)` 确保 transparent 窗口仍显示 traffic light
- `did-finish-load` 后动态 `import("electron-liquid-glass")` 并调用 `addView()`
- 出错时静默降级（macOS < 26 或 native module 不可用）

### `window.ts`

`createWindow()` 和 `createSettingsWindow()` 两处改动：

- macOS 上设置 `transparent: true`（liquid glass 必需，不可与 `vibrancy` 同时使用）
- 创建窗口后立即调用 `applyLiquidGlass(window)`

### `vite.main.config.ts`

`electron-liquid-glass` 是 native addon（包含 `.node` 二进制），必须在 Vite 构建时外置：

```ts
external: ["electron-liquid-glass", "font-list"],
```

## Renderer CSS 策略

使用 `data-liquid-glass` HTML 属性作为 CSS 条件开关，避免影响非 macOS 或低版本系统：

| 选择器                          | 作用                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `:root[data-liquid-glass] body` | `background-color: transparent`，让 glass 贯穿整个窗口                       |
| `:root[data-liquid-glass]`      | Light 模式下 `--background`、`--sidebar`、`--card`、`--popover` 使用半透明值 |
| `:root[data-liquid-glass].dark` | Dark 模式下同上变量使用半透明值                                              |

半透明值确保原生 glass 效果透过 UI 元素可见，同时保持文字可读性。

## IPC 通信

| Channel               | 方向            | 载荷   | 说明                                    |
| --------------------- | --------------- | ------ | --------------------------------------- |
| `liquid-glass-active` | Main → Renderer | `true` | Glass 已成功应用，Renderer 激活透明 CSS |

Renderer 在 `index.tsx` 启动阶段注册一次性监听器，收到后设置 `document.documentElement.dataset.liquidGlass`。

## 跨平台回退

| 平台            | 行为                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| macOS 26+       | `transparent: true` + `NSGlassEffectView` + 半透明 CSS                    |
| macOS < 26      | `transparent: true` 但 `addView()` 静默失败，窗口保持透明背景（无 glass） |
| Windows / Linux | `transparent` 不设置，`applyLiquidGlass` 直接返回，正常不透明窗口         |

## 涉及文件

- `apps/desktop/src/main/liquid-glass.ts` — `applyLiquidGlass()` 封装
- `apps/desktop/src/main/window.ts` — 窗口创建，`transparent: true` + 调用
- `apps/desktop/vite.main.config.ts` — external 配置
- `apps/desktop/src/renderer/index.tsx` — IPC 监听，设置 `data-liquid-glass`
- `packages/ui/src/styles/globals.css` — `[data-liquid-glass]` 条件 CSS 覆盖
