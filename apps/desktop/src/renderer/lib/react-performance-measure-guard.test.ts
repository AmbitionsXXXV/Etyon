import { describe, expect, it } from "vitest"

import { createReactPerformanceMeasureGuard } from "./react-performance-measure-guard"

interface MeasureCall {
  endMark?: string
  measureName: string
  startOrMeasureOptions?: PerformanceMeasureOptions | string
}

const createMockPerformance = () => {
  const calls: MeasureCall[] = []
  const performanceTarget = {
    measure: ((measureName, startOrMeasureOptions, endMark) => {
      calls.push({
        endMark,
        measureName,
        startOrMeasureOptions
      })

      return {} as PerformanceMeasure
    }) as Performance["measure"]
  } as Performance

  return {
    calls,
    performanceTarget
  }
}

describe("react performance measure guard", () => {
  it("strips React devtools details before Chromium clones measure options", () => {
    const { calls, performanceTarget } = createMockPerformance()
    const guardedMeasure = createReactPerformanceMeasureGuard({
      originalMeasure: performanceTarget.measure,
      performanceTarget
    })

    guardedMeasure("PromptInput", {
      detail: {
        devtools: {
          color: "primary",
          properties: [["Changed Props", ""]],
          tooltipText: "PromptInput",
          track: "Components"
        }
      },
      end: 2,
      start: 1
    })

    expect(calls).toEqual([
      {
        endMark: undefined,
        measureName: "PromptInput",
        startOrMeasureOptions: {
          end: 2,
          start: 1
        }
      }
    ])
  })

  it("keeps non-React measure details unchanged", () => {
    const { calls, performanceTarget } = createMockPerformance()
    const guardedMeasure = createReactPerformanceMeasureGuard({
      originalMeasure: performanceTarget.measure,
      performanceTarget
    })

    guardedMeasure("custom", {
      detail: {
        payload: true
      },
      start: 1
    })

    expect(calls).toEqual([
      {
        endMark: undefined,
        measureName: "custom",
        startOrMeasureOptions: {
          detail: {
            payload: true
          },
          start: 1
        }
      }
    ])
  })

  it("keeps marker overload calls unchanged", () => {
    const { calls, performanceTarget } = createMockPerformance()
    const guardedMeasure = createReactPerformanceMeasureGuard({
      originalMeasure: performanceTarget.measure,
      performanceTarget
    })

    guardedMeasure("custom", "start-mark", "end-mark")

    expect(calls).toEqual([
      {
        endMark: "end-mark",
        measureName: "custom",
        startOrMeasureOptions: "start-mark"
      }
    ])
  })
})
