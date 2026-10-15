import { describe, expect, it } from "vite-plus/test"

import {
  buildFallbackStoryboardPlan,
  parseStoryboardPlan
} from "@/shared/chat/storyboard"

const plan = {
  keyframes: [{ prompt: "boat on a step" }, { prompt: "boat in the gutter" }],
  shots: [{ prompt: "the boat slides off the step" }],
  style: "watercolor, dusk"
}

describe("parseStoryboardPlan", () => {
  it("reads the JSON object even when the model wraps it in prose", () => {
    expect(
      parseStoryboardPlan(
        `Here you go:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``
      )
    ).toEqual(plan)
  })

  it("rejects plans without exactly one more keyframe than shots", () => {
    expect(
      parseStoryboardPlan(
        JSON.stringify({ ...plan, keyframes: plan.keyframes.slice(0, 1) })
      )
    ).toBeNull()
  })

  it("rejects replies that are not a plan", () => {
    expect(parseStoryboardPlan("Sorry, I can't help with that.")).toBeNull()
    expect(parseStoryboardPlan("{ not json }")).toBeNull()
  })
})

describe("buildFallbackStoryboardPlan", () => {
  it("builds n shots and n + 1 keyframes from the brief", () => {
    const fallback = buildFallbackStoryboardPlan("A paper boat", 3)

    expect(fallback.shots).toHaveLength(3)
    expect(fallback.keyframes).toHaveLength(4)
    expect(fallback.keyframes[0]?.prompt).toContain("A paper boat")
  })
})
