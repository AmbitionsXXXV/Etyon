import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

const { execFileAsyncMock, execFileMock, existsSyncMock } = vi.hoisted(() => {
  const executeFile = vi.fn()
  const executeFileAsync = vi.fn()

  Object.defineProperty(
    executeFile,
    Symbol.for("nodejs.util.promisify.custom"),
    { value: executeFileAsync }
  )

  return {
    execFileAsyncMock: executeFileAsync,
    execFileMock: executeFile,
    existsSyncMock: vi.fn()
  }
})

vi.mock("node:child_process", () => ({
  execFile: execFileMock
}))

vi.mock("node:fs", () => ({
  default: {
    existsSync: existsSyncMock
  }
}))

vi.mock("@vscode/ripgrep", () => ({
  rgPath: "/bundled/rg"
}))

const { resetRipgrepResolutionCacheForTests, resolveRipgrep } =
  await import("@/main/agents/minimal/ripgrep-binary")

const resolveSystemRipgrep = (): void => {
  execFileAsyncMock.mockResolvedValue({ stderr: "", stdout: "ripgrep 14.1.0" })
}

const rejectSystemRipgrep = (): void => {
  execFileAsyncMock.mockRejectedValue(
    Object.assign(new Error("rg not found"), { code: "ENOENT" })
  )
}

beforeEach(() => {
  execFileAsyncMock.mockReset()
  execFileMock.mockReset()
  existsSyncMock.mockReset()
  resetRipgrepResolutionCacheForTests()
})

describe("resolveRipgrep", () => {
  it("prefers the system rg executable", async () => {
    resolveSystemRipgrep()

    await expect(resolveRipgrep()).resolves.toEqual({
      command: "rg",
      source: "system"
    })
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      "rg",
      ["--version"],
      expect.objectContaining({ env: expect.any(Object) })
    )
    expect(existsSyncMock).not.toHaveBeenCalled()
  })

  it("falls back to the bundled binary when system rg is unavailable", async () => {
    rejectSystemRipgrep()
    existsSyncMock.mockReturnValue(true)

    await expect(resolveRipgrep()).resolves.toEqual({
      command: "/bundled/rg",
      source: "bundled"
    })
    expect(existsSyncMock).toHaveBeenCalledWith("/bundled/rg")
  })

  it("reports missing when neither system nor bundled rg is available", async () => {
    rejectSystemRipgrep()
    existsSyncMock.mockReturnValue(false)

    await expect(resolveRipgrep()).resolves.toEqual({
      command: null,
      source: "missing"
    })
  })
})
