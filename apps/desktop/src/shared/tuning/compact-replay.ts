/**
 * Auto-compact advice by replay, ported from magpie (internal/tune/tune.go):
 * take an agent's real calls, replay every conversation as if it compacted at
 * each candidate window, and advise the window that would have cost the
 * fewest weighted tokens. Pure, so Etyon's own chats and the session files of
 * Claude Code and Codex share it.
 */

export interface ReplayCall {
  /** Milliseconds a compaction made on this call took; 0 when none. */
  compactMs: number
  model: string
  /** Output tokens. */
  out: number
  /** Whole prompt tokens: fresh input plus cache reads and writes. */
  prompt: number
  /** The conversation the call belongs to. */
  stream: string
  time: number
  /** Cache-write tokens, and those written for the 1-hour cache. */
  wrote: number
  wrote1h: number
}

export interface CompactReplayOptions {
  /** The window the agent runs with now; 0 when nothing sets one. */
  current: number
  max: number
  min: number
  /** What the agent keeps free under its window (Claude Code: 33K). */
  reserve: number
  step: number
  /** The model's whole window, the most a setting can give. */
  window: number
}

export interface TokenWeights {
  out: number
  read: number
  write: number
  write1h: number
}

export interface ReplayFacts {
  after: number
  calls: number
  compacts: number
  growth: number
  /** Share of calls that would still go past the advised window. */
  long: number
  peak: number
  rework: number
  streams: number
  /** Median seconds a compaction took, when at least three were timed. */
  took: number
}

export interface ReplayPoint {
  compacts: number
  cost: number
  value: number
  wait: number
}

export interface CompactAdvice {
  /** The advised window; equal to current when no change saves enough. */
  best: number
  cost: number
  current: number
  curve: ReplayPoint[]
  facts: ReplayFacts
  low: number
  model: string
  window: number
}

// A drop to under this share of the prompt before is a compaction, and only
// from a prompt at least dropFrom long.
const DROP_SHARE = 0.6
const DROP_FROM = 20_000
// The calls after a compaction its rework is counted over.
const REWORK_CALLS = 10
const MIN_TIMED = 3
// Windows within this share of the cheapest cost the same; the least worth
// changing a setting for.
const SAME_COST = 0.03
const MIN_CALLS = 50
const CHEAPEST_BAND = 1.01
const SUMMARY_OVER_BASE = 10_000
const MIN_REWORK = 10_000
const MIN_COMPACTS_FOR_REWORK = 5
const MIN_COMPACTS_FOR_PEAK = 3
const GROWTH_CALLS_OVER_SUMMARY = 20
const HOUR_CACHE_SHARE = 0.5
const MS_PER_SECOND = 1000

/** Per-token weight against one plain input token (magpie WeightsFor). */
export const weightsFor = (model: string): TokenWeights =>
  model.toLowerCase().includes("claude")
    ? { out: 5, read: 0.1, write: 1.25, write1h: 2 }
    : { out: 8, read: 0.1, write: 1, write1h: 1 }

const isCompacted = (previous: number, current: number): boolean =>
  previous >= DROP_FROM && current < DROP_SHARE * previous

const cheapestOf = (points: readonly ReplayPoint[]): ReplayPoint | null => {
  let cheapest: ReplayPoint | null = null
  for (const point of points) {
    if (!cheapest || point.cost < cheapest.cost) {
      cheapest = point
    }
  }
  return cheapest
}

const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0
  }
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const roundTo = (value: number, step: number): number =>
  Math.round(value / step) * step

const roundUp = (value: number, step: number): number =>
  Math.ceil(value / step) * step

const toStreams = (calls: readonly ReplayCall[]): ReplayCall[][] => {
  const byStream = new Map<string, ReplayCall[]>()
  for (const call of calls) {
    const stream = byStream.get(call.stream) ?? []
    stream.push(call)
    byStream.set(call.stream, stream)
  }
  return [...byStream.keys()]
    .toSorted()
    .map((key) =>
      (byStream.get(key) ?? []).toSorted(
        (left, right) => left.time - right.time
      )
    )
}

const tookSeconds = (calls: readonly ReplayCall[]): number => {
  const timed = calls.filter((call) => call.compactMs > 0)
  return timed.length < MIN_TIMED
    ? 0
    : Math.round(median(timed.map((call) => call.compactMs)) / MS_PER_SECOND)
}

const readRework = (
  stream: readonly ReplayCall[],
  cut: number,
  growth: number
): number | null => {
  const end = cut + REWORK_CALLS
  if (end >= stream.length) {
    return null
  }
  for (let index = cut + 1; index <= end; index += 1) {
    if (
      isCompacted(stream[index - 1]?.prompt ?? 0, stream[index]?.prompt ?? 0)
    ) {
      return null
    }
  }
  const extra =
    (stream[end]?.prompt ?? 0) -
    (stream[cut]?.prompt ?? 0) -
    REWORK_CALLS * growth
  return Math.max(0, extra)
}

/** How an agent's conversations grow and what its compactions came to. */
const observe = (streams: readonly ReplayCall[][]) => {
  const peaks: number[] = []
  const afters: number[] = []
  const growths: number[] = []
  const reworks: number[] = []
  let calls = 0
  for (const stream of streams) {
    calls += stream.length
    const deltas: number[] = []
    const cuts: number[] = []
    for (let index = 1; index < stream.length; index += 1) {
      const previous = stream[index - 1]?.prompt ?? 0
      const current = stream[index]?.prompt ?? 0
      if (isCompacted(previous, current)) {
        peaks.push(previous)
        afters.push(current)
        cuts.push(index)
      } else if (current >= previous) {
        deltas.push(current - previous)
      }
    }
    growths.push(...deltas)
    const growth = median(deltas)
    for (const cut of cuts) {
      const rework = readRework(stream, cut, growth)
      if (rework !== null) {
        reworks.push(rework)
      }
    }
  }
  return {
    after: median(afters),
    calls,
    compacts: peaks.length,
    growth: median(growths),
    peak: median(peaks),
    rework: median(reworks),
    streams: streams.length
  }
}

interface ReplayInput {
  after: number
  base: number
  rework: number
  streams: readonly ReplayCall[][]
  threshold: number
  weights: TokenWeights
  write: number
}

/**
 * What the streams would have cost compacting at `threshold`: each call grows
 * by what it grew by, a compaction is made when it would pass the threshold,
 * and the agent's own compactions are left out. A compaction reads the whole
 * prompt, writes a summary, and the calls after it read back the rework.
 */
const replay = ({
  after,
  base,
  rework,
  streams,
  threshold,
  weights,
  write
}: ReplayInput): { compacts: number; cost: number; over: number } => {
  let cost = 0
  let compacts = 0
  let over = 0
  const summary = Math.max(0, after - base)
  for (const stream of streams) {
    const [first] = stream
    if (!first) {
      continue
    }
    let context = first.prompt
    cost += context * write + first.out * weights.out
    for (let index = 1; index < stream.length; index += 1) {
      const previous = stream[index - 1]?.prompt ?? 0
      const call = stream[index]
      if (!call) {
        continue
      }
      let delta = call.prompt - previous
      if (delta < 0 || isCompacted(previous, call.prompt)) {
        delta = 0
      }
      if (context + delta > threshold && context > after) {
        cost +=
          context * weights.read +
          summary * weights.out +
          (summary + rework) * write
        context = after + rework
        compacts += 1
      }
      if (context + delta > threshold) {
        over += 1
      }
      cost += context * weights.read + delta * write + call.out * weights.out
      context += delta
    }
  }
  return { compacts, cost, over }
}

const pickWithWaits = (
  curve: readonly ReplayPoint[],
  now: ReplayPoint
): ReplayPoint => {
  const calm = curve.filter((point) => point.compacts <= now.compacts)
  const cheapest = cheapestOf(calm)
  if (!cheapest) {
    return now
  }
  let best = cheapest
  for (const point of calm) {
    const isFewer =
      point.compacts < best.compacts ||
      (point.compacts === best.compacts && point.value > best.value)
    if (point.cost <= cheapest.cost * (1 + SAME_COST) && isFewer) {
      best = point
    }
  }
  return best
}

/**
 * Advises the window to compact at for one model's calls, or null when there
 * is too little to go on (fewer than 50 calls).
 */
export const adviseCompactWindow = (
  calls: readonly ReplayCall[],
  options: CompactReplayOptions
): CompactAdvice | null => {
  const streams = toStreams(calls)
  const observed = observe(streams)
  const [firstCall] = calls
  if (observed.calls < MIN_CALLS || !firstCall) {
    return null
  }
  const weights = weightsFor(firstCall.model)
  const wrote = calls.reduce((sum, call) => sum + call.wrote, 0)
  const wrote1h = calls.reduce((sum, call) => sum + call.wrote1h, 0)
  const write =
    wrote > 0 && wrote1h / wrote > HOUR_CACHE_SHARE
      ? weights.write1h
      : weights.write
  const base = median(streams.map((stream) => stream[0]?.prompt ?? 0))
  const after = observed.after || base + SUMMARY_OVER_BASE
  const rework =
    observed.compacts < MIN_COMPACTS_FOR_REWORK
      ? Math.max(observed.rework, MIN_REWORK)
      : observed.rework
  let { current } = options
  if (current === 0) {
    current =
      observed.compacts >= MIN_COMPACTS_FOR_PEAK
        ? roundTo(observed.peak + options.reserve, options.step)
        : options.window
  }
  if (options.window > 0) {
    current = Math.min(current, options.window)
  }
  const top = Math.min(options.max, Math.max(options.window, current))
  // A window that leaves little room over the summary compacts over and
  // over: keep half the summary, or twenty calls' growth, free over it.
  const floor = Math.max(
    options.min,
    roundUp(
      after +
        Math.max(after / 2, GROWTH_CALLS_OVER_SUMMARY * observed.growth) +
        options.reserve,
      options.step
    )
  )
  const took = tookSeconds(calls)
  const run = (value: number): ReplayPoint => {
    const result = replay({
      after,
      base,
      rework,
      streams,
      threshold: Math.max(after + 1, value - options.reserve),
      weights,
      write
    })
    return {
      compacts: result.compacts,
      cost: result.cost,
      value,
      wait: result.compacts * took
    }
  }
  const now = run(current)
  const curve: ReplayPoint[] = []
  for (let value = floor; value <= top; value += options.step) {
    curve.push(run(value))
  }
  const cheapest = cheapestOf(curve)
  if (!cheapest) {
    return null
  }
  // Of the windows within 1% of the cheapest, the largest: fewer compactions
  // lose less of what the conversation knew.
  let best = cheapest
  for (const point of curve) {
    if (
      point.cost <= cheapest.cost * CHEAPEST_BAND &&
      point.value > best.value
    ) {
      best = point
    }
  }
  if (took > 0) {
    best = pickWithWaits(curve, now)
  }
  // Only advise a change that saves 3% or more.
  const isWorthChanging =
    now.cost > 0 && (now.cost - best.cost) / now.cost >= SAME_COST
  const advised = isWorthChanging ? best : { ...now, value: current }
  const { over } = replay({
    after,
    base,
    rework,
    streams,
    threshold: Math.max(after + 1, advised.value - options.reserve),
    weights,
    write
  })
  return {
    best: advised.value,
    cost: now.cost,
    current,
    curve,
    facts: {
      ...observed,
      after,
      long: over / Math.max(1, observed.calls),
      rework,
      took
    },
    low: advised.cost,
    model: firstCall.model,
    window: options.window
  }
}
