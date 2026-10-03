import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  BestOfNRunSchema,
  StartBestOfNInputSchema
} from "@etyon/rpc/schemas/worktrees"
import type {
  ApplyWorktreeOutput,
  BestOfNCandidate,
  BestOfNReview,
  BestOfNRun,
  WorktreeDiff
} from "@etyon/rpc/schemas/worktrees"

import type { WorktreeManager } from "@/main/agents/worktrees/manager"

const MAX_SUMMARY_CHARS = 8000
const MAX_REVIEW_PATCH_CHARS = 32_000

interface BestOfNRegistry {
  actions: Map<string, Promise<boolean>>
  controllers: Map<string, AbortController>
  saves: Map<string, Promise<boolean>>
}
const registries = new Map<string, BestOfNRegistry>()
const getRegistry = (storageRoot: string): BestOfNRegistry => {
  const key = path.resolve(storageRoot)
  const existing = registries.get(key)
  if (existing) {
    return existing
  }
  const registry: BestOfNRegistry = {
    actions: new Map(),
    controllers: new Map(),
    saves: new Map()
  }
  registries.set(key, registry)
  return registry
}

const getCandidate = (
  run: BestOfNRun,
  candidateId: string
): { candidate: BestOfNCandidate; worktreeId: string } => {
  const candidate = run.candidates.find(({ id }) => id === candidateId)
  if (!candidate?.worktreeId) {
    throw new Error("Candidate has no retained worktree.")
  }
  return { candidate, worktreeId: candidate.worktreeId }
}

export interface BestOfNCandidateRequest {
  candidateId: string
  modelId: string
  profileId?: string
  prompt: string
  runId: string
  sessionId: string
  signal: AbortSignal
  workspacePath: string
}
export interface BestOfNReviewerRequest {
  candidates: {
    additions: number
    deletions: number
    id: string
    modelId: string
    patch: string
    paths: string[]
    summary: string
    truncated: boolean
    worktreeId?: string
  }[]
  prompt: string
  runId: string
  sessionId: string
  signal: AbortSignal
}

export interface BestOfNService {
  apply: (options: {
    candidateId: string
    expectedFingerprint: string
    id: string
    sessionId: string
  }) => Promise<ApplyWorktreeOutput>
  cancel: (id: string, sessionId: string) => Promise<BestOfNRun>
  discard: (id: string, sessionId: string) => Promise<void>
  get: (id: string, sessionId: string) => Promise<BestOfNRun>
  list: (sessionId: string) => Promise<BestOfNRun[]>
  preview: (
    id: string,
    candidateId: string,
    sessionId: string
  ) => Promise<WorktreeDiff>
  recover: () => Promise<void>
  start: (options: {
    models: { modelId: string; profileId?: string }[]
    projectPath: string
    prompt: string
    runId: string
    sessionId: string
    signal?: AbortSignal
  }) => Promise<BestOfNRun>
}

export const createBestOfNService = ({
  manager,
  onUpdate,
  runCandidate,
  runReviewer,
  storageRoot = path.join(manager.storageRoot, ".best-of-n")
}: {
  manager: WorktreeManager
  onUpdate?: (run: BestOfNRun) => void | Promise<void>
  runCandidate: (
    request: BestOfNCandidateRequest
  ) => Promise<{ summary: string }>
  runReviewer: (request: BestOfNReviewerRequest) => Promise<BestOfNReview>
  storageRoot?: string
}): BestOfNService => {
  const { actions, controllers, saves: saveQueues } = getRegistry(storageRoot)
  const withRunAction = async <T>(
    id: string,
    action: () => Promise<T>
  ): Promise<T> => {
    const previous = actions.get(id) ?? Promise.resolve(true)
    const { promise, resolve } = Promise.withResolvers<boolean>()
    actions.set(id, promise)
    await previous
    try {
      return await action()
    } finally {
      resolve(true)
      if (actions.get(id) === promise) {
        actions.delete(id)
      }
    }
  }
  const filePath = (id: string): string => {
    if (!/^[\da-f-]{36}$/iu.test(id)) {
      throw new Error("Invalid Best-of-N run identifier.")
    }
    return path.join(storageRoot, `${id}.json`)
  }
  const save = async (run: BestOfNRun): Promise<void> => {
    const prior = saveQueues.get(run.id) ?? Promise.resolve(true)
    const { promise, resolve } = Promise.withResolvers<boolean>()
    saveQueues.set(run.id, promise)
    await prior
    try {
      await mkdir(storageRoot, { recursive: true, mode: 0o700 })
      const temporary = `${filePath(run.id)}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(run), { mode: 0o600 })
      await rename(temporary, filePath(run.id))
      await onUpdate?.(BestOfNRunSchema.parse(run))
    } finally {
      resolve(true)
      if (saveQueues.get(run.id) === promise) {
        saveQueues.delete(run.id)
      }
    }
  }
  const get = async (id: string, sessionId: string): Promise<BestOfNRun> => {
    const run = BestOfNRunSchema.parse(
      JSON.parse(await readFile(filePath(id), "utf-8"))
    )
    if (run.id !== id || run.sessionId !== sessionId) {
      throw new Error("Best-of-N run does not belong to this session.")
    }
    return run
  }
  const allRuns = async (): Promise<BestOfNRun[]> => {
    let files: string[]
    try {
      files = await readdir(storageRoot)
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return []
      }
      throw error
    }
    const runs: BestOfNRun[] = []
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue
      }
      try {
        runs.push(
          BestOfNRunSchema.parse(
            JSON.parse(await readFile(path.join(storageRoot, file), "utf-8"))
          )
        )
      } catch {
        /* Preserve corrupt records for manual inspection. */
      }
    }
    return runs
  }
  const list = async (sessionId: string): Promise<BestOfNRun[]> => {
    const runs = await allRuns()
    return runs
      .filter((run) => run.sessionId === sessionId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
  }
  const preview = async (
    id: string,
    candidateId: string,
    sessionId: string
  ): Promise<WorktreeDiff> => {
    const { worktreeId } = getCandidate(await get(id, sessionId), candidateId)
    return await manager.preview(worktreeId, sessionId)
  }
  const executeCandidate = async (
    candidate: BestOfNCandidate,
    run: BestOfNRun,
    projectPath: string,
    signal: AbortSignal,
    existingWorkspacePath?: string
  ): Promise<void> => {
    let workspacePath = existingWorkspacePath
    try {
      if (signal.aborted) {
        throw new Error("Candidate was cancelled.")
      }
      if (!workspacePath) {
        const tree = await manager.create({
          label: candidate.modelId,
          projectPath,
          runId: run.runId,
          sessionId: run.sessionId,
          signal
        })
        candidate.worktreeId = tree.id
        const { workspacePath: candidateWorkspacePath } = tree
        workspacePath = candidateWorkspacePath
      }
      candidate.state = "running"
      await save(run)
      const output = await runCandidate({
        candidateId: candidate.id,
        modelId: candidate.modelId,
        profileId: candidate.profileId,
        prompt: run.prompt,
        runId: run.runId,
        sessionId: run.sessionId,
        signal,
        workspacePath
      })
      candidate.summary = output.summary.slice(0, MAX_SUMMARY_CHARS)
      candidate.state = signal.aborted ? "failed" : "ready"
      if (signal.aborted) {
        candidate.error = "Candidate was cancelled."
      }
    } catch (error) {
      candidate.state = "failed"
      candidate.error = error instanceof Error ? error.message : String(error)
    } finally {
      if (candidate.worktreeId) {
        try {
          const retained = await manager.finish(candidate.worktreeId)
          if (!retained) {
            candidate.worktreeId = undefined
          }
          const diff = retained ? await manager.preview(retained.id) : null
          candidate.stats = {
            additions: diff?.additions ?? 0,
            changedFileCount: diff?.paths.length ?? 0,
            deletions: diff?.deletions ?? 0
          }
        } catch (error) {
          candidate.state = "failed"
          candidate.error =
            error instanceof Error ? error.message : String(error)
        }
      }
      await save(run)
    }
  }
  const reviewCandidates = async (
    run: BestOfNRun,
    signal: AbortSignal
  ): Promise<void> => {
    const candidates: BestOfNReviewerRequest["candidates"] = []
    for (const candidate of run.candidates) {
      if (candidate.state !== "ready") {
        continue
      }
      const diff = candidate.worktreeId
        ? await manager.preview(candidate.worktreeId)
        : null
      candidates.push({
        additions: diff?.additions ?? 0,
        deletions: diff?.deletions ?? 0,
        id: candidate.id,
        modelId: candidate.modelId,
        patch: diff?.patch.slice(0, MAX_REVIEW_PATCH_CHARS) ?? "",
        paths: diff?.paths ?? [],
        summary: candidate.summary,
        truncated: (diff?.patch.length ?? 0) > MAX_REVIEW_PATCH_CHARS,
        worktreeId: candidate.worktreeId
      })
    }
    if (candidates.length === 0) {
      run.state = "failed"
      return
    }
    run.state = "ready"
    try {
      const review = await runReviewer({
        candidates,
        prompt: run.prompt,
        runId: run.runId,
        sessionId: run.sessionId,
        signal
      })
      run.review = {
        recommendation: review.recommendation.slice(0, MAX_SUMMARY_CHARS),
        recommendedCandidateId: candidates.some(
          (candidate) => candidate.id === review.recommendedCandidateId
        )
          ? review.recommendedCandidateId
          : null
      }
    } catch (error) {
      run.review = {
        recommendation: `Review unavailable: ${error instanceof Error ? error.message : String(error)}. Inspect each diff before choosing.`,
        recommendedCandidateId: null
      }
    }
  }
  const start: BestOfNService["start"] = async (request) => {
    const validated = StartBestOfNInputSchema.parse(request)
    const run: BestOfNRun = {
      candidates: validated.models.map((model) => ({
        ...model,
        id: randomUUID(),
        state: "pending",
        summary: ""
      })),
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      prompt: validated.prompt,
      review: null,
      runId: request.runId,
      sessionId: request.sessionId,
      state: "running"
    }
    const controller = new AbortController()
    const abort = (): void => {
      controller.abort(request.signal?.reason)
    }
    request.signal?.addEventListener("abort", abort, { once: true })
    if (request.signal?.aborted) {
      abort()
    }
    controllers.set(run.id, controller)
    try {
      await save(run)
      // Git preflight happens before candidate fan-out so a non-repository task
      // fails without issuing model requests or generating partial alternatives.
      const [first] = run.candidates
      if (!first) {
        throw new Error("No candidates were configured.")
      }
      const firstTree = await manager.create({
        label: first.modelId,
        projectPath: request.projectPath,
        runId: request.runId,
        sessionId: request.sessionId,
        signal: controller.signal
      })
      first.worktreeId = firstTree.id
      await save(run)
      const results = await Promise.allSettled(
        run.candidates.map((candidate, index) =>
          executeCandidate(
            candidate,
            run,
            request.projectPath,
            controller.signal,
            index === 0 ? firstTree.workspacePath : undefined
          )
        )
      )
      const failed = results.find((result) => result.status === "rejected")
      if (failed?.status === "rejected") {
        throw failed.reason
      }

      if (controller.signal.aborted) {
        run.state = "cancelled"
        await save(run)
        return run
      }
      await reviewCandidates(run, controller.signal)

      if (controller.signal.aborted) {
        run.state = "cancelled"
      }
      await save(run)
      return run
    } catch (error) {
      run.state = controller.signal.aborted ? "cancelled" : "failed"
      for (const candidate of run.candidates) {
        if (candidate.state === "pending" || candidate.state === "running") {
          candidate.state = "failed"
          candidate.error =
            error instanceof Error ? error.message : String(error)
        }
      }
      await save(run)
      throw error
    } finally {
      request.signal?.removeEventListener("abort", abort)
      controllers.delete(run.id)
    }
  }
  const cancel = async (id: string, sessionId: string): Promise<BestOfNRun> => {
    const run = await get(id, sessionId)
    controllers.get(id)?.abort(new Error("Cancelled by the user."))
    return run
  }
  const applyCandidate: BestOfNService["apply"] = async ({
    candidateId,
    expectedFingerprint,
    id,
    sessionId
  }) => {
    const run = await get(id, sessionId)
    if (run.state !== "ready") {
      return {
        appliedPaths: [],
        conflicts: [],
        error: "Best-of-N run is not ready for selection.",
        ok: false
      }
    }
    const { candidate, worktreeId } = getCandidate(run, candidateId)
    if (candidate.state !== "ready") {
      return {
        appliedPaths: [],
        conflicts: [],
        error: "Only a completed candidate can be selected.",
        ok: false
      }
    }
    // Reserve the selection durably before touching the primary workspace. A
    // crash or result-store failure cannot allow a second candidate to apply.
    run.state = "applying"
    run.selectedCandidateId = candidate.id
    await save(run)
    const result = await manager.apply({
      expectedFingerprint,
      id: worktreeId,
      sessionId
    })
    if (!result.ok) {
      run.state = "ready"
      run.selectedCandidateId = undefined
      await save(run)
      return result
    }
    candidate.state = "applied"
    run.state = "applied"
    await save(run)
    for (const other of run.candidates) {
      if (!other.worktreeId) {
        continue
      }
      try {
        await manager.prune({
          discardChanges: true,
          id: other.worktreeId,
          sessionId
        })
        other.worktreeId = undefined
        if (other.id !== candidateId) {
          other.state = "discarded"
        }
      } catch (error) {
        other.error = `Cleanup requires attention: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    await save(run)
    return result
  }
  const apply: BestOfNService["apply"] = (options) =>
    withRunAction(options.id, async () => await applyCandidate(options))
  const discard = (id: string, sessionId: string): Promise<void> =>
    withRunAction(id, async () => {
      const run = await get(id, sessionId)
      if (
        controllers.has(id) ||
        run.state === "running" ||
        run.state === "applying"
      ) {
        throw new Error(
          "Cancel and wait for the candidates to finish before discarding."
        )
      }
      for (const candidate of run.candidates) {
        if (candidate.worktreeId) {
          await manager.prune({
            discardChanges: true,
            id: candidate.worktreeId,
            sessionId
          })
          candidate.worktreeId = undefined
        }
        if (candidate.state !== "applied") {
          candidate.state = "discarded"
        }
        await save(run)
      }
      if (run.state !== "applied") {
        run.state = "cancelled"
      }
      await save(run)
    })
  const recover = async (): Promise<void> => {
    for (const run of await allRuns()) {
      if (run.state !== "running" && run.state !== "applying") {
        continue
      }
      if (run.state === "applying") {
        run.review = {
          recommendation:
            "Application was interrupted. Verify primary files and the saved rollback snapshot before selecting or discarding any other candidate. No changes were automatically replayed.",
          recommendedCandidateId: run.selectedCandidateId ?? null
        }
      }
      run.state = "cancelled"
      for (const candidate of run.candidates) {
        if (candidate.state !== "pending" && candidate.state !== "running") {
          continue
        }
        candidate.state = "failed"
        candidate.error =
          "The application stopped before this candidate completed. Retained worktrees can still be inspected."
      }
      await save(run)
    }
  }
  return { apply, cancel, discard, get, list, preview, recover, start }
}
