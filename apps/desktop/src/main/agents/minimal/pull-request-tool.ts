import { tool } from "ai"
import { z } from "zod"

import { PULL_REQUEST_SAMPLE } from "@/shared/chat/pull-request"
import type { PullRequestCard } from "@/shared/chat/pull-request"

/**
 * Shows the PR merge card in the chat. Development preview: it returns sample
 * data (see shared/chat/pull-request.ts) and reads neither git nor GitHub, so
 * the toolset only offers it in development builds.
 */

const PullRequestInputSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("PR title shown on the card; omit to keep the sample's title.")
  })
  .strict()

export const buildPullRequestTool = () =>
  tool({
    description:
      "Show a pull request merge card in the chat: commit graph, conflicts with the base branch, checks, and resolve/merge buttons. Development preview with sample data; call it when the user asks to create or show a PR.",
    execute: ({ title }): PullRequestCard => ({
      ...PULL_REQUEST_SAMPLE,
      ...(title ? { title } : {})
    }),
    inputSchema: PullRequestInputSchema
  })
