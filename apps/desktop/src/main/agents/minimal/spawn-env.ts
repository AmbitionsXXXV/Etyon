import path from "node:path"

const HOMEBREW_PATH_ENTRIES = ["/opt/homebrew/bin", "/usr/local/bin"]

// Packaged Electron apps launched from the Dock inherit a bare PATH, so
// Homebrew-installed tools (git, node, rg) go missing. Dev launches already
// inherit the terminal env; prepend only the entries that are absent.
export const getShellSpawnEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env }
  const pathSegments = env.PATH ? env.PATH.split(path.delimiter) : []
  const missingEntries = HOMEBREW_PATH_ENTRIES.filter(
    (entry) => !pathSegments.includes(entry)
  )

  if (missingEntries.length > 0) {
    env.PATH = [...missingEntries, ...pathSegments].join(path.delimiter)
  }

  return env
}
