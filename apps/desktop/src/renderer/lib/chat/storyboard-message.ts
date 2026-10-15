import type { ChatToolPart } from "@/renderer/lib/chat/message-tool-trace"
import { getString, isRecord } from "@/renderer/lib/utils"
import {
  STORYBOARD_KEYFRAMES_TOOL_NAME,
  STORYBOARD_REEL_TOOL_NAME,
  StoryboardPicksSchema,
  StoryboardPlanSchema
} from "@/shared/chat/storyboard"
import type {
  StoryboardKeyframeVariants,
  StoryboardPicks,
  StoryboardPlan
} from "@/shared/chat/storyboard"

/**
 * Tolerant readers for the storyboard's parts (see shared/chat/storyboard):
 * the cards render from whatever was streamed or persisted, and a part that
 * does not parse renders nothing rather than blocking the timeline.
 */

const isNamedToolPart = (part: unknown, toolName: string): boolean =>
  isRecord(part) &&
  (part.type === `tool-${toolName}` ||
    (part.type === "dynamic-tool" && part.toolName === toolName))

export const isStoryboardKeyframesPart = (part: unknown): boolean =>
  isNamedToolPart(part, STORYBOARD_KEYFRAMES_TOOL_NAME)

export const isStoryboardReelPart = (part: unknown): boolean =>
  isNamedToolPart(part, STORYBOARD_REEL_TOOL_NAME)

const getInput = (part: ChatToolPart): unknown =>
  (part as { input?: unknown }).input

const getOutput = (part: ChatToolPart): unknown =>
  (part as { output?: unknown }).output

const readTitle = (input: unknown): string =>
  (isRecord(input) ? getString(input, "title") : undefined) ?? ""

export const getStoryboardPlanCardInput = (
  part: ChatToolPart
): { plan: StoryboardPlan; title: string } | null => {
  const input = getInput(part)
  const plan = StoryboardPlanSchema.safeParse(
    isRecord(input) ? input.plan : undefined
  )

  return plan.success ? { plan: plan.data, title: readTitle(input) } : null
}

export const getStoryboardPlanCardOutput = (
  part: ChatToolPart
): StoryboardPlan | null => {
  const output = getOutput(part)
  const plan = StoryboardPlanSchema.safeParse(
    isRecord(output) ? output.plan : undefined
  )

  return plan.success ? plan.data : null
}

const readKeyframes = (value: unknown): StoryboardKeyframeVariants[] =>
  Array.isArray(value)
    ? value.filter(isRecord).map((keyframe) => ({
        frames: Array.isArray(keyframe.frames)
          ? keyframe.frames
              .filter(isRecord)
              .flatMap((frame) =>
                typeof frame.path === "string" && typeof frame.url === "string"
                  ? [{ path: frame.path, url: frame.url }]
                  : []
              )
          : [],
        prompt: getString(keyframe, "prompt") || ""
      }))
    : []

export const getStoryboardCurateCardInput = (
  part: ChatToolPart
): { keyframes: StoryboardKeyframeVariants[]; title: string } | null => {
  const input = getInput(part)
  const keyframes = readKeyframes(isRecord(input) ? input.keyframes : [])

  return keyframes.length > 0 ? { keyframes, title: readTitle(input) } : null
}

export const getStoryboardCurateCardOutput = (
  part: ChatToolPart
): StoryboardPicks | null => {
  const picks = StoryboardPicksSchema.safeParse(getOutput(part))

  return picks.success ? picks.data : null
}

export type StoryboardKeyframesState =
  | { count: number; phase: "generating"; variants: number }
  | { count: number; phase: "done" }
  | { errorMessage: string; phase: "error" }

export const getStoryboardKeyframesState = (
  part: ChatToolPart
): StoryboardKeyframesState => {
  const input = getInput(part)
  const count =
    isRecord(input) && typeof input.keyframes === "number" ? input.keyframes : 0

  if (part.state === "output-available") {
    const output = getOutput(part)

    return {
      count: readKeyframes(isRecord(output) ? output.keyframes : []).reduce(
        (total, keyframe) => total + keyframe.frames.length,
        0
      ),
      phase: "done"
    }
  }

  if (part.state === "output-error" || part.state === "output-denied") {
    const { errorText } = part as { errorText?: unknown }

    return {
      errorMessage: typeof errorText === "string" ? errorText : "",
      phase: "error"
    }
  }

  return {
    count,
    phase: "generating",
    variants:
      isRecord(input) && typeof input.variants === "number" ? input.variants : 0
  }
}

export const getStoryboardReelClips = (
  part: ChatToolPart
): { path: string; title: string }[] => {
  const output = getOutput(part)

  return isRecord(output) && Array.isArray(output.clips)
    ? output.clips
        .filter(isRecord)
        .flatMap((clip) =>
          typeof clip.path === "string" && typeof clip.title === "string"
            ? [{ path: clip.path, title: clip.title }]
            : []
        )
    : []
}

/** How a keyframe sits in the cut list: which shots it ends and starts. */
export const describeKeyframeJoin = (
  index: number,
  keyframeCount: number
): { endsShot: number | null; startsShot: number | null } => ({
  endsShot: index > 0 ? index : null,
  startsShot: index < keyframeCount - 1 ? index + 1 : null
})
