// Run on macOS: vp exec electron script/generate-app-icons.cjs
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const { app, BrowserWindow, nativeImage } = require("electron")

const root = path.resolve(__dirname, "..")
const resources = path.join(root, "apps/desktop/resources")
const artwork = path.join(root, "doc/assets/app-icon")
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "etyon-icons-"))
const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]

app.setPath("userData", path.join(scratch, "user-data"))
app.commandLine.appendSwitch("force-device-scale-factor", "1")

const resizePng = (image, size) =>
  image.resize({ height: size, quality: "best", width: size }).toPNG()

const writeIco = (image) => {
  const frames = icoSizes.map((size) => resizePng(image, size))
  const directory = Buffer.alloc(6 + frames.length * 16)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(frames.length, 4)
  let offset = directory.length
  for (const [index, frame] of frames.entries()) {
    const entry = 6 + index * 16
    const size = icoSizes[index]
    directory[entry] = size === 256 ? 0 : size
    directory[entry + 1] = size === 256 ? 0 : size
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(frame.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += frame.length
  }
  fs.writeFileSync(
    path.join(resources, "icon.ico"),
    Buffer.concat([directory, ...frames])
  )
}

const render = async (html, width, height) => {
  const window = new BrowserWindow({
    backgroundColor: "#00000000",
    height,
    show: false,
    transparent: true,
    useContentSize: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      offscreen: true,
      sandbox: true
    },
    width
  })
  try {
    const pagePath = path.join(scratch, "render.html")
    fs.writeFileSync(pagePath, `<meta charset="utf-8">${html}`)
    await window.loadFile(pagePath)
    await window.webContents.executeJavaScript(
      "Promise.all(Array.from(document.images, image => image.decode()))"
    )
    await window.webContents.executeJavaScript(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    )
    return await window.webContents.capturePage()
  } finally {
    window.destroy()
  }
}

const dataUrl = (name) =>
  `data:image/png;base64,${fs.readFileSync(path.join(resources, name)).toString("base64")}`

const prepareDesktopIcon = (name) => {
  const source = nativeImage.createFromPath(path.join(artwork, name))
  if (source.isEmpty()) {
    throw new Error(`Missing desktop icon master: ${name}`)
  }
  // Apply a fixed app-tile silhouette at export, keeping the source artwork intact.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1280 1280">
    <defs><clipPath id="tile"><path d="M366 114H898C1070 114 1156 180 1156 366V900C1156 1076 1080 1148 904 1148H350C180 1148 100 1080 100 906V364C100 182 184 114 366 114Z"/></clipPath></defs>
    <image width="1280" height="1280" href="${source.toDataURL()}" clip-path="url(#tile)"/>
  </svg>`
  return render(
    `<style>body{margin:0}</style><img width="1024" height="1024" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`,
    1024,
    1024
  )
}

const main = async () => {
  const dark = await prepareDesktopIcon("ai-work-dark-master.png")
  const light = await prepareDesktopIcon("ai-work-light-master.png")
  fs.writeFileSync(path.join(resources, "icon-dark.png"), resizePng(dark, 1024))
  fs.writeFileSync(
    path.join(resources, "icon-light.png"),
    resizePng(light, 1024)
  )
  fs.writeFileSync(path.join(resources, "icon.png"), resizePng(dark, 512))
  writeIco(dark)

  const iconset = path.join(scratch, "icon.iconset")
  fs.mkdirSync(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const suffix = scale === 2 ? "@2x" : ""
      fs.writeFileSync(
        path.join(iconset, `icon_${size}x${size}${suffix}.png`),
        resizePng(dark, size * scale)
      )
    }
  }
  execFileSync("/usr/bin/iconutil", [
    "-c",
    "icns",
    "-o",
    path.join(resources, "icon.icns"),
    iconset
  ])

  const svg = fs.readFileSync(
    path.join(resources, "tray-template.svg"),
    "utf-8"
  )
  for (const scale of [1, 2]) {
    const size = 16 * scale
    const image = await render(
      `<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
      size,
      size
    )
    fs.writeFileSync(
      path.join(resources, `tray-template${scale === 2 ? "@2x" : ""}.png`),
      resizePng(image, size)
    )
  }

  const template = nativeImage.createFromPath(
    path.join(resources, "tray-template.png")
  )
  template.setTemplateImage(true)
  if (
    template.getSize().width !== 16 ||
    !template.getScaleFactors().includes(2)
  ) {
    throw new Error(
      "Menu bar icon must load at 16 points with a 2x representation"
    )
  }

  const iconSamples = (name) =>
    [128, 64, 32, 16]
      .map(
        (size) =>
          `<div><img src="${dataUrl(name)}" width="${size}" height="${size}"><small>${size} px</small></div>`
      )
      .join("")
  const traySamples = (invert) => `
    <div class="menubar ${invert ? "dark" : "light"}">
      <span>Menu bar</span>
      <img style="${invert ? "filter:invert(1)" : ""}" src="${dataUrl("tray-template.png")}" width="16" height="16">
      <img style="${invert ? "filter:invert(1)" : ""}" src="${dataUrl("tray-template@2x.png")}" width="16" height="16">
      <span>1x / 2x · 16 pt</span>
    </div>`
  const preview = await render(
    `
    <style>
      *{box-sizing:border-box}body{margin:0;padding:32px;font:14px system-ui;background:#eceef1;color:#20242c}
      h1{font-size:22px;margin:0 0 8px}p{margin:0 0 24px;color:#687080}
      .apps{display:flex;gap:24px}.samples{display:flex;align-items:center;gap:20px;padding:20px;background:white;border-radius:20px;flex:1}
      .samples div{text-align:center}small{display:block;margin-top:8px;color:#687080}
      .menubar{display:flex;align-items:center;gap:24px;margin-top:20px;padding:12px 20px;border-radius:10px}
      .light{background:#fafafa}.dark{background:#24262c;color:#fff}
      .detail{display:flex;align-items:center;gap:24px;margin-top:24px}.detail img{image-rendering:pixelated}
    </style>
    <h1>Etyon · AI work</h1><p>Desktop icon sizes and menu bar legibility</p>
    <div class="apps"><div class="samples">${iconSamples("icon-dark.png")}</div><div class="samples">${iconSamples("icon-light.png")}</div></div>
    ${traySamples(false)}${traySamples(true)}
    <div class="detail"><img src="${dataUrl("tray-template.png")}" width="96" height="96"><span>16 px pixel grid enlarged 6x<br>Single-color alpha mask · 1.5 px strokes</span></div>
  `,
    1000,
    570
  )
  fs.writeFileSync(path.join(artwork, "icon-preview.png"), preview.toPNG())
  process.stdout.write(
    `${JSON.stringify(
      {
        desktop: [
          "PNG 1024 / 512",
          "ICNS 16–1024",
          `ICO ${icoSizes.join(" / ")}`
        ],
        tray: {
          isTemplate: template.isTemplateImage(),
          scales: template.getScaleFactors(),
          size: template.getSize()
        }
      },
      null,
      2
    )}\n`
  )
}

const run = async () => {
  try {
    await app.whenReady()
    await main()
    app.quit()
  } catch (error) {
    process.stderr.write(`${error.stack}\n`)
    app.exit(1)
  }
}

app.on("window-all-closed", () => {
  // Keep the process alive between offscreen render windows.
})
app.on("quit", () => fs.rmSync(scratch, { force: true, recursive: true }))
void run()
