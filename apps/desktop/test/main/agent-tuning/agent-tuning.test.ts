import { describe, expect, it } from "vite-plus/test"

import {
  CODEX_COMPACT_KEY,
  readClaudeCompactSetting,
  readTomlTopNumber,
  writeClaudeCompactWindow,
  writeTomlTopNumber
} from "@/main/agent-tuning/config-files"
import {
  claudeModelSettingsName,
  parseClaudeSessionLines,
  parseCodexRolloutLines
} from "@/main/agent-tuning/parse-sessions"

const claudeLine = (id: string, input: number, at: string) =>
  JSON.stringify({
    message: {
      id,
      model: "claude-opus-5-5",
      usage: {
        cache_creation: {
          ephemeral_1h_input_tokens: 100,
          ephemeral_5m_input_tokens: 0
        },
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 1000,
        input_tokens: input,
        output_tokens: 50
      }
    },
    timestamp: at,
    type: "assistant"
  })

describe("claudeModelSettingsName", () => {
  it("normalizes Claude model ids and rejects others", () => {
    expect(claudeModelSettingsName("claude-opus-5.5[1m]")).toBe(
      "claude-opus-5-5"
    )
    expect(claudeModelSettingsName("claude-sonnet-5-20260101")).toBe(
      "claude-sonnet-5"
    )
    expect(claudeModelSettingsName("gpt-5.6")).toBeNull()
  })
})

describe("parseClaudeSessionLines", () => {
  it("keeps the last usage of a reply and times the compaction on the next call", async () => {
    const calls = await parseClaudeSessionLines(
      [
        claudeLine("m1", 10, "2026-10-15T00:00:00Z"),
        claudeLine("m1", 20, "2026-10-15T00:00:01Z"),
        JSON.stringify({
          compactMetadata: { durationMs: 4000 },
          subtype: "compact_boundary",
          type: "system"
        }),
        claudeLine("m2", 5, "2026-10-15T00:01:00Z"),
        claudeLine("old", 5, "2026-09-01T00:00:00Z")
      ],
      { sinceMs: Date.parse("2026-10-01T00:00:00Z"), stream: "s" }
    )
    expect(
      calls.map((call) => [call.prompt, call.compactMs, call.wrote1h])
    ).toEqual([
      [1120, 0, 100],
      [1105, 4000, 100]
    ])
  })
})

const count = (total: number, input: number) =>
  JSON.stringify({
    payload: {
      info: {
        last_token_usage: { input_tokens: input, output_tokens: 9 },
        model_context_window: 272_000,
        total_token_usage: { total_tokens: total }
      },
      type: "token_count"
    },
    timestamp: "2026-10-15T00:00:00Z",
    type: "event_msg"
  })

describe("parseCodexRolloutLines", () => {
  it("counts a call wherever the running total grew", async () => {
    const reading = await parseCodexRolloutLines(
      [
        JSON.stringify({ payload: { model: "gpt-5.6" }, type: "turn_context" }),
        count(100, 90),
        count(100, 90),
        count(250, 140)
      ],
      { sinceMs: 0, stream: "r" }
    )
    expect(reading.contextWindow).toBe(272_000)
    expect(reading.calls.map((call) => [call.model, call.prompt])).toEqual([
      ["gpt-5.6", 90],
      ["gpt-5.6", 140]
    ])
  })
})

describe("Claude settings.json", () => {
  it("reads the override first, then the model, then the top level", () => {
    expect(
      readClaudeCompactSetting(
        JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "300000" } }),
        "claude-opus-5-5",
        {}
      )
    ).toEqual({
      lockedBy: "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
      source: "env",
      value: 300_000
    })
    expect(
      readClaudeCompactSetting(
        JSON.stringify({
          autoCompactWindow: 400_000,
          modelSettings: { "claude-opus-5-5": { autoCompactWindow: 500_000 } }
        }),
        "claude-opus-5-5",
        {}
      ).value
    ).toBe(500_000)
    expect(
      readClaudeCompactSetting(
        '{"autoCompactWindow":400000}',
        "claude-opus-5-5",
        {}
      ).source
    ).toBe("settings")
  })

  it("writes a model window and removes it again without touching other keys", () => {
    const original = JSON.stringify({ theme: "dark" })
    const written = writeClaudeCompactWindow(
      original,
      "claude-opus-5-5",
      180_000
    )
    expect(JSON.parse(written)).toEqual({
      modelSettings: { "claude-opus-5-5": { autoCompactWindow: 180_000 } },
      theme: "dark"
    })
    expect(
      JSON.parse(writeClaudeCompactWindow(written, "claude-opus-5-5", null))
    ).toEqual({
      theme: "dark"
    })
  })
})

describe("Codex config.toml", () => {
  it("sets a top-level key before the first table and removes it", () => {
    const original = 'model = "gpt-5.6"\n\n[profiles.fast]\nmodel = "x"\n'
    const written = writeTomlTopNumber(original, CODEX_COMPACT_KEY, 240_000)
    expect(written).toBe(
      'model = "gpt-5.6"\nmodel_auto_compact_token_limit = 240000\n\n[profiles.fast]\nmodel = "x"\n'
    )
    expect(readTomlTopNumber(written, CODEX_COMPACT_KEY)).toBe(240_000)
    expect(writeTomlTopNumber(written, CODEX_COMPACT_KEY, null)).toBe(original)
    expect(
      readTomlTopNumber(
        "[a]\nmodel_auto_compact_token_limit = 5\n",
        CODEX_COMPACT_KEY
      )
    ).toBeNull()
  })
})
