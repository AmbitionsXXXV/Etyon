/**
 * Serializes write transactions on the single shared libsql connection.
 *
 * libsql exposes one connection; two `db.transaction(...)` calls interleaved by
 * the event loop race for the write lock and one fails with `SQLITE_BUSY` (a
 * busy timeout does not cover a transaction that never gets to begin). Concurrent
 * agent runs — a workflow fanning out many read-only children while the parent
 * turn is otherwise idle — hit this routinely and orphan a child run at
 * "running". Chaining every wrapped write through one queue makes them run one at
 * a time; writes are millisecond-scale, so the added latency is negligible next
 * to the correctness it buys. Same tail-chained idiom as withWorkspaceWriteLock.
 */

let writeQueueTail: Promise<unknown> = Promise.resolve()

const awaitSettled = async (queue: Promise<unknown>): Promise<void> => {
  try {
    await queue
  } catch (error) {
    void error
  }
}

export const runExclusiveDbWrite = async <TValue>(
  task: () => Promise<TValue>
): Promise<TValue> => {
  const previousTail = writeQueueTail
  const currentTail = Promise.withResolvers<null>()
  writeQueueTail = currentTail.promise
  await awaitSettled(previousTail)

  try {
    return await task()
  } finally {
    currentTail.resolve(null)
  }
}
