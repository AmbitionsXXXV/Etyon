import { randomUUID } from "node:crypto"

import type { UIMessage } from "ai"
import { eq, inArray } from "drizzle-orm"

import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { ensureGitignored } from "@/main/agents/minimal/workspace-gitignore"
import { createAmuxClient, waitForAmuxTask } from "@/main/amux/amux-client"
import type { AmuxClient, AmuxTask } from "@/main/amux/amux-client"
import {
  listChatMessages,
  persistSubmittedChatMessages
} from "@/main/chat-messages"
import { getDb } from "@/main/db"
import { mediaTasks } from "@/main/db/schema"
import { runExclusiveDbWrite } from "@/main/db/write-lock"
import { logger } from "@/main/logger"
import { createProxyAwareFetch } from "@/main/proxy/proxy-fetch"
import { slugifyImageTitle } from "@/main/server/lib/image-generation"
import { getSettings } from "@/main/settings"
import { resolveProviderBaseURL } from "@/shared/providers/provider-catalog"

/**
 * Runs amux media tasks so they outlive the request that started them. Every
 * task becomes a `media_tasks` row the moment amux accepts it; the row tracks
 * status and cost, and on success the outputs are downloaded into the project
 * (amux clears its copies on a schedule). Rows still open at startup, or whose
 * request went away, are finished in the background and handed to their owner.
 */

export type MediaTaskKind = "image" | "video"

/** Who waits for a task: a chat tool part the result gets written into. */
export interface MediaTaskOwner {
  kind: "chat-tool"
  sessionId: string
  /**
   * Only the task whose output IS the part's result settles it on resume; a
   * preparatory task (the first-frame upload) can only report that the run
   * stopped before the render began.
   */
  settlesPart: boolean
  /** Built into the tool output when a resumed render finishes. */
  title: string
  toolCallId: string
  toolType: string
}

export interface FinishedMediaTask {
  localPaths: string[]
  task: AmuxTask
}

const OUTPUT_DIR: Record<MediaTaskKind, string> = {
  image: "generated-frames",
  video: "generated-videos"
}

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov"
}

const OPEN_STATUSES = ["queued", "running"] as const
const RANDOM_SUFFIX_LENGTH = 8

// The provider whose key and base URL reach amux: the Amux provider, or an
// OpenAI provider pointed at amux.
export type AmuxProviderId = "amux" | "openai"

export const getAmuxClient = (providerId: AmuxProviderId): AmuxClient => {
  const { ai, proxy } = getSettings()
  const config = ai.providers[providerId]
  const apiKey = config.apiKey.trim()

  if (!config.enabled) {
    throw new Error(`Provider "${providerId}" is disabled.`)
  }

  if (!apiKey) {
    throw new Error(`Provider "${providerId}" is missing an API Key.`)
  }

  return createAmuxClient({
    apiKey,
    baseURL: resolveProviderBaseURL(providerId, config),
    fetch: createProxyAwareFetch(proxy)
  })
}

const now = (): string => new Date().toISOString()

const updateRow = async (
  id: string,
  patch: Partial<typeof mediaTasks.$inferInsert>
): Promise<void> => {
  await runExclusiveDbWrite(() =>
    getDb()
      .update(mediaTasks)
      .set({ ...patch, updatedAt: now() })
      .where(eq(mediaTasks.id, id))
  )
}

const recordStatus = async (task: AmuxTask): Promise<void> => {
  await updateRow(task.id, {
    costText: task.cost ?? null,
    error: task.error ?? null,
    outputUrlsJson: JSON.stringify([...task.imageUrls, ...task.videoUrls]),
    status: task.status
  })
}

const downloadOutputs = async ({
  kind,
  projectPath,
  task,
  title
}: {
  kind: MediaTaskKind
  projectPath: string
  task: AmuxTask
  title: string
}): Promise<string[]> => {
  const fetch = createProxyAwareFetch(getSettings().proxy)
  const workspace = getWorkspaceCore(projectPath)
  const urls = kind === "video" ? task.videoUrls : task.imageUrls
  const paths: string[] = []

  for (const url of urls) {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(
        `Downloading the ${kind} failed: ${response.status} ${response.statusText}`
      )
    }

    const mediaType = response.headers.get("content-type")?.split(";")[0]
    const extension =
      (mediaType ? EXTENSION_BY_MEDIA_TYPE[mediaType] : undefined) ??
      (kind === "video" ? ".mp4" : ".png")
    const relativePath = `${OUTPUT_DIR[kind]}/${slugifyImageTitle(title)}-${randomUUID().slice(0, RANDOM_SUFFIX_LENGTH)}${extension}`
    const written = await workspace.writeBinaryFile(
      relativePath,
      new Uint8Array(await response.arrayBuffer())
    )

    if (!written.ok) {
      throw new Error(`${written.error.message} (${written.error.code})`)
    }

    paths.push(written.value.info.path)
  }

  // Regenerable output, not source: keep it out of the user's git history.
  await ensureGitignored({ entry: `${OUTPUT_DIR[kind]}/`, projectPath })

  return paths
}

const finishTask = async ({
  client,
  id,
  kind,
  projectPath,
  signal,
  title
}: {
  client: AmuxClient
  id: string
  kind: MediaTaskKind
  projectPath: string
  signal?: AbortSignal
  title: string
}): Promise<FinishedMediaTask> => {
  const task = await waitForAmuxTask({
    client,
    id,
    kind,
    onUpdate: recordStatus,
    ...(signal ? { signal } : {})
  })

  if (task.status !== "succeeded") {
    throw new Error(
      task.error ?? `amux ${kind} task ${task.status} (task ${task.id}).`
    )
  }

  const localPaths = await downloadOutputs({ kind, projectPath, task, title })

  await updateRow(id, { localPathsJson: JSON.stringify(localPaths) })

  return { localPaths, task }
}

/**
 * Starts one amux task, records it, and waits for its outputs. When `signal`
 * aborts (the chat request went away) the task keeps running on amux and is
 * finished in the background for its owner.
 */
export const runMediaTask = async ({
  create,
  kind,
  model,
  owner,
  projectPath,
  provider,
  request,
  signal,
  title
}: {
  create: (client: AmuxClient) => Promise<string>
  kind: MediaTaskKind
  model: string
  owner: MediaTaskOwner
  projectPath: string
  provider: AmuxProviderId
  request: unknown
  signal?: AbortSignal
  title: string
}): Promise<FinishedMediaTask> => {
  const client = getAmuxClient(provider)
  const id = await create(client)
  const createdAt = now()

  await runExclusiveDbWrite(() =>
    getDb()
      .insert(mediaTasks)
      .values({
        createdAt,
        id,
        kind,
        model,
        ownerJson: JSON.stringify(owner),
        projectPath,
        provider,
        requestJson: JSON.stringify(request),
        status: "queued",
        updatedAt: createdAt
      })
  )

  try {
    return await finishTask({
      client,
      id,
      kind,
      projectPath,
      ...(signal ? { signal } : {}),
      title
    })
  } catch (error) {
    if (signal?.aborted) {
      void resumeMediaTask(id)
    } else {
      await updateRow(id, {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    throw error
  }
}

/**
 * The finished task behind a chat tool part (a rendered clip), so a later
 * request can reuse its amux URL and provider. Null when the part was never a
 * successful media task.
 */
export const findSucceededMediaTask = async (
  toolCallId: string
): Promise<{ provider: AmuxProviderId; url: string } | null> => {
  const rows = await getDb()
    .select({
      outputUrlsJson: mediaTasks.outputUrlsJson,
      ownerJson: mediaTasks.ownerJson,
      provider: mediaTasks.provider
    })
    .from(mediaTasks)
    .where(eq(mediaTasks.status, "succeeded"))

  for (const row of rows) {
    const owner = parseJson<MediaTaskOwner>(row.ownerJson)
    const [url] = parseJson<string[]>(row.outputUrlsJson) ?? []

    if (owner?.toolCallId === toolCallId && owner.settlesPart && url) {
      return { provider: row.provider === "openai" ? "openai" : "amux", url }
    }
  }

  return null
}

type MessagePart = UIMessage["parts"][number]

// Writes a finished (or failed) result into the owner's tool part, for runs
// whose live stream is gone. A part already settled is left alone.
const settleChatToolPart = async (
  owner: MediaTaskOwner,
  settle: (part: MessagePart) => MessagePart
): Promise<void> => {
  const db = getDb()
  const messages = await listChatMessages({ db, sessionId: owner.sessionId })
  let changed = false
  const nextMessages = messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      const toolPart = part as { state?: string; toolCallId?: string }

      if (
        toolPart.toolCallId !== owner.toolCallId ||
        part.type !== owner.toolType ||
        toolPart.state !== "input-available"
      ) {
        return part
      }

      changed = true

      return settle(part)
    })
  }))

  if (changed) {
    await persistSubmittedChatMessages({
      db,
      messages: nextMessages,
      sessionId: owner.sessionId
    })
  }
}

const parseJson = <TValue>(text: string | null): TValue | null => {
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as TValue
  } catch {
    return null
  }
}

/** Finishes one open task in the background and settles its owner's part. */
export const resumeMediaTask = async (id: string): Promise<void> => {
  const [row] = await getDb()
    .select()
    .from(mediaTasks)
    .where(eq(mediaTasks.id, id))
    .limit(1)
  const owner = parseJson<MediaTaskOwner>(row?.ownerJson ?? null)
  const request = parseJson<{ output?: Record<string, unknown> }>(
    row?.requestJson ?? null
  )

  if (!(row && owner)) {
    return
  }

  if (!owner.settlesPart) {
    // Closed so startup stops picking it up; amux may still finish it.
    await updateRow(id, {
      error: "Stopped before the render started.",
      status: "failed"
    })
    await settleChatToolPart(
      owner,
      (part) =>
        ({
          ...part,
          errorText:
            "Etyon stopped before the clip started rendering. Send it again.",
          state: "output-error"
        }) as MessagePart
    )
    return
  }

  try {
    const { localPaths, task } = await finishTask({
      client: getAmuxClient(row.provider === "openai" ? "openai" : "amux"),
      id,
      kind: row.kind,
      projectPath: row.projectPath,
      title: owner.title
    })

    await settleChatToolPart(
      owner,
      (part) =>
        ({
          ...part,
          output: {
            ...request?.output,
            ...(task.cost ? { cost: task.cost } : {}),
            path: localPaths[0] ?? ""
          },
          state: "output-available"
        }) as MessagePart
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await updateRow(id, { error: message })
    await settleChatToolPart(
      owner,
      (part) =>
        ({
          ...part,
          errorText: message,
          state: "output-error"
        }) as MessagePart
    )
    logger.error("media_task_resume_failed", { error, task_id: id })
  }
}

/** Startup: pick up every task left open by a previous run of the app. */
export const resumeOpenMediaTasks = async (): Promise<void> => {
  try {
    const rows = await getDb()
      .select({ id: mediaTasks.id })
      .from(mediaTasks)
      .where(inArray(mediaTasks.status, [...OPEN_STATUSES]))

    for (const row of rows) {
      void resumeMediaTask(row.id)
    }
  } catch (error) {
    logger.error("media_tasks_resume_failed", { error })
  }
}
