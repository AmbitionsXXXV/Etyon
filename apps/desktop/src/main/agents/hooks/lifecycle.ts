interface ActiveHookProcess {
  cancel: () => void
  settled: Promise<unknown>
}

let runtimeController = new AbortController()
const activeProcesses = new Set<ActiveHookProcess>()

export const getRuntimeHookSignal = (): AbortSignal => runtimeController.signal

export const startRuntimeHooks = (): void => {
  if (activeProcesses.size > 0) {
    throw new Error(
      "Cannot restart Hook lifecycle while processes are still active."
    )
  }
  runtimeController = new AbortController()
}

export const registerHookProcess = (
  process: ActiveHookProcess
): (() => void) => {
  activeProcesses.add(process)
  if (runtimeController.signal.aborted) {
    process.cancel()
  }
  return () => {
    activeProcesses.delete(process)
  }
}

export const stopRuntimeHooks = async (): Promise<void> => {
  const processes = [...activeProcesses]
  runtimeController.abort(new Error("Hook runtime is shutting down."))
  for (const process of processes) {
    process.cancel()
  }
  await Promise.allSettled(processes.map((process) => process.settled))
}
