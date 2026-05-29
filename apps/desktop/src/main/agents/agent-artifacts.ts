import fs from "node:fs/promises"

import { recordAgentArtifact } from "@/main/agents/agent-event-store"
import type { AgentArtifact } from "@/main/agents/agent-event-store"
import { summarizeToolResult } from "@/main/agents/truncate"
import type { AppDatabase } from "@/main/db"

interface AgentOutputArtifactRef {
  byteLength?: number | null
  kind: string
  metadata?: Record<string, unknown>
  path: string
}

interface RecordAgentToolOutputArtifactsOptions {
  db: AppDatabase
  output: unknown
  runId: string
  toolCallId: string
  toolName: string
}

export interface AgentArtifactTextContent {
  content: string
  omittedChars: number
  totalChars: number
  truncated: boolean
}

interface ReadAgentArtifactTextContentOptions {
  artifact: AgentArtifact
  maxChars?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const getString = (
  record: Record<string, unknown>,
  key: string
): string | null => {
  const value = record[key]

  return typeof value === "string" && value.trim() ? value : null
}

const getNumber = (
  record: Record<string, unknown>,
  key: string
): number | null => {
  const value = record[key]

  return typeof value === "number" && Number.isFinite(value) ? value : null
}

const getOutputRefArtifact = (
  outputRef: unknown
): AgentOutputArtifactRef | null => {
  if (!isRecord(outputRef)) {
    return null
  }

  const path = getString(outputRef, "path")

  if (!path) {
    return null
  }

  return {
    byteLength: getNumber(outputRef, "byteLength"),
    kind: getString(outputRef, "kind") ?? "command-output",
    metadata: {
      outputRef
    },
    path
  }
}

const getDetailsArtifact = (
  details: unknown
): AgentOutputArtifactRef | null => {
  if (!isRecord(details)) {
    return null
  }

  const path = getString(details, "fullOutputPath")

  if (!path) {
    return null
  }

  return {
    kind: "command-output",
    metadata: {
      details
    },
    path
  }
}

const collectAgentOutputArtifactRefs = (
  output: unknown
): AgentOutputArtifactRef[] => {
  if (!isRecord(output)) {
    return []
  }

  const refs: AgentOutputArtifactRef[] = []
  const outputRef = getOutputRefArtifact(output.outputRef)
  const detailsRef = getDetailsArtifact(output.details)

  if (outputRef) {
    refs.push(outputRef)
  }

  if (detailsRef) {
    refs.push(detailsRef)
  }

  return refs
}

const resolveByteLength = async (
  ref: AgentOutputArtifactRef
): Promise<number | null> => {
  if (typeof ref.byteLength === "number") {
    return ref.byteLength
  }

  try {
    const stats = await fs.stat(ref.path)

    return stats.size
  } catch {
    return null
  }
}

export const recordAgentToolOutputArtifacts = async ({
  db,
  output,
  runId,
  toolCallId,
  toolName
}: RecordAgentToolOutputArtifactsOptions): Promise<AgentArtifact[]> => {
  const refs = collectAgentOutputArtifactRefs(output)
  const seenPaths = new Set<string>()
  const artifacts: AgentArtifact[] = []

  for (const ref of refs) {
    if (seenPaths.has(ref.path)) {
      continue
    }

    seenPaths.add(ref.path)
    artifacts.push(
      await recordAgentArtifact({
        byteLength: await resolveByteLength(ref),
        db,
        kind: ref.kind,
        metadata: {
          ...ref.metadata,
          toolName
        },
        path: ref.path,
        runId,
        toolCallId
      })
    )
  }

  return artifacts
}

export const readAgentArtifactTextContent = async ({
  artifact,
  maxChars
}: ReadAgentArtifactTextContentOptions): Promise<AgentArtifactTextContent> => {
  const content = await fs.readFile(artifact.path, "utf-8")

  return summarizeToolResult(content, maxChars)
}
