import { describe, expect, it } from "vite-plus/test"

import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import {
  buildPullRequestRows,
  getInitialPullRequestStage,
  getNextTestCount,
  getPullRequestCard,
  isPullRequestToolPart
} from "@/renderer/lib/chat/pull-request-card"
import { PULL_REQUEST_SAMPLE } from "@/shared/chat/pull-request"

const card = PULL_REQUEST_SAMPLE
const rowFor = (rows: ReturnType<typeof buildPullRequestRows>, sha: string) =>
  rows.find((row) => row.commit.sha === sha)

describe("pull request tool parts", () => {
  it("recognizes static and dynamic pull_request parts", () => {
    expect(isPullRequestToolPart({ type: "tool-pull_request" })).toBe(true)
    expect(
      isPullRequestToolPart({ toolName: "pull_request", type: "dynamic-tool" })
    ).toBe(true)
    expect(isPullRequestToolPart({ type: "tool-imagen" })).toBe(false)
    expect(isPullRequestToolPart(null)).toBe(false)
  })

  it("reads the card only from a finished, valid output", () => {
    const part = {
      output: card,
      state: "output-available",
      toolCallId: "pr-1",
      type: "tool-pull_request"
    } as unknown as ChatToolPart

    expect(getPullRequestCard(part)?.number).toBe(128)
    expect(
      getPullRequestCard({ ...part, state: "input-available" } as ChatToolPart)
    ).toBeNull()
    expect(
      getPullRequestCard({ ...part, output: { number: 1 } } as ChatToolPart)
    ).toBeNull()
  })
})

describe("pull request stages", () => {
  it("plays the merge check only for a live card", () => {
    expect(getInitialPullRequestStage(card, true)).toBe("checking")
    expect(getInitialPullRequestStage(card, false)).toBe("conflicts")
    expect(getInitialPullRequestStage({ ...card, conflicts: [] }, false)).toBe(
      "ready"
    )
  })

  it("caps the simulated test count at the total", () => {
    expect(getNextTestCount(0, 42)).toBe(3)
    expect(getNextTestCount(41, 42)).toBe(42)
  })
})

describe("buildPullRequestRows", () => {
  it("adds the merge commit once resolving starts and moves the branch label to it", () => {
    const before = buildPullRequestRows({
      card,
      resolved: 0,
      stage: "conflicts"
    })
    const after = buildPullRequestRows({
      card,
      resolved: 0,
      stage: "resolving"
    })

    expect(before).toHaveLength(card.commits.length)
    expect(after).toHaveLength(card.commits.length + 1)
    expect(after[0]?.isMergeCommit).toBe(true)
    expect(after[0]?.dot).toBe("ring")
    expect(rowFor(before, "d29f50")?.showBranch).toBe(true)
    expect(rowFor(after, "d29f50")?.showBranch).toBe(false)
  })

  it("clears each conflicting commit once its hunks are resolved, in order", () => {
    const atOne = buildPullRequestRows({
      card,
      resolved: 1,
      stage: "resolving"
    })

    expect(rowFor(atOne, "5be27d")).toMatchObject({
      resolved: true,
      tone: "muted"
    })
    expect(rowFor(atOne, "a3f9c1")).toMatchObject({
      badge: 2,
      dot: "conflict",
      resolved: false,
      tone: "conflict"
    })

    const atThree = buildPullRequestRows({
      card,
      resolved: 3,
      stage: "resolving"
    })

    expect(rowFor(atThree, "a3f9c1")).toMatchObject({ resolved: true })
    expect(rowFor(atThree, "a3f9c1")?.badge).toBeUndefined()
  })

  it("draws the fork at the last commit and starts the side lane at its tip", () => {
    const rows = buildPullRequestRows({ card, resolved: 0, stage: "conflicts" })
    const last = rows.at(-1)

    expect(last?.paths.baseDashed).not.toBe("")
    expect(last?.paths.side).toContain("C")
    expect(rowFor(rows, "e83c51")?.paths.side).toBe("M36 15 V30")
    expect(rowFor(rows, "c70a92")?.paths.side).toBe("")
  })

  it("turns the head branch violet once merged", () => {
    const rows = buildPullRequestRows({ card, resolved: 3, stage: "merged" })

    expect(rows[0]?.dot).toBe("ring-merged")
    expect(rowFor(rows, "c70a92")).toMatchObject({
      dot: "merged",
      highlight: "merged"
    })
    expect(rowFor(rows, "9c2d4a")?.dot).toBe("base")
  })
})
