import { setTimeout as sleepFor } from "node:timers/promises"

/**
 * Direct client for amux's task API (https://amux.ai/api-reference): gpt-image
 * keyframes through `POST /v1/tasks`, Seedance clips through the Ark-shaped
 * `POST /api/v3/contents/generations/tasks`, and both read back through the
 * unified `GET /v1/tasks/{id}` (which also reports usage and cost).
 *
 * Pure apart from the injected fetch, so it is node-testable.
 */

export type AmuxTaskStatus =
  | "canceled"
  | "expired"
  | "failed"
  | "queued"
  | "running"
  | "succeeded"

export interface AmuxTask {
  cost?: string
  error?: string
  id: string
  imageUrls: string[]
  model?: string
  status: AmuxTaskStatus
  videoUrls: string[]
}

export class AmuxApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "AmuxApiError"
    this.status = status
  }
}

const TERMINAL_STATUSES: ReadonlySet<AmuxTaskStatus> = new Set([
  "canceled",
  "expired",
  "failed",
  "succeeded"
])

export const isTerminalAmuxStatus = (status: AmuxTaskStatus): boolean =>
  TERMINAL_STATUSES.has(status)

// amux spells it `canceled` on /v1/tasks and `cancelled` on the Ark alias.
const normalizeStatus = (status: unknown): AmuxTaskStatus => {
  switch (status) {
    case "succeeded":
    case "failed":
    case "expired":
    case "running":
    case "queued": {
      return status
    }
    case "canceled":
    case "cancelled": {
      return "canceled"
    }
    default: {
      return "running"
    }
  }
}

const TRAILING_SLASHES_PATTERN = /\/+$/u

/** The provider base URL is amux's `/v1`; Seedance lives under the origin. */
export const resolveAmuxEndpoints = (baseURL: string) => {
  const v1 = baseURL.trim().replace(TRAILING_SLASHES_PATTERN, "")

  return {
    seedanceTasks: `${new URL(v1).origin}/api/v3/contents/generations/tasks`,
    task: (id: string) => `${v1}/tasks/${encodeURIComponent(id)}`,
    tasks: `${v1}/tasks`
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const readUrls = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter(isRecord)
        .map((item) => item.url)
        .filter((url): url is string => typeof url === "string")
    : []

export const parseAmuxTask = (body: unknown): AmuxTask => {
  if (!isRecord(body) || typeof body.id !== "string") {
    throw new Error("amux returned a task without an id.")
  }

  const output = isRecord(body.output) ? body.output : {}
  const content = isRecord(body.content) ? body.content : {}
  const errorMessage = isRecord(body.error) ? body.error.message : undefined
  const videoUrls = readUrls(output.videos)

  // The Ark-shaped alias carries the clip as `content.video_url`.
  if (typeof content.video_url === "string") {
    videoUrls.push(content.video_url)
  }

  return {
    ...(typeof body.cost === "string" ? { cost: body.cost } : {}),
    ...(typeof errorMessage === "string" && errorMessage
      ? { error: errorMessage }
      : {}),
    id: body.id,
    imageUrls: readUrls(output.images),
    ...(typeof body.model === "string" ? { model: body.model } : {}),
    status: normalizeStatus(body.status),
    videoUrls
  }
}

export type SeedanceResolution = "1080p" | "480p" | "4k" | "720p"
export type SeedanceRatio =
  | "1:1"
  | "16:9"
  | "21:9"
  | "3:4"
  | "4:3"
  | "9:16"
  | "adaptive"

export interface SeedanceTaskInput {
  /** Seconds, or -1 to let the model choose. */
  duration: number
  /** Public HTTPS URLs; amux does not fetch local data. */
  firstFrameUrl?: string
  generateAudio: boolean
  lastFrameUrl?: string
  model: string
  prompt: string
  ratio: SeedanceRatio
  referenceImageUrls?: string[]
  /** Existing clips to edit or extend (Seedance 2.5 omni-reference). */
  referenceVideoUrls?: string[]
  resolution: SeedanceResolution
  taskType?: "edit" | "extend"
}

/**
 * The Ark task body amux accepts. Roles are always explicit (a missing role is
 * a 400 except for a lone image), frames and references never mix, `seed` is
 * never sent (amux rejects it), and Seedance 2.5 with frames forces `adaptive`.
 */
export const buildSeedanceTaskBody = (input: SeedanceTaskInput) => {
  const hasFrames = Boolean(input.firstFrameUrl || input.lastFrameUrl)
  const content: Record<string, unknown>[] = []

  if (input.prompt.trim()) {
    content.push({ text: input.prompt, type: "text" })
  }

  if (input.firstFrameUrl) {
    content.push({
      image_url: { url: input.firstFrameUrl },
      role: "first_frame",
      type: "image_url"
    })
  }

  if (input.lastFrameUrl) {
    content.push({
      image_url: { url: input.lastFrameUrl },
      role: "last_frame",
      type: "image_url"
    })
  }

  if (!hasFrames) {
    for (const url of input.referenceImageUrls ?? []) {
      content.push({
        image_url: { url },
        role: "reference_image",
        type: "image_url"
      })
    }

    for (const url of input.referenceVideoUrls ?? []) {
      content.push({
        role: "reference_video",
        type: "video_url",
        video_url: { url }
      })
    }
  }

  // Seedance 2.5 takes only `adaptive` with a first frame and for edit/extend.
  const forcesAdaptive =
    Boolean(input.taskType) ||
    (hasFrames && input.model.includes("seedance-2.5"))

  return {
    content,
    duration: input.duration,
    generate_audio: input.generateAudio,
    model: input.model,
    ...(input.taskType ? { omni_reference_task_type: input.taskType } : {}),
    ratio: forcesAdaptive ? "adaptive" : input.ratio,
    resolution: input.resolution
  }
}

export interface AmuxImageInput {
  bytes: Uint8Array
  fileName: string
  mediaType: string
}

export interface ImageTaskInput {
  images?: AmuxImageInput[]
  model: string
  n?: number
  prompt: string
  size?: string
}

export interface AmuxClientOptions {
  apiKey: string
  baseURL: string
  fetch: typeof globalThis.fetch
}

const readErrorMessage = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => "")

  try {
    const body: unknown = JSON.parse(text)
    const error = isRecord(body) && isRecord(body.error) ? body.error : null

    if (error && typeof error.message === "string") {
      return error.message
    }
  } catch {
    // Not JSON — fall back to the raw text.
  }

  return text.slice(0, 300) || response.statusText
}

const describeFailure = (status: number, message: string): string => {
  if (status === 402) {
    return `amux balance is too low for this task (${message}).`
  }

  if (status === 503) {
    return `amux has no capacity for this model right now (${message}).`
  }

  return `amux request failed: ${status} ${message}`
}

const readId = (body: unknown): string => {
  if (!isRecord(body) || typeof body.id !== "string") {
    throw new Error("amux accepted the task but returned no id.")
  }

  return body.id
}

export const createAmuxClient = ({
  apiKey,
  baseURL,
  fetch
}: AmuxClientOptions) => {
  const endpoints = resolveAmuxEndpoints(baseURL)
  const authorization = { Authorization: `Bearer ${apiKey}` }

  const request = async (
    url: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<unknown> => {
    const response = await fetch(url, {
      ...init,
      ...(signal ? { signal } : {})
    })

    if (!response.ok) {
      throw new AmuxApiError(
        response.status,
        describeFailure(response.status, await readErrorMessage(response))
      )
    }

    return response.json()
  }

  return {
    createImageTask: async (
      input: ImageTaskInput,
      signal?: AbortSignal
    ): Promise<string> => {
      // Reference images go up as files: the docs only show multipart for them.
      if (input.images && input.images.length > 0) {
        const form = new FormData()

        form.set("model", input.model)
        form.set("prompt", input.prompt)

        if (input.size) {
          form.set("size", input.size)
        }

        if (input.n) {
          form.set("n", String(input.n))
        }

        for (const image of input.images) {
          form.append(
            "image",
            new Blob([new Uint8Array(image.bytes)], { type: image.mediaType }),
            image.fileName
          )
        }

        return readId(
          await request(
            endpoints.tasks,
            { body: form, headers: authorization, method: "POST" },
            signal
          )
        )
      }

      return readId(
        await request(
          endpoints.tasks,
          {
            body: JSON.stringify({
              model: input.model,
              prompt: input.prompt,
              ...(input.n ? { n: input.n } : {}),
              ...(input.size ? { size: input.size } : {})
            }),
            headers: { ...authorization, "Content-Type": "application/json" },
            method: "POST"
          },
          signal
        )
      )
    },
    createSeedanceTask: async (
      input: SeedanceTaskInput,
      signal?: AbortSignal
    ): Promise<string> =>
      readId(
        await request(
          endpoints.seedanceTasks,
          {
            body: JSON.stringify(buildSeedanceTaskBody(input)),
            headers: { ...authorization, "Content-Type": "application/json" },
            method: "POST"
          },
          signal
        )
      ),
    getTask: async (id: string, signal?: AbortSignal): Promise<AmuxTask> =>
      parseAmuxTask(
        await request(
          endpoints.task(id),
          { headers: authorization, method: "GET" },
          signal
        )
      )
  }
}

export type AmuxClient = ReturnType<typeof createAmuxClient>

// amux: images finish in 15-120 s and want a poll every 2-5 s; a clip spends
// most of its time queued, so wait 20 s before the first look, then 10-15 s.
export const AMUX_POLL_POLICY = {
  image: { firstDelayMs: 3000, intervalMs: 3000 },
  video: { firstDelayMs: 20_000, intervalMs: 12_000 }
} as const

const delay = async (ms: number, signal?: AbortSignal): Promise<void> => {
  await sleepFor(ms, undefined, signal ? { signal } : {})
}

/**
 * Polls a task until it is terminal. Status updates go to `onUpdate` (the
 * caller persists them); aborting stops the wait, not the task on amux.
 */
export const waitForAmuxTask = async ({
  client,
  id,
  kind,
  onUpdate,
  signal,
  sleep = delay
}: {
  client: Pick<AmuxClient, "getTask">
  id: string
  kind: "image" | "video"
  onUpdate?: (task: AmuxTask) => Promise<void> | void
  signal?: AbortSignal
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}): Promise<AmuxTask> => {
  const policy = AMUX_POLL_POLICY[kind]

  await sleep(policy.firstDelayMs, signal)

  for (;;) {
    const task = await client.getTask(id, signal)

    await onUpdate?.(task)

    if (isTerminalAmuxStatus(task.status)) {
      return task
    }

    await sleep(policy.intervalMs, signal)
  }
}
