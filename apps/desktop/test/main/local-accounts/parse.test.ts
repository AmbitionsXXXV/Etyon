import { describe, expect, it } from "vite-plus/test"

import {
  parseClaudeAuthStatus,
  parseClaudeUsage,
  parseCodexAuth,
  parseCodexUsage
} from "@/main/local-accounts/parse"

const jwt = (payload: Record<string, unknown>): string =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`

const USAGE_TEXT = `You are currently using your subscription to power your Claude Code usage

Current session: 10% used · resets Oct 16 at 2:10am (Asia/Tokyo)
Current week (all models): 56% used · resets Oct 17 at 6am (Asia/Tokyo)
Current week (Fable): 0% used

What's contributing to your limits usage?`

describe("parseClaudeAuthStatus", () => {
  it("reads a signed-in status and a signed-out one", () => {
    expect(
      parseClaudeAuthStatus(
        JSON.stringify({
          email: "me@example.com",
          loggedIn: true,
          orgName: "Acme",
          subscriptionType: "max"
        })
      )
    ).toEqual({
      email: "me@example.com",
      loggedIn: true,
      organization: "Acme",
      plan: "max"
    })
    expect(parseClaudeAuthStatus('{"loggedIn":false}')?.loggedIn).toBe(false)
    expect(parseClaudeAuthStatus("not json")).toBeNull()
  })
})

describe("parseClaudeUsage", () => {
  it("reads the session and weekly windows from /usage", () => {
    const reading = parseClaudeUsage(JSON.stringify({ result: USAGE_TEXT }))
    expect(reading.error).toBeNull()
    expect(reading.windows).toEqual([
      {
        resetsAt: null,
        resetsText: "Oct 16 at 2:10am (Asia/Tokyo)",
        scope: null,
        spanSeconds: 18_000,
        usedPercent: 10
      },
      {
        resetsAt: null,
        resetsText: "Oct 17 at 6am (Asia/Tokyo)",
        scope: null,
        spanSeconds: 604_800,
        usedPercent: 56
      },
      {
        resetsAt: null,
        resetsText: null,
        scope: "Fable",
        spanSeconds: 604_800,
        usedPercent: 0
      }
    ])
  })

  it("reports an account problem before any partial reading", () => {
    const reading = parseClaudeUsage(
      JSON.stringify([
        { type: "system" },
        {
          result: "Current session: 5% used\nError: 401 unauthorized",
          type: "result"
        }
      ])
    )
    expect(reading.windows).toEqual([])
    expect(reading.error).toContain("401")
  })
})

describe("parseCodexAuth", () => {
  it("reads plan, account, and expiry from the tokens", () => {
    const login = parseCodexAuth(
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: jwt({ exp: 2_000_000_000 }),
          account_id: "",
          id_token: jwt({
            email: "me@example.com",
            "https://api.openai.com/auth": {
              chatgpt_account_id: "acct-1",
              chatgpt_plan_type: "pro",
              chatgpt_subscription_active_until: "2026-12-01T00:00:00Z"
            }
          })
        }
      })
    )
    expect(login).toMatchObject({
      accessTokenExpiresAt: 2_000_000_000_000,
      accountId: "acct-1",
      email: "me@example.com",
      plan: "pro",
      subscriptionUntil: "2026-12-01T00:00:00Z"
    })
  })

  it("treats an API-key login as no subscription", () => {
    expect(
      parseCodexAuth(
        JSON.stringify({ auth_mode: "apikey", tokens: { access_token: "x" } })
      )
    ).toBeNull()
  })
})

describe("parseCodexUsage", () => {
  it("reads both windows and leftover credits", () => {
    const now = Date.parse("2026-10-15T00:00:00Z")
    expect(
      parseCodexUsage(
        {
          credits: { balance: "12.345", has_credits: true, unlimited: false },
          plan_type: "pro",
          rate_limit: {
            primary_window: {
              limit_window_seconds: 18_000,
              reset_after_seconds: 3600,
              used_percent: 37
            },
            secondary_window: {
              limit_window_seconds: 604_800,
              reset_at: 1_760_572_800,
              used_percent: 12
            }
          }
        },
        now
      )
    ).toEqual({
      credits: "12.35",
      plan: "pro",
      windows: [
        {
          resetsAt: "2026-10-15T01:00:00.000Z",
          resetsText: null,
          scope: null,
          spanSeconds: 18_000,
          usedPercent: 37
        },
        {
          resetsAt: new Date(1_760_572_800_000).toISOString(),
          resetsText: null,
          scope: null,
          spanSeconds: 604_800,
          usedPercent: 12
        }
      ]
    })
  })
})
