import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import { getString, isRecord } from "@/renderer/lib/utils"
import {
  VIDEO_OPTIONS_TOOL_NAME,
  VIDEOGEN_TOOL_NAME,
  VideoChoicesSchema
} from "@/shared/chat/video-tools"
import type {
  VideoChoices,
  VideoModelChoice,
  VideoOptionsInput
} from "@/shared/chat/video-tools"

/**
 * Derives what the Video skill's two cards need from their tool parts: the
 * choices card (`video_options`) and the inline clip (`videogen`), across their
 * lifecycles. Tolerant readers, like the other input cards: render from what was
 * streamed or persisted without a strict parse blocking the UI.
 */

export type VideogenPhase = "error" | "generating" | "published"

export interface VideogenPartState {
  errorMessage?: string
  path: string
  phase: VideogenPhase
  cost?: string
  ratio: string
  title: string
}

const VIDEOGEN_FAILED_STATES = new Set(["output-denied", "output-error"])
const VIDEOGEN_ERROR_MAX_LENGTH = 300

const isNamedToolPart = (part: unknown, toolName: string): boolean =>
  isRecord(part) &&
  (part.type === `tool-${toolName}` ||
    (part.type === "dynamic-tool" && part.toolName === toolName))

export const isVideogenToolPart = (part: unknown): boolean =>
  isNamedToolPart(part, VIDEOGEN_TOOL_NAME)

export const isVideoOptionsToolPart = (part: unknown): boolean =>
  isNamedToolPart(part, VIDEO_OPTIONS_TOOL_NAME)

const readErrorText = (part: ChatToolPart): string | undefined => {
  const { errorText } = part as { errorText?: unknown }

  return typeof errorText === "string" && errorText.length > 0
    ? errorText.slice(0, VIDEOGEN_ERROR_MAX_LENGTH)
    : undefined
}

export const getVideogenPartState = (
  part: ChatToolPart
): VideogenPartState | null => {
  if (!isVideogenToolPart(part)) {
    return null
  }

  const input = isRecord(part.input) ? part.input : {}
  const title = getString(input, "title") || ""
  const ratio = getString(input, "ratio") || "16:9"

  if (part.state === "output-available" && isRecord(part.output)) {
    const path = getString(part.output, "path")
    const cost = getString(part.output, "cost")

    if (path) {
      return {
        path,
        phase: "published",
        ratio,
        title: getString(part.output, "title") || title,
        ...(cost ? { cost } : {})
      }
    }
  }

  if (VIDEOGEN_FAILED_STATES.has(part.state)) {
    const errorMessage = readErrorText(part)

    return {
      ...(errorMessage ? { errorMessage } : {}),
      path: "",
      phase: "error",
      ratio,
      title
    }
  }

  return { path: "", phase: "generating", ratio, title }
}

/** CSS aspect-ratio for a clip; `adaptive` is shaped like 16:9 until it loads. */
export const getVideoAspectRatio = (ratio: string): string =>
  ratio === "adaptive" ? "16 / 9" : ratio.replace(":", " / ")

const readModelChoices = (value: unknown): VideoModelChoice[] =>
  Array.isArray(value)
    ? value
        .filter(isRecord)
        .map((model) => ({
          label: getString(model, "label") || getString(model, "value") || "",
          value: getString(model, "value") || ""
        }))
        .filter((model) => model.value.length > 0)
    : []

export const getVideoOptionsCardInput = (
  part: ChatToolPart
): VideoOptionsInput | null => {
  const { input } = part as { input?: unknown }

  if (!isRecord(input)) {
    return null
  }

  const defaults = VideoChoicesSchema.safeParse(input.defaults)
  const models = readModelChoices(input.models)

  if (!defaults.success || models.length === 0) {
    return null
  }

  return {
    defaults: defaults.data,
    hasImage: input.hasImage === true,
    models,
    prompt: getString(input, "prompt") || "",
    title: getString(input, "title") || ""
  }
}

export const getVideoOptionsCardOutput = (
  part: ChatToolPart
): VideoChoices | null => {
  const parsed = VideoChoicesSchema.safeParse(
    (part as { output?: unknown }).output
  )

  return parsed.success ? parsed.data : null
}

/** The answered card's one-line summary: model · length · shape · quality. */
export const formatVideoChoices = (
  choices: VideoChoices,
  models: readonly VideoModelChoice[]
): string => {
  const model =
    models.find((entry) => entry.value === choices.model)?.label ??
    choices.model.slice(choices.model.indexOf("/") + 1)

  return [
    model,
    `${choices.duration}s`,
    choices.ratio,
    choices.resolution
  ].join(" · ")
}
