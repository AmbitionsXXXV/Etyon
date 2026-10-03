import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test"

import { createBestOfNService } from "@/main/agents/worktrees/best-of-n"
import type { BestOfNCandidateRequest } from "@/main/agents/worktrees/best-of-n"
import { createWorktreeManager } from "@/main/agents/worktrees/manager"
import type { WorktreeManager } from "@/main/agents/worktrees/manager"

let root: string
let project: string
let manager: WorktreeManager
beforeEach(async () => {
  root = await mkdtemp("/private/tmp/etyon-best-of-n-")
  project = path.join(root, "project")
  await mkdir(project)
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: project, stdio: "ignore" })
  git("init")
  git("config", "user.name", "Best of N Test")
  git("config", "user.email", "bestofn@example.com")
  git("config", "commit.gpgsign", "false")
  git("config", "core.hooksPath", "/dev/null")
  await writeFile(path.join(project, "main.txt"), "base\n")
  git("add", ".")
  git("commit", "-m", "base")
  manager = createWorktreeManager({ storageRoot: path.join(root, "managed") })
}, 60_000)
afterEach(async () => {
  await rm(root, { force: true, recursive: true })
}, 60_000)

const request = () => ({
  models: [{ modelId: "model-one" }, { modelId: "model-two" }],
  projectPath: project,
  prompt: "Implement the requested change.",
  runId: "run",
  sessionId: "session"
})

describe("Best-of-N alternatives", { timeout: 120_000 }, () => {
  it("runs candidates concurrently in independent worktrees and applies only the selected diff", async () => {
    const started: BestOfNCandidateRequest[] = []
    const bothStarted = Promise.withResolvers<boolean>()
    const service = createBestOfNService({
      manager,
      runCandidate: async (candidate) => {
        started.push(candidate)
        if (started.length === 2) {
          bothStarted.resolve(true)
        }
        await bothStarted.promise
        await writeFile(
          path.join(candidate.workspacePath, "main.txt"),
          `${candidate.modelId}\n`
        )
        return { summary: `${candidate.modelId} result` }
      },
      runReviewer: ({ candidates }) => {
        expect(candidates).toHaveLength(2)
        expect(candidates[0]?.patch).toContain("model-one")
        return Promise.resolve({
          recommendation: "First candidate meets the task.",
          recommendedCandidateId: candidates[0]?.id ?? null
        })
      }
    })
    const run = await service.start(request())
    expect(
      new Set(started.map(({ workspacePath }) => workspacePath)).size
    ).toBe(2)
    expect(await readFile(path.join(project, "main.txt"), "utf-8")).toBe(
      "base\n"
    )
    expect(run.state).toBe("ready")
    expect(run.candidates[0]?.stats).toEqual({
      additions: 1,
      changedFileCount: 1,
      deletions: 1
    })
    const [candidate] = run.candidates
    if (!candidate) {
      throw new Error("Expected a candidate.")
    }
    const preview = await service.preview(run.id, candidate.id, "session")
    const applied = await service.apply({
      candidateId: candidate.id,
      expectedFingerprint: preview.fingerprint,
      id: run.id,
      sessionId: "session"
    })
    expect(applied.ok).toBe(true)
    expect(await readFile(path.join(project, "main.txt"), "utf-8")).toBe(
      "model-one\n"
    )
    expect(await manager.list()).toHaveLength(0)
    const persisted = await service.get(run.id, "session")
    expect(persisted.state).toBe("applied")
    expect(persisted.candidates.map(({ state }) => state)).toEqual([
      "applied",
      "discarded"
    ])
  })

  it("contains a failed candidate, retains its partial changes and validates reviewer ids", async () => {
    const service = createBestOfNService({
      manager,
      runCandidate: async (candidate) => {
        await writeFile(
          path.join(candidate.workspacePath, "main.txt"),
          `${candidate.modelId}\n`
        )
        if (candidate.modelId === "model-two") {
          throw new Error("provider failed")
        }
        return { summary: "complete" }
      },
      runReviewer: () =>
        Promise.resolve({
          recommendation: "review",
          recommendedCandidateId: "not-a-candidate"
        })
    })
    const run = await service.start(request())
    expect(run.state).toBe("ready")
    expect(run.candidates[1]?.state).toBe("failed")
    expect(run.candidates[1]?.worktreeId).toBeDefined()
    expect(run.review?.recommendedCandidateId).toBeNull()
    await expect(service.get(run.id, "another-session")).rejects.toThrow(
      "does not belong"
    )
    await service.discard(run.id, "session")
    expect(await manager.list()).toHaveLength(0)
  })

  it("rejects primary edits during selection and supports safe cancellation", async () => {
    const service = createBestOfNService({
      manager,
      runCandidate: async (candidate) => {
        await writeFile(
          path.join(candidate.workspacePath, "main.txt"),
          "candidate\n"
        )
        return { summary: "candidate" }
      },
      runReviewer: () =>
        Promise.resolve({
          recommendation: "review",
          recommendedCandidateId: null
        })
    })
    const run = await service.start(request())
    const [candidate] = run.candidates
    if (!candidate) {
      throw new Error("Expected a candidate.")
    }
    const preview = await service.preview(run.id, candidate.id, "session")
    await writeFile(path.join(project, "main.txt"), "user\n")
    const applied = await service.apply({
      candidateId: candidate.id,
      expectedFingerprint: preview.fingerprint,
      id: run.id,
      sessionId: "session"
    })
    expect(applied.ok).toBe(false)
    const unapplied = await service.get(run.id, "session")
    expect(unapplied.state).toBe("ready")
    expect(await readFile(path.join(project, "main.txt"), "utf-8")).toBe(
      "user\n"
    )
    await service.discard(run.id, "session")

    const started = Promise.withResolvers<string>()
    let activeId: string | undefined
    const cancellable = createBestOfNService({
      manager,
      onUpdate: (update) => {
        activeId = update.id
      },
      runCandidate: async ({ signal }) => {
        started.resolve(activeId ?? "")
        const { promise, resolve } = Promise.withResolvers<boolean>()
        if (signal.aborted) {
          resolve(true)
        } else {
          signal.addEventListener(
            "abort",
            () => {
              resolve(true)
            },
            { once: true }
          )
        }
        await promise
        throw new Error("cancelled")
      },
      runReviewer: () =>
        Promise.reject(new Error("must not review cancelled candidates"))
    })
    const task = cancellable.start(request())
    const id = await started.promise
    const uiService = createBestOfNService({
      manager,
      runCandidate: () =>
        Promise.reject(new Error("UI must not run candidates")),
      runReviewer: () => Promise.reject(new Error("UI must not review"))
    })
    await uiService.cancel(id, "session")
    const cancelled = await task
    expect(cancelled.state).toBe("cancelled")
    expect(await manager.list()).toHaveLength(0)
  })

  it("recovers interrupted durable runs without restarting candidates", async () => {
    const storageRoot = path.join(root, "runs")
    const candidateTree = await manager.create({
      projectPath: project,
      runId: "run",
      sessionId: "session"
    })
    await writeFile(
      path.join(candidateTree.workspacePath, "main.txt"),
      "unfinished\n"
    )
    const runId = "12345678-1234-4123-8123-123456789abc"
    await mkdir(storageRoot)
    await writeFile(
      path.join(storageRoot, `${runId}.json`),
      JSON.stringify({
        candidates: [
          {
            id: "12345678-1234-4123-8123-123456789abd",
            modelId: "model",
            state: "running",
            summary: "",
            worktreeId: candidateTree.id
          }
        ],
        createdAt: new Date().toISOString(),
        id: runId,
        prompt: "task",
        review: null,
        runId: "run",
        sessionId: "session",
        state: "running"
      })
    )
    let calls = 0
    const service = createBestOfNService({
      manager,
      runCandidate: () => {
        calls += 1
        return Promise.resolve({ summary: "unexpected" })
      },
      runReviewer: () =>
        Promise.resolve({
          recommendation: "",
          recommendedCandidateId: null
        }),
      storageRoot
    })
    await manager.recover()
    await service.recover()
    expect(calls).toBe(0)
    const run = await service.get(runId, "session")
    expect(run.state).toBe("cancelled")
    expect(run.candidates[0]?.state).toBe("failed")
    const recovered = await manager.get(candidateTree.id)
    expect(recovered.state).toBe("orphaned")
  })

  it("allows only one candidate selection even when alternatives change different paths", async () => {
    const service = createBestOfNService({
      manager,
      runCandidate: async (candidate) => {
        await writeFile(
          path.join(candidate.workspacePath, `${candidate.modelId}.txt`),
          "chosen\n"
        )
        return { summary: "complete" }
      },
      runReviewer: () =>
        Promise.resolve({
          recommendation: "Compare both.",
          recommendedCandidateId: null
        })
    })
    const run = await service.start(request())
    const [first, second] = run.candidates
    if (!first || !second) {
      throw new Error("Expected two candidates.")
    }
    const [firstDiff, secondDiff] = await Promise.all([
      service.preview(run.id, first.id, "session"),
      service.preview(run.id, second.id, "session")
    ])
    const uiService = createBestOfNService({
      manager,
      runCandidate: () => Promise.reject(new Error("UI must not run")),
      runReviewer: () => Promise.reject(new Error("UI must not review"))
    })
    const results = await Promise.all([
      service.apply({
        candidateId: first.id,
        expectedFingerprint: firstDiff.fingerprint,
        id: run.id,
        sessionId: "session"
      }),
      uiService.apply({
        candidateId: second.id,
        expectedFingerprint: secondDiff.fingerprint,
        id: run.id,
        sessionId: "session"
      })
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(await readFile(path.join(project, "model-one.txt"), "utf-8")).toBe(
      "chosen\n"
    )
    await expect(
      readFile(path.join(project, "model-two.txt"))
    ).rejects.toThrow()
    const selected = await uiService.get(run.id, "session")
    expect(selected.selectedCandidateId).toBe(first.id)
    expect(selected.state).toBe("applied")
  })
})
