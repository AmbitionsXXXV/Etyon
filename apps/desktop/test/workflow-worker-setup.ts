import path from "node:path"

import { build } from "vite-plus"

const setupWorkflowWorker = async (): Promise<void> => {
  const root = path.resolve(import.meta.dirname, "..")
  await build({
    configFile: path.join(root, "vite.workflow.config.ts"),
    logLevel: "error",
    root
  })
}

export default setupWorkflowWorker
