import { z } from "zod"

/**
 * The composer's Video skill is a two-step direct route (no LLM turn):
 *
 * 1. The prompt comes back as a `video_options` input-required tool part. The
 *    renderer shows it as a choices card and answers it with `addToolResult`;
 *    auto-send then resumes the same assistant message.
 * 2. The resumed request finds the answered card and streams a `videogen` tool
 *    part: the render's input while it runs, the saved file as its output.
 *
 * Names, choices, and schemas live in shared so the main-process route, the
 * renderer cards, and the auto-send predicate agree on one source.
 */

export const VIDEO_OPTIONS_TOOL_NAME = "video_options"
export const VIDEOGEN_TOOL_NAME = "videogen"

export const VIDEO_OPTIONS_TOOL_PART_TYPE =
  `tool-${VIDEO_OPTIONS_TOOL_NAME}` as const
export const VIDEOGEN_TOOL_PART_TYPE = `tool-${VIDEOGEN_TOOL_NAME}` as const

// Seconds. 4 is the floor on every Seedance model amux serves (2.0: 4-15 s,
// 2.5: 4-30 s).
export const VIDEO_DURATIONS = [4, 5, 10, 15] as const
export const VIDEO_RATIOS = ["16:9", "9:16", "1:1", "adaptive"] as const
export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const
export const VIDEO_IMAGE_USES = ["first_frame", "reference", "ignore"] as const

export type VideoRatio = (typeof VIDEO_RATIOS)[number]
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number]

/**
 * Resolutions a Seedance model accepts on amux, which rejects the rest with a
 * 400 rather than downgrading. -fast refused 480p in a live run (2026-10-16)
 * though amux's model table lists it; -mini follows that table.
 */
export const getVideoResolutions = (
  compoundModelId: string
): readonly VideoResolution[] => {
  if (compoundModelId.endsWith("seedance-2.0-fast")) {
    return ["720p"]
  }

  if (compoundModelId.endsWith("seedance-2.0-mini")) {
    return ["480p", "720p"]
  }

  return VIDEO_RESOLUTIONS
}
export type VideoImageUse = (typeof VIDEO_IMAGE_USES)[number]

export const VideoChoicesSchema = z
  .object({
    duration: z.union([
      z.literal(4),
      z.literal(5),
      z.literal(10),
      z.literal(15)
    ]),
    generateAudio: z.boolean(),
    imageUse: z.enum(VIDEO_IMAGE_USES),
    model: z.string().min(1),
    ratio: z.enum(VIDEO_RATIOS),
    resolution: z.enum(VIDEO_RESOLUTIONS),
    /** More than one shot turns the render into a storyboard. */
    shots: z
      .union([z.literal(1), z.literal(3), z.literal(4), z.literal(6)])
      .optional()
  })
  .strict()

export type VideoChoices = z.infer<typeof VideoChoicesSchema>

/**
 * Edit or extend a finished clip (Seedance 2.5 with the clip as its reference
 * video). Sent with the chat request that carries the user's instruction.
 */
export const VideoEditRequestSchema = z
  .object({
    /** Seconds of new footage; extend only (an edit keeps the clip's length). */
    duration: z
      .union([z.literal(4), z.literal(5), z.literal(10), z.literal(15)])
      .optional(),
    mode: z.enum(["edit", "extend"]),
    sourceTitle: z.string().max(200),
    sourceToolCallId: z.string().min(1).max(200)
  })
  .strict()

export type VideoEditRequest = z.infer<typeof VideoEditRequestSchema>

/** The model edit and extend run on: the only one with omni-reference. */
export const VIDEO_EDIT_MODEL = "bytedance/seedance-2.5"

export interface VideoModelChoice {
  label: string
  /** Compound `provider/model` id. */
  value: string
}

export interface VideoOptionsInput {
  defaults: VideoChoices
  /** Whether the user's message carries an image the render can start from. */
  hasImage: boolean
  models: VideoModelChoice[]
  prompt: string
  title: string
}

export const DEFAULT_VIDEO_CHOICES: Omit<VideoChoices, "imageUse" | "model"> = {
  duration: 5,
  generateAudio: true,
  ratio: "16:9",
  resolution: "720p",
  shots: 1
}

// AI SDK takes resolution as a pixel size; the ByteDance provider maps these
// exact sizes back to Ark's 480p / 720p / 1080p levels. `adaptive` lets the
// model pick the shape, so it is sized like 16:9.
const VIDEO_SIZES: Record<
  VideoResolution,
  Record<Exclude<VideoRatio, "adaptive">, `${number}x${number}`>
> = {
  "1080p": { "1:1": "1440x1440", "16:9": "1920x1080", "9:16": "1080x1920" },
  "480p": { "1:1": "640x640", "16:9": "864x480", "9:16": "480x864" },
  "720p": { "1:1": "960x960", "16:9": "1280x720", "9:16": "720x1280" }
}

export const getVideoSize = (
  resolution: VideoResolution,
  ratio: VideoRatio
): `${number}x${number}` =>
  VIDEO_SIZES[resolution][ratio === "adaptive" ? "16:9" : ratio]

const SIZE_PATTERN = /^(?<width>\d+)x(?<height>\d+)$/u
const VIDEO_FPS = 24
const TOKENS_PER_PIXEL_FRAME_DIVISOR = 1024

/**
 * Ark bills a Seedance render by output size: seconds × width × height × 24
 * fps / 1024 tokens. An estimate only — the provider reports the real count.
 */
export const estimateVideoTokens = ({
  duration,
  ratio,
  resolution
}: Pick<VideoChoices, "duration" | "ratio" | "resolution">): number => {
  const match = SIZE_PATTERN.exec(getVideoSize(resolution, ratio))
  const pixels = Number(match?.groups?.width) * Number(match?.groups?.height)

  return Math.round(
    (duration * pixels * VIDEO_FPS) / TOKENS_PER_PIXEL_FRAME_DIVISOR
  )
}
