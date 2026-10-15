import { findSucceededMediaTask, runMediaTask } from "@/main/amux/media-tasks"
import type { AmuxProviderId, MediaTaskOwner } from "@/main/amux/media-tasks"
import { createProxyAwareFetch } from "@/main/proxy/proxy-fetch"
import { getSettings } from "@/main/settings"
import { VIDEO_EDIT_MODEL } from "@/shared/chat/video-tools"
import type { VideoChoices, VideoEditRequest } from "@/shared/chat/video-tools"

/**
 * Video skill core on amux. Seedance only takes media as public HTTPS URLs and
 * amux has no upload endpoint, so a user's own image first goes through a
 * gpt-image edit task, whose hosted output URL then feeds the clip. Both steps
 * are media tasks: they survive the request, and the clip lands under
 * generated-videos/.
 */

// The image model that re-hosts a user's image on amux, and how it is asked to
// leave the picture alone.
export const AMUX_FRAME_HOST_MODEL = "openai/gpt-image-2"
const FRAME_HOST_PROMPT =
  "Return this exact image unchanged: same composition, framing, colors, and details."

export interface VideoImageInput {
  bytes: Uint8Array
  mediaType: string
  use: "first_frame" | "reference"
}

export interface GenerateAndPersistVideoResult {
  choices: VideoChoices
  cost?: string
  kind: "video"
  model: string
  path: string
  prompt: string
  title: string
}

type ChatOwner = Omit<MediaTaskOwner, "settlesPart">

const getBareModelId = (compoundId: string): string => {
  const slashIndex = compoundId.indexOf("/")

  return slashIndex === -1 ? compoundId : compoundId.slice(slashIndex + 1)
}

// The route only admits video models on amux-backed providers, so the prefix
// is "amux" or "openai".
export const getAmuxProviderId = (compoundId: string): AmuxProviderId =>
  compoundId.startsWith("openai/") ? "openai" : "amux"

const FILE_EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
}

const hostImageOnAmux = async ({
  image,
  owner,
  projectPath,
  provider,
  signal,
  title
}: {
  image: VideoImageInput
  owner: ChatOwner
  projectPath: string
  provider: AmuxProviderId
  signal?: AbortSignal
  title: string
}): Promise<string> => {
  const { task } = await runMediaTask({
    create: (client) =>
      client.createImageTask(
        {
          images: [
            {
              bytes: image.bytes,
              fileName: `frame.${FILE_EXTENSION_BY_MEDIA_TYPE[image.mediaType] ?? "png"}`,
              mediaType: image.mediaType
            }
          ],
          model: AMUX_FRAME_HOST_MODEL,
          prompt: FRAME_HOST_PROMPT
        },
        signal
      ),
    kind: "image",
    model: AMUX_FRAME_HOST_MODEL,
    owner: { ...owner, settlesPart: false },
    projectPath,
    provider,
    request: { purpose: "host-first-frame" },
    ...(signal ? { signal } : {}),
    title: `${title} frame`
  })
  const [url] = task.imageUrls

  if (!url) {
    throw new Error("amux hosted the image but returned no URL.")
  }

  return url
}

export const generateAndPersistVideo = async ({
  abortSignal,
  choices,
  frameUrls,
  image,
  owner,
  projectPath,
  prompt,
  title
}: {
  abortSignal?: AbortSignal
  choices: VideoChoices
  /** Already-hosted first and last frames (a storyboard's keyframes). */
  frameUrls?: { first: string; last: string }
  image?: VideoImageInput
  owner: ChatOwner
  projectPath: string
  prompt: string
  title: string
}): Promise<GenerateAndPersistVideoResult> => {
  const model = getBareModelId(choices.model)
  const provider = getAmuxProviderId(choices.model)
  const hostedImageUrl = image
    ? await hostImageOnAmux({
        image,
        owner,
        projectPath,
        provider,
        ...(abortSignal ? { signal: abortSignal } : {}),
        title
      })
    : undefined
  const output = { choices, kind: "video" as const, model, prompt, title }
  const seedanceInput = {
    duration: choices.duration,
    ...(hostedImageUrl && image?.use === "first_frame"
      ? { firstFrameUrl: hostedImageUrl }
      : {}),
    ...(frameUrls
      ? { firstFrameUrl: frameUrls.first, lastFrameUrl: frameUrls.last }
      : {}),
    generateAudio: choices.generateAudio,
    model,
    prompt,
    ratio: choices.ratio,
    ...(hostedImageUrl && image?.use === "reference"
      ? { referenceImageUrls: [hostedImageUrl] }
      : {}),
    resolution: choices.resolution
  }
  const { localPaths, task } = await runMediaTask({
    create: (client) => client.createSeedanceTask(seedanceInput, abortSignal),
    kind: "video",
    model,
    owner: { ...owner, settlesPart: true },
    projectPath,
    provider,
    // `output` is what a resumed render writes into the chat part.
    request: { output, seedance: seedanceInput },
    ...(abortSignal ? { signal: abortSignal } : {}),
    title
  })
  const [path] = localPaths

  if (!path) {
    throw new Error("The clip finished but amux returned no video URL.")
  }

  return { ...output, ...(task.cost ? { cost: task.cost } : {}), path }
}

export interface EditAndPersistVideoResult {
  cost?: string
  kind: "video"
  mode: VideoEditRequest["mode"]
  model: string
  path: string
  prompt: string
  title: string
}

/**
 * Edits or extends a clip Etyon rendered earlier. Seedance reads the source
 * through its amux URL, which amux clears on a schedule, so the URL is checked
 * before a paid task is started.
 */
export const editAndPersistVideo = async ({
  abortSignal,
  edit,
  owner,
  projectPath,
  prompt,
  title
}: {
  abortSignal?: AbortSignal
  edit: VideoEditRequest
  owner: ChatOwner
  projectPath: string
  prompt: string
  title: string
}): Promise<EditAndPersistVideoResult> => {
  const source = await findSucceededMediaTask(edit.sourceToolCallId)

  if (!source) {
    throw new Error("Only clips rendered in Etyon can be edited or extended.")
  }

  const check = await createProxyAwareFetch(getSettings().proxy)(source.url, {
    method: "HEAD",
    ...(abortSignal ? { signal: abortSignal } : {})
  })

  if (!check.ok) {
    throw new Error(
      "amux no longer stores the original clip (it clears outputs after a while), so it can't be edited or extended."
    )
  }

  const output = {
    kind: "video" as const,
    mode: edit.mode,
    model: VIDEO_EDIT_MODEL,
    prompt,
    title
  }
  const seedanceInput = {
    // An edit keeps the source's length; -1 lets the model match it.
    duration: edit.mode === "extend" ? (edit.duration ?? 5) : -1,
    generateAudio: true,
    model: VIDEO_EDIT_MODEL,
    prompt,
    ratio: "adaptive" as const,
    referenceVideoUrls: [source.url],
    resolution: "720p" as const,
    taskType: edit.mode
  }
  const { localPaths, task } = await runMediaTask({
    create: (client) => client.createSeedanceTask(seedanceInput, abortSignal),
    kind: "video",
    model: VIDEO_EDIT_MODEL,
    owner: { ...owner, settlesPart: true },
    projectPath,
    provider: source.provider,
    request: { output, seedance: seedanceInput },
    ...(abortSignal ? { signal: abortSignal } : {}),
    title
  })
  const [path] = localPaths

  if (!path) {
    throw new Error("The clip finished but amux returned no video URL.")
  }

  return { ...output, ...(task.cost ? { cost: task.cost } : {}), path }
}
