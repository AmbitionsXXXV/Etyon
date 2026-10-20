import { z } from "zod"

/**
 * The `pull_request` agent tool renders a PR merge card inline in the chat:
 * the PR's commit graph, its conflicts with the base branch, the checks, and
 * the resolve → test → merge flow.
 *
 * First version: the tool returns {@link PULL_REQUEST_SAMPLE} and the card
 * plays the flow locally. Nothing reads git or GitHub yet, so the tool is only
 * offered in development builds.
 */

export const PULL_REQUEST_TOOL_NAME = "pull_request"
export const PULL_REQUEST_TOOL_PART_TYPE =
  `tool-${PULL_REQUEST_TOOL_NAME}` as const

/**
 * Graph lane of a commit: `base` is the branch the PR merges into, `head` the
 * PR's own branch, `side` another branch already merged into the head.
 */
export const PULL_REQUEST_LANES = ["base", "head", "side"] as const

export type PullRequestLane = (typeof PULL_REQUEST_LANES)[number]

export const PullRequestCommitSchema = z
  .object({
    age: z.string(),
    author: z.string(),
    /** Branch label shown next to the title (the tip of that branch). */
    branch: z.string().optional(),
    /** Conflicting hunks this base commit introduces against the head. */
    conflicts: z.number().int().min(1).optional(),
    lane: z.enum(PULL_REQUEST_LANES),
    sha: z.string(),
    title: z.string()
  })
  .strict()

export const PullRequestConflictSchema = z
  .object({
    file: z.string(),
    line: z.number().int().min(1),
    ours: z.string(),
    theirs: z.string()
  })
  .strict()

export const PullRequestCheckSchema = z
  .object({
    /** Longer result shown on hover, e.g. the test runner's summary. */
    detail: z.string().optional(),
    name: z.string(),
    summary: z.string()
  })
  .strict()

export const PullRequestCardSchema = z
  .object({
    additions: z.number().int().min(0),
    baseBranch: z.string(),
    checks: z.array(PullRequestCheckSchema),
    /** Newest first; the last one is where the head branched off the base. */
    commits: z.array(PullRequestCommitSchema).min(1),
    /** Who changed the conflicting lines on the base branch. */
    conflictAuthor: z.string(),
    conflicts: z.array(PullRequestConflictSchema),
    deletions: z.number().int().min(0),
    headBranch: z.string(),
    /** The commit the resolve step adds on top of the head branch. */
    mergeCommit: PullRequestCommitSchema,
    number: z.number().int().min(1),
    testCount: z.number().int().min(0),
    title: z.string()
  })
  .strict()

export type PullRequestCard = z.infer<typeof PullRequestCardSchema>
export type PullRequestCommit = z.infer<typeof PullRequestCommitSchema>

export const PULL_REQUEST_SAMPLE: PullRequestCard = {
  additions: 482,
  baseBranch: "main",
  checks: [
    {
      detail: "vitest · 42 passed, 0 failed · 38s",
      name: "Tests",
      summary: "42 passed"
    },
    { name: "Lint", summary: "passed" },
    { name: "Types", summary: "passed" },
    { name: "Preview", summary: "ready" }
  ],
  commits: [
    {
      age: "now",
      author: "You",
      branch: "feat/session-refresh",
      lane: "head",
      sha: "d29f50",
      title: "Add session refresh tests"
    },
    {
      age: "6m",
      author: "Lena",
      branch: "main",
      conflicts: 1,
      lane: "base",
      sha: "5be27d",
      title: "Read sessions with the current key"
    },
    {
      age: "18m",
      author: "Lena",
      conflicts: 2,
      lane: "base",
      sha: "a3f9c1",
      title: "Rotate session keys"
    },
    {
      age: "25m",
      author: "You",
      lane: "head",
      sha: "c70a92",
      title: "Refresh sessions near expiry"
    },
    {
      age: "32m",
      author: "Sam",
      branch: "feat/checkout-analytics",
      lane: "side",
      sha: "e83c51",
      title: "Add analytics consent banner"
    },
    {
      age: "40m",
      author: "You",
      lane: "head",
      sha: "1f8e3b",
      title: "Read session expiry from the token"
    },
    {
      age: "2h",
      author: "Sam",
      lane: "side",
      sha: "62b0e4",
      title: "Track checkout funnel events"
    },
    {
      age: "3h",
      author: "Sam",
      lane: "base",
      sha: "9c2d4a",
      title: "Bump next to 16.3"
    }
  ],
  conflictAuthor: "Lena Park",
  conflicts: [
    {
      file: "middleware.ts",
      line: 18,
      ours: "if (nearExpiry(session)) await refresh(session)",
      theirs: "const session = await readSession(req, keys)"
    },
    {
      file: "auth.ts",
      line: 42,
      ours: "return refreshIfNear(token, 5 * MINUTE)",
      theirs: "return verify(token, keys.current)"
    },
    {
      file: "auth.ts",
      line: 57,
      ours: "const ttl = session.expiresAt - Date.now()",
      theirs: "const ttl = keys.current.ttl"
    }
  ],
  deletions: 37,
  headBranch: "feat/session-refresh",
  mergeCommit: {
    age: "now",
    author: "You",
    branch: "feat/session-refresh",
    lane: "head",
    sha: "7e0c3b",
    title: "Merge main into feat/session-refresh"
  },
  number: 128,
  testCount: 42,
  title: "Refresh sessions in the auth middleware"
}
