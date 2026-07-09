import { tool } from "ai"
import { z } from "zod"

import type { AppDatabase } from "@/main/db"
import { buildMemorySystemPrompt, saveAgentMemoryNote } from "@/main/memory"
import { getSettings } from "@/main/settings"

/**
 * On-demand memory tools for the file agent. The project digest (always
 * included in the system prompt) is the free tier; these are the expensive
 * tier — a live search or a save, each a real network round trip — so they
 * only run when the agent itself decides it needs them, not on every turn.
 * Callers gate whether these are registered at all on `settings.memory.
 * enabled`, so execution here doesn't re-check that flag.
 */

const SearchMemoryInputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .describe(
        "What to recall. Use for a specific past detail the project memory digest doesn't cover."
      )
  })
  .strict()

const SaveMemoryInputSchema = z
  .object({
    content: z
      .string()
      .min(1)
      .describe(
        "The fact, decision, or preference to remember, written so it makes sense out of context."
      )
  })
  .strict()

export interface MemoryToolsContext {
  db: AppDatabase
  projectPath: string
}

export const buildSearchMemoryTool = ({
  db,
  projectPath
}: MemoryToolsContext) =>
  tool({
    description:
      "Search long-term memory (past sessions and saved notes) for a specific detail the project memory digest already in context doesn't cover. Costs a network round trip — use only when you actually need it.",
    execute: async ({ query }, context) => {
      const settings = getSettings()
      const result = await buildMemorySystemPrompt({
        db,
        projectPath,
        query,
        settings: settings.memory,
        ...(context?.abortSignal ? { abortSignal: context.abortSignal } : {})
      })

      return result || "No relevant memories found."
    },
    inputSchema: SearchMemoryInputSchema
  })

export const buildSaveMemoryTool = ({ db, projectPath }: MemoryToolsContext) =>
  tool({
    description:
      "Save a specific fact, decision, or user preference to long-term memory for future sessions. Use for things worth remembering beyond this conversation, not routine chat content.",
    execute: async ({ content }) => {
      const entry = await saveAgentMemoryNote({ content, db, projectPath })

      return { saved: Boolean(entry) }
    },
    inputSchema: SaveMemoryInputSchema
  })
