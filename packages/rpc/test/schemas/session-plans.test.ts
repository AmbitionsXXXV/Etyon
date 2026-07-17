import { describe, expect, it } from "vite-plus/test"

import {
  ChatSessionPlanSchema,
  ChatSessionPlanStatusSchema,
  SessionPlanOutputSchema,
  SetSessionPlanStatusInputSchema
} from "../../src/schemas/agents"

describe("session plan schemas", () => {
  it("accepts a full plan row with nullable source fields", () => {
    expect(
      ChatSessionPlanSchema.parse({
        createdAt: "2026-07-15T00:00:00.000Z",
        decidedAt: null,
        planMarkdown: "1. do a",
        sessionId: "session-1",
        sourceRunId: null,
        sourceToolCallId: null,
        status: "proposed",
        title: "Refactor auth",
        updatedAt: "2026-07-15T00:00:00.000Z"
      })
    ).toMatchObject({ sessionId: "session-1", status: "proposed" })
  })

  it("rejects an unknown status", () => {
    expect(ChatSessionPlanStatusSchema.safeParse("archived").success).toBe(
      false
    )
  })

  it("accepts a nullable plan in the output shape", () => {
    expect(SessionPlanOutputSchema.parse({ plan: null })).toEqual({
      plan: null
    })
  })

  it("restricts setSessionPlanStatus to the manual statuses", () => {
    expect(
      SetSessionPlanStatusInputSchema.parse({
        sessionId: "session-1",
        status: "dismissed"
      })
    ).toMatchObject({ status: "dismissed" })

    expect(
      SetSessionPlanStatusInputSchema.safeParse({
        sessionId: "session-1",
        status: "implementing"
      }).success
    ).toBe(false)
  })
})
