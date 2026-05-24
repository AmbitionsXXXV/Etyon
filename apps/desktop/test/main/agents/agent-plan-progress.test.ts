import { describe, expect, it } from "vite-plus/test"

import {
  isRetryableAgentFailure,
  parseStructuredPlanFromText,
  parsePlanProgressMarkers,
  resolvePlanStepFailureAction,
  stripPlanProgressMarkers,
  summarizePlanProgress
} from "@/main/agents/agent-plan-progress"

describe("agent plan progress", () => {
  it("extracts done markers with text positions", () => {
    expect(
      parsePlanProgressMarkers("Finish setup [DONE:1]\nShip feature [DONE:12]")
    ).toEqual([
      {
        index: 13,
        marker: "[DONE:1]",
        stepNumber: 1
      },
      {
        index: 35,
        marker: "[DONE:12]",
        stepNumber: 12
      }
    ])
  })

  it("summarizes unique completed steps in ascending order", () => {
    expect(summarizePlanProgress("[DONE:2]\n[DONE:1]\n[DONE:2]")).toEqual({
      completedCount: 2,
      completedStepNumbers: [1, 2],
      latestCompletedStepNumber: 2
    })
  })

  it("strips valid done markers but leaves malformed text intact", () => {
    expect(stripPlanProgressMarkers("A [DONE:1]\nB [DONE:0]\nC [DONE:x]")).toBe(
      "A\nB [DONE:0]\nC [DONE:x]"
    )
  })

  it("parses a structured JSON plan from fenced model output", () => {
    expect(
      parseStructuredPlanFromText(
        [
          "Plan:",
          "```json",
          JSON.stringify({
            items: [
              {
                action: "Inspect agent runtime entrypoints.",
                files: [
                  "apps/desktop/src/main/agents/agent-runtime.ts",
                  "doc/agents.md"
                ],
                riskLevel: "medium",
                stepNumber: 1
              }
            ]
          }),
          "```"
        ].join("\n")
      )
    ).toEqual({
      items: [
        {
          action: "Inspect agent runtime entrypoints.",
          files: [
            "apps/desktop/src/main/agents/agent-runtime.ts",
            "doc/agents.md"
          ],
          riskLevel: "medium",
          stepNumber: 1
        }
      ]
    })
  })

  it("rejects malformed structured plans", () => {
    expect(
      parseStructuredPlanFromText(
        JSON.stringify({
          items: [
            {
              action: "",
              files: ["doc/agents.md"],
              riskLevel: "unknown",
              stepNumber: 0
            }
          ]
        })
      )
    ).toBeNull()
  })

  it("classifies transient provider failures as retryable", () => {
    expect(isRetryableAgentFailure("429 too many requests")).toBe(true)
    expect(isRetryableAgentFailure("stream ended before message_stop")).toBe(
      true
    )
    expect(isRetryableAgentFailure("context length exceeded")).toBe(false)
    expect(isRetryableAgentFailure("validation failed")).toBe(false)
  })

  it("retries retryable plan step failures with exponential backoff", () => {
    expect(
      resolvePlanStepFailureAction({
        baseDelayMs: 500,
        failedAttempts: 2,
        failFast: true,
        maxRetries: 3,
        retryable: true
      })
    ).toEqual({
      action: "retry",
      delayMs: 1000,
      reason: "retryable-failure"
    })
  })

  it("uses failFast to abort or skip after retries are exhausted", () => {
    expect(
      resolvePlanStepFailureAction({
        failedAttempts: 2,
        failFast: true,
        maxRetries: 1,
        retryable: true
      })
    ).toEqual({
      action: "abort",
      delayMs: 0,
      reason: "fail-fast"
    })
    expect(
      resolvePlanStepFailureAction({
        failedAttempts: 1,
        failFast: false,
        maxRetries: 0,
        retryable: false
      })
    ).toEqual({
      action: "skip",
      delayMs: 0,
      reason: "skip-failed-step"
    })
  })
})
