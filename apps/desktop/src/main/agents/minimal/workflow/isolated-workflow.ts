import { Worker } from "node:worker_threads"

import type {
  WorkflowRunOptions,
  WorkflowRunResult
} from "@/main/agents/minimal/workflow/engine"

const DEFAULT_WORKFLOW_TIMEOUT_MS = 180_000
const MAX_MESSAGE_BYTES = 512 * 1024

const workerRelativePath = import.meta.url.endsWith(".ts")
  ? ["..", "..", "..", "..", "..", ".vite", "build", "workflow-worker.js"].join(
      "/"
    )
  : "./workflow-worker.js"
const workerUrl = new URL(workerRelativePath, import.meta.url)

const deliverWorkflowEvent = (
  message: Record<string, unknown>,
  options: WorkflowRunOptions
): void => {
  if (message.name === "log" && typeof message.value === "string") {
    options.onLog?.(message.value)
  }
  if (message.name === "phase" && typeof message.value === "string") {
    options.onPhase?.(message.value)
  }
  if (message.name === "agent-start") {
    options.onAgentStart?.(
      message.value as Parameters<
        NonNullable<WorkflowRunOptions["onAgentStart"]>
      >[0]
    )
  }
  if (message.name === "agent-end") {
    options.onAgentEnd?.(
      message.value as Parameters<
        NonNullable<WorkflowRunOptions["onAgentEnd"]>
      >[0]
    )
  }
}

export const runIsolatedWorkflow = async <TResult>(
  script: string,
  options: WorkflowRunOptions
): Promise<WorkflowRunResult<TResult>> => {
  options.signal?.throwIfAborted()
  const controller = new AbortController()
  const deferred = Promise.withResolvers<WorkflowRunResult<TResult>>()
  const worker = new Worker(workerUrl, {
    env: {},
    resourceLimits: { maxOldGenerationSizeMb: 96, stackSizeMb: 4 },
    workerData: {
      args: options.args,
      concurrency: options.concurrency,
      script,
      startedAtMs: options.startedAtMs,
      tokenBudget: options.tokenBudget
    }
  })
  let finished = false
  const fail = (error: Error): void => {
    if (finished) {
      return
    }
    finished = true
    controller.abort(error)
    deferred.reject(error)
  }
  const abort = (): void => fail(new Error("workflow aborted"))
  const deadline = setTimeout(
    () => fail(new Error("workflow deadline exceeded")),
    options.timeoutMs ?? DEFAULT_WORKFLOW_TIMEOUT_MS
  )
  options.signal?.addEventListener("abort", abort, { once: true })
  worker.on("error", fail)
  worker.on("exit", (code) => {
    if (!finished) {
      fail(new Error(`Workflow worker exited before settling (${code})`))
    }
  })
  const postToWorker = worker.postMessage.bind(worker)
  const sendToWorker = (message: unknown): void => {
    if (finished) {
      return
    }
    try {
      const serialized = JSON.stringify(message)
      if (
        serialized === undefined ||
        Buffer.byteLength(serialized) > MAX_MESSAGE_BYTES
      ) {
        fail(new Error("Workflow agent result limit exceeded"))
        return
      }
      postToWorker(message)
    } catch (error) {
      fail(
        error instanceof Error
          ? error
          : new Error("Invalid workflow agent result")
      )
    }
  }
  worker.on("message", (raw: unknown) => {
    try {
      if (finished || !raw || typeof raw !== "object") {
        return
      }
      if (Buffer.byteLength(JSON.stringify(raw)) > MAX_MESSAGE_BYTES) {
        fail(new Error("Workflow output limit exceeded"))
        return
      }
      const message = raw as Record<string, unknown>
      if (
        message.type === "agent" &&
        typeof message.id === "number" &&
        message.input &&
        typeof message.input === "object"
      ) {
        const input = message.input as Parameters<
          WorkflowRunOptions["runAgent"]
        >[0]
        if (typeof input.prompt !== "string" || input.prompt.length > 64_000) {
          fail(new Error("Invalid workflow agent request"))
          return
        }
        void (async () => {
          try {
            controller.signal.throwIfAborted()
            const result = await options.runAgent({
              ...input,
              signal: controller.signal
            })
            if (!finished) {
              sendToWorker({ id: message.id, result, type: "agent-result" })
            }
          } catch (error) {
            if (!finished) {
              sendToWorker({
                error: error instanceof Error ? error.message : "Agent failed",
                id: message.id,
                type: "agent-result"
              })
            }
          }
        })()
        return
      }
      if (message.type === "event") {
        deliverWorkflowEvent(message, options)
        return
      }
      if (message.type === "result") {
        finished = true
        deferred.resolve(message.result as WorkflowRunResult<TResult>)
      }
      if (message.type === "error") {
        fail(new Error(String(message.error)))
      }
    } catch (error) {
      fail(
        error instanceof Error ? error : new Error("Invalid workflow message")
      )
    }
  })
  try {
    return await deferred.promise
  } finally {
    finished = true
    controller.abort()
    clearTimeout(deadline)
    options.signal?.removeEventListener("abort", abort)
    await worker.terminate()
  }
}
