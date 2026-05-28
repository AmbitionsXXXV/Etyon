import type { AgentRunTraceRun } from "@etyon/rpc"
import { describe, expect, it } from "vite-plus/test"

import { getLatestRecoverableAgentRun } from "@/renderer/lib/chat/agent-recovery"

const createRun = (
  overrides: Partial<AgentRunTraceRun> = {}
): AgentRunTraceRun => ({
  chatSessionId: "session-1",
  errorMessage: null,
  finishedAt: "2026-05-27T10:00:00.000Z",
  id: "run-1",
  modelId: "openai/gpt-4.1",
  parentRunId: null,
  profileId: "coder",
  startedAt: "2026-05-27T09:59:00.000Z",
  status: "failed",
  ...overrides
})

describe("agent recovery helpers", () => {
  it("selects the latest failed top-level run for manual retry", () => {
    const latestRun = createRun({
      finishedAt: "2026-05-27T10:02:00.000Z",
      id: "latest-run"
    })
    const runs = [
      createRun({
        id: "child-run",
        parentRunId: "parent-run"
      }),
      createRun({
        finishedAt: "2026-05-27T10:01:00.000Z",
        id: "older-run"
      }),
      createRun({
        id: "running-run",
        status: "running"
      }),
      latestRun
    ]

    expect(getLatestRecoverableAgentRun(runs)).toEqual(latestRun)
  })
})
