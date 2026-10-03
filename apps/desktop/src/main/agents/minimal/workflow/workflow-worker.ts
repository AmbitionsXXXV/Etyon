import { parentPort, workerData } from "node:worker_threads"

import { runWorkflowInProcess } from "@/main/agents/minimal/workflow/engine"
import type { WorkflowRunOptions } from "@/main/agents/minimal/workflow/engine"

if (!parentPort) {
  throw new Error("Workflow worker requires a parent port")
}
const postToParent = parentPort.postMessage.bind(parentPort)

const pending = new Map<
  number,
  { reject: (error: Error) => void; resolve: (value: unknown) => void }
>()
let nextId = 0
let sentBytes = 0
let failed = false
const send = (message: unknown): void => {
  if (failed) {
    return
  }
  try {
    sentBytes += Buffer.byteLength(JSON.stringify(message))
    if (sentBytes > 4 * 1024 * 1024) {
      failed = true
      postToParent({
        error: "Workflow output limit exceeded",
        type: "error"
      })
      return
    }
    postToParent(message)
  } catch {
    failed = true
    postToParent({
      error: "Workflow output is not serializable",
      type: "error"
    })
  }
}
parentPort?.on("message", (raw: unknown) => {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("id" in raw) ||
    typeof raw.id !== "number"
  ) {
    return
  }
  const request = pending.get(raw.id)
  if (!request) {
    return
  }
  pending.delete(raw.id)
  if ("error" in raw) {
    request.reject(new Error(String(raw.error)))
  } else {
    request.resolve("result" in raw ? raw.result : undefined)
  }
})
const execute = async (): Promise<void> => {
  const data = workerData as {
    args?: unknown
    concurrency?: number
    script: string
    startedAtMs: number
    tokenBudget?: number | null
  }
  const options: WorkflowRunOptions = {
    ...data,
    onAgentEnd: (value) => send({ name: "agent-end", type: "event", value }),
    onAgentStart: (value) =>
      send({ name: "agent-start", type: "event", value }),
    onLog: (value) => send({ name: "log", type: "event", value }),
    onPhase: (value) => send({ name: "phase", type: "event", value }),
    runAgent: async (input) => {
      const request = Promise.withResolvers<unknown>()
      const id = nextId
      nextId += 1
      pending.set(id, request)
      const { signal: _signal, ...messageInput } = input
      send({ id, input: messageInput, type: "agent" })
      return await request.promise
    }
  }
  try {
    send({
      result: await runWorkflowInProcess(data.script, options),
      type: "result"
    })
  } catch (error) {
    send({
      error: String(error),
      type: "error"
    })
  }
}
void execute()
