import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const MAX_FILE_BYTES = 5 * 1024 * 1024

export interface WorktreeFileSnapshot {
  content?: Buffer
  fingerprint: string
  kind: "file" | "missing" | "unsafe"
  mode?: number
  path: string
}

export const hashWorktreeValue = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex")

export const isSafeWorktreePath = (relativePath: string): boolean => {
  const segments = relativePath.split(/[\\/]/u)
  return (
    relativePath.length > 0 &&
    !path.isAbsolute(relativePath) &&
    !relativePath.includes("\0") &&
    segments.every(
      (part) =>
        part.length > 0 &&
        part !== "." &&
        part !== ".." &&
        part.toLowerCase() !== ".git"
    )
  )
}

export const snapshotWorktreeFile = async (
  root: string,
  relativePath: string
): Promise<WorktreeFileSnapshot> => {
  if (!isSafeWorktreePath(relativePath)) {
    throw new Error(`Unsafe patch path: ${relativePath}`)
  }
  const segments = relativePath.split("/")
  let current = root
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment)
    try {
      const info = await lstat(current)
      const isTarget = index === segments.length - 1
      if (
        info.isSymbolicLink() ||
        (!isTarget && !info.isDirectory()) ||
        (isTarget && !info.isFile())
      ) {
        return { fingerprint: "unsafe", kind: "unsafe", path: relativePath }
      }
      if (isTarget) {
        if (info.size > MAX_FILE_BYTES) {
          throw new Error(`File exceeds 5 MiB: ${relativePath}`)
        }
        const content = await readFile(current)
        return {
          content,
          fingerprint: hashWorktreeValue(
            `${hashWorktreeValue(content)}:${info.mode}:${info.mtimeMs}`
          ),
          kind: "file",
          mode: info.mode % 0o1000,
          path: relativePath
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return { fingerprint: "missing", kind: "missing", path: relativePath }
      }
      throw error
    }
  }
  throw new Error(`Cannot snapshot ${relativePath}.`)
}

export const saveWorktreeSnapshots = async (
  directory: string,
  files: WorktreeFileSnapshot[]
): Promise<void> => {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const records: {
    blob?: string
    fingerprint: string
    kind: WorktreeFileSnapshot["kind"]
    mode?: number
    path: string
  }[] = []
  for (const file of files) {
    const blob = file.content ? hashWorktreeValue(file.path) : undefined
    if (blob && file.content) {
      await writeFile(path.join(directory, blob), file.content, { mode: 0o600 })
    }
    records.push({
      blob,
      fingerprint: file.fingerprint,
      kind: file.kind,
      mode: file.mode,
      path: file.path
    })
  }
  await writeFile(
    path.join(directory, "snapshot.json"),
    JSON.stringify(records),
    { mode: 0o600 }
  )
}
