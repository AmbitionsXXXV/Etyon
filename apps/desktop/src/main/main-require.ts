import { createRequire } from "node:module"

/** Node-style require for the main-process bundle (ESM output). */
export const mainRequire = createRequire(import.meta.url)
