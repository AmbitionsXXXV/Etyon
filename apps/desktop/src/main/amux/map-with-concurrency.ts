/**
 * Runs `task` over `items` with at most `limit` in flight, keeping results in
 * item order. Every task runs even when one fails; the failures are reported
 * per item so one bad render never cancels its siblings.
 */
export const mapWithConcurrency = async <TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  task: (item: TItem, index: number) => Promise<TResult>
): Promise<PromiseSettledResult<TResult>[]> => {
  const results: PromiseSettledResult<TResult>[] = Array.from({
    length: items.length
  })
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1

      try {
        // oxlint-disable-next-line no-await-in-loop -- bounded pool by design
        results[index] = {
          status: "fulfilled",
          value: await task(items[index] as TItem, index)
        }
      } catch (error) {
        results[index] = { reason: error, status: "rejected" }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  )

  return results
}
