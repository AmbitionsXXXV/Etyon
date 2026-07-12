import { and, eq, inArray } from "drizzle-orm"

import type { AppDatabase } from "@/main/db"
import { agentRuns, agentToolCalls } from "@/main/db/schema"

const EDITED_TOOL_NAMES = ["edit", "write"] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const parseJson = (value: string | null): unknown => {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const getPathFromJson = (value: string | null): string | null => {
  const parsedValue = parseJson(value)

  if (!isRecord(parsedValue) || typeof parsedValue.path !== "string") {
    return null
  }

  const filePath = parsedValue.path.trim()

  return filePath || null
}

const getEditedPath = ({
  inputJson,
  outputJson
}: {
  inputJson: string
  outputJson: string | null
}): string | null => getPathFromJson(inputJson) ?? getPathFromJson(outputJson)

/**
 * Lists the project-relative files written by completed edit/write tool calls.
 * One joined query covers every requested chat session so sidebar polling does
 * not create per-session database work.
 */
export const listAgentEditedPathsBySession = async ({
  db,
  sessionIds
}: {
  db: AppDatabase
  sessionIds: string[]
}): Promise<Map<string, string[]>> => {
  if (sessionIds.length === 0) {
    return new Map()
  }

  const rows = await db
    .select({
      chatSessionId: agentRuns.chatSessionId,
      inputJson: agentToolCalls.inputJson,
      outputJson: agentToolCalls.outputJson
    })
    .from(agentToolCalls)
    .innerJoin(agentRuns, eq(agentToolCalls.runId, agentRuns.id))
    .where(
      and(
        eq(agentToolCalls.state, "finished"),
        inArray(agentRuns.chatSessionId, sessionIds),
        inArray(agentToolCalls.toolName, EDITED_TOOL_NAMES)
      )
    )
  const pathsBySession = new Map<string, Set<string>>()

  for (const row of rows) {
    const editedPath = getEditedPath(row)

    if (!editedPath) {
      continue
    }

    const sessionPaths = pathsBySession.get(row.chatSessionId) ?? new Set()

    sessionPaths.add(editedPath)
    pathsBySession.set(row.chatSessionId, sessionPaths)
  }

  return new Map(
    [...pathsBySession].map(([sessionId, paths]) => [
      sessionId,
      [...paths].toSorted()
    ])
  )
}
