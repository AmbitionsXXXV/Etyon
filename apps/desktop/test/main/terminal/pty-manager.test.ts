import os from "node:os"

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it
} from "vite-plus/test"

import {
  disposeAllPtys,
  disposePty,
  ensurePtySession,
  resizePty,
  subscribePtyData,
  writeToPty
} from "@/main/terminal/pty-manager"

const PTY_SNAPSHOT_MAX_CHARS = 200 * 1024
const TEST_TIMEOUT_MS = 5000
const originalShell = process.env.SHELL

const toShellHexEscapes = (value: string): string => {
  let escaped = ""

  for (const byte of Buffer.from(value)) {
    escaped += `\\x${byte.toString(16).padStart(2, "0")}`
  }

  return escaped
}

const ensureTestPty = (sessionId: string) =>
  ensurePtySession({
    cols: 80,
    cwd: os.tmpdir(),
    rows: 24,
    sessionId
  })

const waitForPtyOutput = (
  sessionId: string,
  action: () => void,
  predicate: (output: string) => boolean
): Promise<string> => {
  const { promise, reject, resolve } = Promise.withResolvers<string>()
  let output = ""
  const timeout = setTimeout(() => {
    unsubscribe()
    reject(new Error(`Timed out waiting for PTY output: ${sessionId}`))
  }, TEST_TIMEOUT_MS)
  const unsubscribe = subscribePtyData((eventSessionId, data) => {
    if (eventSessionId !== sessionId) {
      return
    }

    output += data

    if (!predicate(output)) {
      return
    }

    clearTimeout(timeout)
    unsubscribe()
    resolve(output)
  })

  try {
    action()
  } catch (error) {
    clearTimeout(timeout)
    unsubscribe()
    reject(error)
  }

  return promise
}

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

const waitForProcessExit = (pid: number): Promise<void> => {
  const { promise, reject, resolve } = Promise.withResolvers<undefined>()
  const deadline = Date.now() + TEST_TIMEOUT_MS

  const poll = (): void => {
    if (!isProcessRunning(pid)) {
      resolve()
      return
    }

    if (Date.now() >= deadline) {
      reject(new Error(`PTY process did not exit: ${pid}`))
      return
    }

    setImmediate(poll)
  }

  poll()
  return promise
}

beforeAll(() => {
  process.env.SHELL = "/bin/bash"
})

afterEach(() => {
  disposeAllPtys()
})

afterAll(() => {
  if (originalShell === undefined) {
    delete process.env.SHELL
    return
  }

  process.env.SHELL = originalShell
})

describe("pty manager", () => {
  it("roundtrips written input through tagged PTY data", async () => {
    const sessionId = "roundtrip"
    const marker = "__ETYON_PTY_ROUNDTRIP__"
    const escapedMarker = toShellHexEscapes(marker)

    ensureTestPty(sessionId)
    const output = await waitForPtyOutput(
      sessionId,
      () => writeToPty(sessionId, `printf '${escapedMarker}'\r`),
      (data) => data.includes(marker)
    )

    expect(output).toContain(marker)
  })

  it("resizes an active PTY without throwing", () => {
    const sessionId = "resize"

    ensureTestPty(sessionId)

    expect(() => resizePty(sessionId, 120, 40)).not.toThrow()
  })

  it("keeps two sessions isolated and tags data with the right session id", async () => {
    const firstSessionId = "isolation-first"
    const secondSessionId = "isolation-second"
    const firstMarker = "__ETYON_PTY_FIRST__"
    const secondMarker = "__ETYON_PTY_SECOND__"
    const firstEscapedMarker = toShellHexEscapes(firstMarker)
    const secondEscapedMarker = toShellHexEscapes(secondMarker)
    const taggedData: { data: string; sessionId: string }[] = []
    const unsubscribe = subscribePtyData((sessionId, data) => {
      taggedData.push({ data, sessionId })
    })

    ensureTestPty(firstSessionId)
    ensureTestPty(secondSessionId)

    await Promise.all([
      waitForPtyOutput(
        firstSessionId,
        () => writeToPty(firstSessionId, `printf '${firstEscapedMarker}'\r`),
        (data) => data.includes(firstMarker)
      ),
      waitForPtyOutput(
        secondSessionId,
        () => writeToPty(secondSessionId, `printf '${secondEscapedMarker}'\r`),
        (data) => data.includes(secondMarker)
      )
    ])
    unsubscribe()

    const firstTaggedOutput = taggedData
      .filter(({ sessionId }) => sessionId === firstSessionId)
      .map(({ data }) => data)
      .join("")
    const secondTaggedOutput = taggedData
      .filter(({ sessionId }) => sessionId === secondSessionId)
      .map(({ data }) => data)
      .join("")

    expect(firstTaggedOutput).toContain(firstMarker)
    expect(firstTaggedOutput).not.toContain(secondMarker)
    expect(secondTaggedOutput).toContain(secondMarker)
    expect(secondTaggedOutput).not.toContain(firstMarker)
  })

  it("kills the PTY process when disposed", async () => {
    const sessionId = "dispose"
    const pidPrefix = "__ETYON_PTY_PID__"
    const pidSuffix = "__"

    ensureTestPty(sessionId)
    const output = await waitForPtyOutput(
      sessionId,
      () => writeToPty(sessionId, `printf '${pidPrefix}%s${pidSuffix}' "$$"\r`),
      (data) => /__ETYON_PTY_PID__\d+__/u.test(data)
    )
    const pidMatch = output.match(/__ETYON_PTY_PID__(\d+)__/u)

    expect(pidMatch).not.toBeNull()

    if (!pidMatch) {
      throw new Error("PTY did not report its process id")
    }

    const pid = Number(pidMatch[1])

    expect(isProcessRunning(pid)).toBe(true)

    disposePty(sessionId)
    await waitForProcessExit(pid)

    expect(isProcessRunning(pid)).toBe(false)
  })

  it("truncates the replay snapshot to the recent ring-buffer limit", async () => {
    const sessionId = "ring-buffer"
    const startMarker = "__ETYON_PTY_RING_START__"
    const endMarker = "__ETYON_PTY_RING_END__"
    const escapedStartMarker = toShellHexEscapes(startMarker)
    const escapedEndMarker = toShellHexEscapes(endMarker)
    const outputChars = PTY_SNAPSHOT_MAX_CHARS + 16_384

    ensureTestPty(sessionId)
    await waitForPtyOutput(
      sessionId,
      () =>
        writeToPty(
          sessionId,
          `printf '${escapedStartMarker}'; head -c ${outputChars} /dev/zero | tr '\\0' x; printf '${escapedEndMarker}'\r`
        ),
      (data) => data.includes(endMarker)
    )

    const { snapshot } = ensureTestPty(sessionId)

    expect(snapshot.length).toBeLessThanOrEqual(PTY_SNAPSHOT_MAX_CHARS)
    expect(snapshot).not.toContain(startMarker)
    expect(snapshot).toContain(endMarker)
  })

  it("reuses the same PTY when ensure is called twice", async () => {
    const sessionId = "idempotent"
    const value = "etyon-idempotent-value"
    const setMarker = "__ETYON_PTY_VALUE_SET__"
    const escapedSetMarker = toShellHexEscapes(setMarker)

    ensureTestPty(sessionId)
    await waitForPtyOutput(
      sessionId,
      () =>
        writeToPty(
          sessionId,
          `export ETYON_PTY_TEST_VALUE='${value}'; printf '${escapedSetMarker}'\r`
        ),
      (data) => data.includes(setMarker)
    )

    const { snapshot } = ensurePtySession({
      cols: 100,
      cwd: "/",
      rows: 30,
      sessionId
    })
    const output = await waitForPtyOutput(
      sessionId,
      () => writeToPty(sessionId, 'printf "$ETYON_PTY_TEST_VALUE"\r'),
      (data) => data.includes(value)
    )

    expect(snapshot).toContain(setMarker)
    expect(output).toContain(value)
  })
})
