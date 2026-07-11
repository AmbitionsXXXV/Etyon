/**
 * In-process approval broker for delegated writable sub-agents.
 *
 * A writable child's edit/write/bash call cannot use the AI SDK `needsApproval`
 * suspend path the parent uses: the child runs *inside* one of the parent's tool
 * `execute` calls, so suspending the parent stream would tear down every other
 * child running in parallel. Instead the child blocks *inside* its own execute on
 * a promise this broker owns, keeping the parent stream open. The oRPC
 * `respondToApproval` handler resolves that promise from the same main process
 * (the Hono server and the RPC router share this module singleton).
 *
 * The broker is deliberately DB-free and `window`/electron-free so it is unit
 * testable in node: callers own all persistence (see the event-store
 * `recordChildApproval*` helpers) and only use the broker to bridge the async gap
 * between "child asked" and "user (or abort/timeout) answered".
 */

export type ApprovalReason = "aborted" | "expired" | "responded"

export interface ApprovalResolution {
  approved: boolean
  reason: ApprovalReason
}

interface PendingApproval {
  settle: (resolution: ApprovalResolution) => void
}

const pendingApprovals = new Map<string, PendingApproval>()

export interface RegisterApprovalOptions {
  approvalId: string
  /** Fires the resolution as `denied`/`aborted` when the child run is aborted. */
  signal?: AbortSignal
  /** TTL backstop; on expiry the resolution is `denied`/`expired`. */
  timeoutMs?: number
}

/**
 * Registers a pending approval and returns a promise that settles exactly once —
 * via {@link resolveApproval} (user responded), the abort signal, or the TTL.
 * Registering a second time for the same id first settles the earlier waiter as
 * `denied`/`aborted` so a stale promise can never leak.
 */
export const registerApproval = ({
  approvalId,
  signal,
  timeoutMs
}: RegisterApprovalOptions): Promise<ApprovalResolution> => {
  // A re-register (should not happen for a unique childRunId:toolCallId id) must
  // not orphan the previous waiter.
  pendingApprovals.get(approvalId)?.settle({
    approved: false,
    reason: "aborted"
  })

  if (signal?.aborted) {
    return Promise.resolve({ approved: false, reason: "aborted" })
  }

  const { promise, resolve } = Promise.withResolvers<ApprovalResolution>()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  // Settles once and clears the timer; an abort listener that fires after this
  // finds the id already gone and no-ops, so it needs no explicit removal.
  const settle = (resolution: ApprovalResolution): void => {
    if (!pendingApprovals.has(approvalId)) {
      return
    }

    pendingApprovals.delete(approvalId)

    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
    }

    resolve(resolution)
  }

  pendingApprovals.set(approvalId, { settle })

  if (timeoutMs !== undefined && timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      settle({ approved: false, reason: "expired" })
    }, timeoutMs)
  }

  signal?.addEventListener(
    "abort",
    () => {
      settle({ approved: false, reason: "aborted" })
    },
    { once: true }
  )

  return promise
}

/**
 * Resolves a pending approval with the user's decision. Returns `false` when no
 * approval is pending for the id (already responded, aborted, or expired) so the
 * caller can surface a "no longer actionable" error instead of writing state for
 * a decision that will never reach the child.
 */
export const resolveApproval = (
  approvalId: string,
  approved: boolean
): boolean => {
  const pending = pendingApprovals.get(approvalId)

  if (!pending) {
    return false
  }

  pending.settle({ approved, reason: "responded" })

  return true
}

/** Whether an approval is still awaiting a decision. */
export const hasPendingApproval = (approvalId: string): boolean =>
  pendingApprovals.has(approvalId)
