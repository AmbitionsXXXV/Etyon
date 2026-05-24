import fs from "node:fs"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"

import {
  AGENT_TOOL_OUTPUT_MAX_CHARS,
  createAgentExecutionEnv
} from "@/main/agents/execution-env"
import type { AgentShellOutputEvent } from "@/main/agents/execution-env"

const testProjectPath = `/tmp/etyon-agent-execution-env-test-${Date.now()}`

describe("agent execution env", () => {
  beforeAll(() => {
    fs.mkdirSync(testProjectPath, { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(testProjectPath, { force: true, recursive: true })
  })

  it("normalizes command cwd inside the project root", () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })

    expect(env.resolveCwd("")).toBe(testProjectPath)
    expect(env.resolveCwd("src")).toBe(path.join(testProjectPath, "src"))
    expect(() => env.resolveCwd("../outside")).toThrow("outside project")
  })

  it("rejects command cwd symlinks that resolve outside the project root", () => {
    const outsidePath = `${testProjectPath}-outside`

    fs.mkdirSync(outsidePath, { recursive: true })
    fs.symlinkSync(outsidePath, path.join(testProjectPath, "outside-link"))

    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })

    expect(() => env.resolveCwd("outside-link")).toThrow("outside project")

    fs.rmSync(outsidePath, { force: true, recursive: true })
  })

  it("returns Result values from file system reads instead of throwing", async () => {
    fs.mkdirSync(path.join(testProjectPath, "src"), { recursive: true })
    fs.writeFileSync(path.join(testProjectPath, "src/result.txt"), "hello\n")

    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })

    await expect(
      env.fileSystem.readTextFile("src/result.txt")
    ).resolves.toEqual({
      ok: true,
      value: "hello\n"
    })
    await expect(env.fileSystem.readTextFile("missing.txt")).resolves.toEqual({
      error: {
        code: "not-found",
        message: "File does not exist.",
        path: "missing.txt"
      },
      ok: false
    })
    await expect(
      env.fileSystem.readTextFile("../outside.txt")
    ).resolves.toEqual({
      error: {
        code: "outside-project",
        message: "Path is outside project root.",
        path: "../outside.txt"
      },
      ok: false
    })
  })

  it("returns Result metadata and directory listings without following symlinks", async () => {
    const outsideFilePath = `${testProjectPath}-outside-file-system.ts`

    fs.mkdirSync(path.join(testProjectPath, "src/fs-dir"), { recursive: true })
    fs.writeFileSync(path.join(testProjectPath, "src/fs-dir/file.ts"), "x\n")
    fs.writeFileSync(outsideFilePath, "outside\n")
    fs.symlinkSync(
      outsideFilePath,
      path.join(testProjectPath, "src/fs-dir/outside-link.ts")
    )

    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const fileInfo = await env.fileSystem.fileInfo("src/fs-dir/file.ts")
    const linkInfo = await env.fileSystem.fileInfo("src/fs-dir/outside-link.ts")
    const listed = await env.fileSystem.listDir("src/fs-dir")

    expect(fileInfo).toMatchObject({
      ok: true,
      value: {
        isSymlink: false,
        kind: "file",
        path: "src/fs-dir/file.ts",
        size: 2
      }
    })
    expect(linkInfo).toMatchObject({
      ok: true,
      value: {
        isSymlink: true,
        kind: "symlink",
        path: "src/fs-dir/outside-link.ts"
      }
    })
    expect(listed).toMatchObject({
      ok: true,
      value: [
        {
          isSymlink: false,
          kind: "file",
          path: "src/fs-dir/file.ts",
          size: 2
        },
        {
          isSymlink: true,
          kind: "symlink",
          path: "src/fs-dir/outside-link.ts"
        }
      ]
    })

    fs.rmSync(outsideFilePath, { force: true })
  })

  it("rejects file system operations through symlinked ancestors outside the project", async () => {
    const outsideDirectoryPath = `${testProjectPath}-outside-file-system-dir`

    fs.mkdirSync(outsideDirectoryPath, { recursive: true })
    fs.mkdirSync(path.join(testProjectPath, "src"), { recursive: true })
    fs.writeFileSync(path.join(outsideDirectoryPath, "secret.txt"), "secret\n")
    fs.symlinkSync(
      outsideDirectoryPath,
      path.join(testProjectPath, "src/outside-parent-link")
    )

    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const outsideProjectError = {
      error: {
        code: "outside-project",
        message: "Path is outside project root.",
        path: "src/outside-parent-link/secret.txt"
      },
      ok: false
    }

    await expect(
      env.fileSystem.readTextFile("src/outside-parent-link/secret.txt")
    ).resolves.toEqual(outsideProjectError)
    await expect(
      env.fileSystem.exists("src/outside-parent-link/secret.txt")
    ).resolves.toEqual(outsideProjectError)
    await expect(
      env.fileSystem.writeFile("src/outside-parent-link/new.txt", "new\n")
    ).resolves.toEqual({
      error: {
        code: "outside-project",
        message: "Path is outside project root.",
        path: "src/outside-parent-link/new.txt"
      },
      ok: false
    })
    await expect(
      env.fileSystem.remove("src/outside-parent-link/secret.txt")
    ).resolves.toEqual(outsideProjectError)
    expect(fs.existsSync(path.join(outsideDirectoryPath, "secret.txt"))).toBe(
      true
    )
    expect(fs.existsSync(path.join(outsideDirectoryPath, "new.txt"))).toBe(
      false
    )

    fs.rmSync(outsideDirectoryPath, { force: true, recursive: true })
  })

  it("returns Result values from file system path helpers and existence checks", async () => {
    const outsideFilePath = `${testProjectPath}-outside-canonical.txt`

    fs.mkdirSync(path.join(testProjectPath, "src"), { recursive: true })
    fs.writeFileSync(path.join(testProjectPath, "src/canonical.txt"), "ok\n")
    fs.writeFileSync(outsideFilePath, "outside\n")
    fs.symlinkSync(
      path.join(testProjectPath, "src/canonical.txt"),
      path.join(testProjectPath, "src/canonical-link.txt")
    )
    fs.symlinkSync(
      outsideFilePath,
      path.join(testProjectPath, "src/outside-canonical-link.txt")
    )

    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })

    await expect(
      env.fileSystem.absolutePath("src/canonical.txt")
    ).resolves.toEqual({
      ok: true,
      value: path.join(testProjectPath, "src/canonical.txt")
    })
    await expect(env.fileSystem.exists("src/canonical.txt")).resolves.toEqual({
      ok: true,
      value: true
    })
    await expect(env.fileSystem.exists("missing.txt")).resolves.toEqual({
      ok: true,
      value: false
    })
    await expect(env.fileSystem.exists("../outside.txt")).resolves.toEqual({
      error: {
        code: "outside-project",
        message: "Path is outside project root.",
        path: "../outside.txt"
      },
      ok: false
    })
    await expect(
      env.fileSystem.canonicalPath("src/canonical-link.txt")
    ).resolves.toEqual({
      ok: true,
      value: "src/canonical.txt"
    })
    await expect(
      env.fileSystem.canonicalPath("src/outside-canonical-link.txt")
    ).resolves.toEqual({
      error: {
        code: "outside-project",
        message: "Path is outside project root.",
        path: "src/outside-canonical-link.txt"
      },
      ok: false
    })

    fs.rmSync(outsideFilePath, { force: true })
  })

  it("returns Result values from file writes, appends, line reads, binary reads, and removals", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })

    await expect(
      env.fileSystem.createDir("src/result-write", { recursive: true })
    ).resolves.toEqual({
      ok: true,
      value: undefined
    })
    await expect(
      env.fileSystem.writeFile("src/result-write/data.txt", "one\ntwo\nthree\n")
    ).resolves.toEqual({
      ok: true,
      value: undefined
    })
    await expect(
      env.fileSystem.appendFile("src/result-write/data.txt", "four\n")
    ).resolves.toEqual({
      ok: true,
      value: undefined
    })
    await expect(
      env.fileSystem.readTextLines("src/result-write/data.txt", {
        maxLines: 2
      })
    ).resolves.toEqual({
      ok: true,
      value: ["one", "two"]
    })

    const binaryResult = await env.fileSystem.readBinaryFile(
      "src/result-write/data.txt"
    )

    expect(binaryResult.ok).toBe(true)

    if (!binaryResult.ok) {
      throw new Error("Expected binary read to succeed.")
    }

    expect([...binaryResult.value.subarray(0, 3)]).toEqual([111, 110, 101])
    await expect(
      env.fileSystem.remove("src/result-write/data.txt")
    ).resolves.toEqual({
      ok: true,
      value: undefined
    })
    await expect(
      env.fileSystem.exists("src/result-write/data.txt")
    ).resolves.toEqual({
      ok: true,
      value: false
    })
  })

  it("returns an aborted Result before starting file system work", async () => {
    const abortController = new AbortController()
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })

    abortController.abort()

    await expect(
      env.fileSystem.writeFile(
        "src/aborted-write.txt",
        "not written",
        abortController.signal
      )
    ).resolves.toEqual({
      error: {
        code: "aborted",
        message: "File operation aborted.",
        path: "src/aborted-write.txt"
      },
      ok: false
    })
    expect(
      fs.existsSync(path.join(testProjectPath, "src/aborted-write.txt"))
    ).toBe(false)
  })

  it("creates temporary files and directories inside the project and cleans them up", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })

    const tempDir = await env.fileSystem.createTempDir("scratch-")
    const tempFile = await env.fileSystem.createTempFile({
      prefix: "note-",
      suffix: ".txt"
    })

    expect(tempDir.ok).toBe(true)
    expect(tempFile.ok).toBe(true)

    if (!tempDir.ok || !tempFile.ok) {
      throw new Error("Expected temp paths to be created.")
    }

    expect(tempDir.value.startsWith(".etyon-agent-tmp/")).toBe(true)
    expect(tempFile.value.startsWith(".etyon-agent-tmp/")).toBe(true)
    await expect(
      env.fileSystem.writeFile(tempFile.value, "temp\n")
    ).resolves.toEqual({
      ok: true,
      value: undefined
    })
    await expect(env.fileSystem.readTextFile(tempFile.value)).resolves.toEqual({
      ok: true,
      value: "temp\n"
    })
    await expect(
      env.fileSystem.writeFile(`${tempDir.value}/child.txt`, "child\n")
    ).resolves.toEqual({
      ok: true,
      value: undefined
    })

    await expect(env.fileSystem.cleanup()).resolves.toBeUndefined()
    await expect(env.fileSystem.exists(tempDir.value)).resolves.toEqual({
      ok: true,
      value: false
    })
    await expect(env.fileSystem.exists(tempFile.value)).resolves.toEqual({
      ok: true,
      value: false
    })
    await expect(env.fileSystem.cleanup()).resolves.toBeUndefined()
  })

  it("captures bounded stdout and stderr previews", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const result = await env.runShellCommand({
      command:
        "node -e \"process.stdout.write('x'.repeat(12064)); process.stderr.write('y'.repeat(12064))\"",
      cwd: "",
      timeoutMs: 10_000
    })

    expect(result).toMatchObject({
      exitCode: 0,
      status: "success",
      truncated: true
    })
    expect(result.stdoutPreview).toHaveLength(AGENT_TOOL_OUTPUT_MAX_CHARS)
    expect(result.stderrPreview).toHaveLength(AGENT_TOOL_OUTPUT_MAX_CHARS)
  })

  it("sanitizes binary command output before previewing or storing it", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const result = await env.runShellCommand({
      command:
        'node -e "process.stdout.write(Buffer.from([0, 255, 65])); process.stderr.write(Buffer.from([1, 254, 66]))"',
      cwd: "",
      timeoutMs: 10_000
    })

    expect(result).toMatchObject({
      exitCode: 0,
      status: "success"
    })
    expect(result.stdoutPreview).toBe("[binary]A")
    expect(result.stderrPreview).toContain("[binary]B")
    expect(result.stderrPreview).not.toContain("\u0001")
    expect(result.stderrPreview).not.toContain("\uFFFD")
  })

  it("preserves utf-8 characters split across stdout chunks", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const result = await env.runShellCommand({
      command:
        'node -e "process.stdout.write(Buffer.from([0xe4,0xbd])); setTimeout(() => process.stdout.write(Buffer.from([0xa0])), 20)"',
      cwd: "",
      timeoutMs: 10_000
    })

    expect(result).toMatchObject({
      exitCode: 0,
      status: "success"
    })
    expect(result.stdoutPreview).toBe("你")
  })

  it("writes a full output artifact when command previews are truncated", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const result = await env.runShellCommand({
      command:
        "node -e \"process.stdout.write('out'.repeat(10000)); process.stderr.write('err'.repeat(10000))\"",
      cwd: "",
      timeoutMs: 10_000
    })

    expect(result.outputRef).toEqual(
      expect.objectContaining({
        kind: "command-output"
      })
    )

    if (!result.outputRef) {
      throw new Error("Expected command output artifact ref.")
    }

    const artifact = JSON.parse(
      fs.readFileSync(result.outputRef.path, "utf-8")
    ) as {
      stderr: string
      summary: {
        stderr: {
          content: string
          omittedChars: number
          totalChars: number
          truncated: boolean
        }
        stdout: {
          content: string
          omittedChars: number
          totalChars: number
          truncated: boolean
        }
      }
      stdout: string
    }

    const expectedStderrContent = [...artifact.stderr]
      .slice(0, AGENT_TOOL_OUTPUT_MAX_CHARS)
      .join("")
    const expectedStdoutContent = [...artifact.stdout]
      .slice(0, AGENT_TOOL_OUTPUT_MAX_CHARS)
      .join("")
    const stderrChars = [...artifact.stderr].length
    const stdoutChars = [...artifact.stdout].length

    expect(artifact.stdout).toBe("out".repeat(10_000))
    expect(artifact.stderr).toContain("err".repeat(10_000))
    expect(artifact.summary.stdout).toEqual({
      content: expectedStdoutContent,
      omittedChars: stdoutChars - AGENT_TOOL_OUTPUT_MAX_CHARS,
      totalChars: stdoutChars,
      truncated: true
    })
    expect(artifact.summary.stderr).toEqual({
      content: expectedStderrContent,
      omittedChars: stderrChars - AGENT_TOOL_OUTPUT_MAX_CHARS,
      totalChars: stderrChars,
      truncated: true
    })
  })

  it("returns shell Result output without treating non-zero exit codes as execution errors", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })

    await expect(
      env.shell.exec("printf out; printf err >&2; exit 7", {
        cwd: "",
        timeout: 10_000
      })
    ).resolves.toEqual({
      ok: true,
      value: {
        exitCode: 7,
        stderr: "err",
        stdout: "out"
      }
    })
  })

  it("emits structured shell output events", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const outputEvents: AgentShellOutputEvent[] = []
    const result = await env.shell.exec(
      "node -e \"process.stdout.write('out'); process.stderr.write('err')\"",
      {
        cwd: "",
        onOutput: (event) => {
          outputEvents.push(event)
        },
        timeout: 10_000
      }
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        stderr: "err",
        stdout: "out"
      }
    })
    expect(outputEvents.map((event) => event.sequence)).toEqual(
      outputEvents.map((_, index) => index)
    )
    expect(
      outputEvents.map(({ channel, chunk }) => ({
        channel,
        chunk
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          channel: "stderr",
          chunk: "err"
        },
        {
          channel: "stdout",
          chunk: "out"
        }
      ])
    )
  })

  it("returns typed shell Result errors for pre-aborted and timed-out commands", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const abortController = new AbortController()

    abortController.abort()

    await expect(
      env.shell.exec("printf skipped", {
        abortSignal: abortController.signal,
        cwd: "",
        timeout: 10_000
      })
    ).resolves.toEqual({
      error: {
        code: "aborted",
        message: "Command aborted."
      },
      ok: false
    })
    await expect(
      env.shell.exec("sleep 5", {
        cwd: "",
        timeout: 50
      })
    ).resolves.toEqual({
      error: {
        code: "timeout",
        message: "Command timed out."
      },
      ok: false
    })
  })

  it("kills a running command when aborted", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const abortController = new AbortController()
    const resultPromise = env.runShellCommand({
      abortSignal: abortController.signal,
      command: "sleep 5",
      cwd: "",
      timeoutMs: 10_000
    })

    abortController.abort()

    await expect(resultPromise).resolves.toMatchObject({
      status: "failed",
      stderrPreview: expect.stringContaining("Command aborted.")
    })
  })

  it("force kills commands that ignore termination after timeout", async () => {
    const env = createAgentExecutionEnv({
      projectPath: testProjectPath
    })
    const startedAt = Date.now()
    const result = await env.runShellCommand({
      command:
        "node -e \"process.on('SIGTERM', () => {}); setTimeout(() => process.exit(42), 1200)\"",
      cwd: "",
      timeoutMs: 50
    })

    expect(result).toMatchObject({
      status: "failed",
      stderrPreview: expect.stringContaining("Command timed out.")
    })
    expect(Date.now() - startedAt).toBeLessThan(1000)
  })
})
