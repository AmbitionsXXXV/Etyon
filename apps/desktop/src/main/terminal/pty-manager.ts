import { spawn } from "@lydell/node-pty"
import type { IDisposable, IPty } from "@lydell/node-pty"

import { getShellSpawnEnv } from "@/main/agents/minimal/spawn-env"

const PTY_SNAPSHOT_MAX_CHARS = 200 * 1024

interface EnsurePtySessionInput {
  cols: number
  cwd: string
  rows: number
  sessionId: string
}

interface PtySession {
  dataSubscription: IDisposable | null
  exitSubscription: IDisposable | null
  output: string
  pty: IPty
}

type PtyDataListener = (sessionId: string, data: string) => void

const ptyDataListeners = new Set<PtyDataListener>()
const ptySessions = new Map<string, PtySession>()

const appendPtyOutput = (output: string, data: string): string => {
  const nextOutput = `${output}${data}`

  return nextOutput.length > PTY_SNAPSHOT_MAX_CHARS
    ? nextOutput.slice(-PTY_SNAPSHOT_MAX_CHARS)
    : nextOutput
}

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

// A PTY owns the shell process. Signal its Unix process group first so child
// commands cannot outlive it, then close the PTY and verify the direct process.
const killPtyProcessTree = (pty: IPty): void => {
  if (process.platform !== "win32") {
    try {
      process.kill(-pty.pid, "SIGKILL")
    } catch (error) {
      void error
    }
  }

  try {
    pty.kill(process.platform === "win32" ? undefined : "SIGKILL")
  } catch (error) {
    void error
  }

  if (process.platform === "win32" || !isProcessRunning(pty.pid)) {
    return
  }

  try {
    process.kill(pty.pid, "SIGKILL")
  } catch (error) {
    void error
  }
}

const getPtySession = (sessionId: string): PtySession => {
  const session = ptySessions.get(sessionId)

  if (!session) {
    throw new Error(`PTY session not found: ${sessionId}`)
  }

  return session
}

export const ensurePtySession = ({
  cols,
  cwd,
  rows,
  sessionId
}: EnsurePtySessionInput): { snapshot: string } => {
  const existingSession = ptySessions.get(sessionId)

  if (existingSession) {
    existingSession.pty.resize(cols, rows)
    return { snapshot: existingSession.output }
  }

  const pty = spawn(process.env.SHELL ?? "/bin/bash", ["-l"], {
    cols,
    cwd,
    env: getShellSpawnEnv(),
    rows
  })
  const session: PtySession = {
    dataSubscription: null,
    exitSubscription: null,
    output: "",
    pty
  }

  ptySessions.set(sessionId, session)
  session.dataSubscription = pty.onData((data) => {
    session.output = appendPtyOutput(session.output, data)

    for (const listener of ptyDataListeners) {
      listener(sessionId, data)
    }
  })
  session.exitSubscription = pty.onExit(() => {
    if (ptySessions.get(sessionId) === session) {
      ptySessions.delete(sessionId)
    }

    session.dataSubscription?.dispose()
    session.exitSubscription?.dispose()
  })

  return { snapshot: session.output }
}

export const writeToPty = (sessionId: string, data: string): void => {
  getPtySession(sessionId).pty.write(data)
}

export const resizePty = (
  sessionId: string,
  cols: number,
  rows: number
): void => {
  getPtySession(sessionId).pty.resize(cols, rows)
}

export const disposePty = (sessionId: string): void => {
  const session = ptySessions.get(sessionId)

  if (!session) {
    return
  }

  ptySessions.delete(sessionId)
  session.dataSubscription?.dispose()
  session.exitSubscription?.dispose()
  killPtyProcessTree(session.pty)
}

export const disposeAllPtys = (): void => {
  for (const sessionId of ptySessions.keys()) {
    disposePty(sessionId)
  }
}

export const subscribePtyData = (listener: PtyDataListener): (() => void) => {
  ptyDataListeners.add(listener)

  return () => {
    ptyDataListeners.delete(listener)
  }
}
