const guardedPerformanceTargets = new WeakSet<Performance>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const hasReactDevtoolsDetail = (
  value: unknown
): value is PerformanceMeasureOptions => {
  if (!isRecord(value) || !isRecord(value.detail)) {
    return false
  }

  const { devtools } = value.detail

  return (
    isRecord(devtools) &&
    typeof devtools.color === "string" &&
    typeof devtools.tooltipText === "string" &&
    typeof devtools.track === "string"
  )
}

const measureWithoutDetail = ({
  endMark,
  measureName,
  options,
  originalMeasure,
  performanceTarget
}: {
  endMark?: string
  measureName: string
  options: PerformanceMeasureOptions
  originalMeasure: Performance["measure"]
  performanceTarget: Performance
}): PerformanceMeasure => {
  const measureOptions = { ...options }

  delete measureOptions.detail

  return originalMeasure.call(
    performanceTarget,
    measureName,
    measureOptions,
    endMark
  )
}

export const createReactPerformanceMeasureGuard = ({
  originalMeasure,
  performanceTarget
}: {
  originalMeasure: Performance["measure"]
  performanceTarget: Performance
}): Performance["measure"] =>
  ((measureName, startOrMeasureOptions, endMark) => {
    if (hasReactDevtoolsDetail(startOrMeasureOptions)) {
      return measureWithoutDetail({
        endMark,
        measureName,
        options: startOrMeasureOptions,
        originalMeasure,
        performanceTarget
      })
    }

    return originalMeasure.call(
      performanceTarget,
      measureName,
      startOrMeasureOptions,
      endMark
    )
  }) as Performance["measure"]

export const installReactPerformanceMeasureGuard = (
  performanceTarget: Performance
): void => {
  if (guardedPerformanceTargets.has(performanceTarget)) {
    return
  }

  const guardedMeasure = createReactPerformanceMeasureGuard({
    originalMeasure: performanceTarget.measure,
    performanceTarget
  })

  Object.defineProperty(performanceTarget, "measure", {
    configurable: true,
    value: guardedMeasure,
    writable: true
  })
  guardedPerformanceTargets.add(performanceTarget)
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  installReactPerformanceMeasureGuard(window.performance)
}
