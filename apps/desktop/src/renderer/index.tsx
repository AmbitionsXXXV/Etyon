import { createRoot } from "react-dom/client"

import { App } from "./app"

import "@etyon/ui/globals.css"

const root = document.querySelector("#root")

if (root) {
  createRoot(root).render(<App />)
}
