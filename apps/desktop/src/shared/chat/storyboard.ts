import { z } from "zod"

/**
 * The Video skill's multi-shot path (a storyboard). After the choices card
 * asks for more than one shot, the same assistant message walks through:
 *
 * 1. `storyboard_plan` (input-required): shot prompts and the keyframe at
 *    each cut, drafted by the chat model, edited and approved by the user.
 * 2. `storyboard_keyframes`: gpt-image variants for every keyframe.
 * 3. `storyboard_curate` (input-required): one pick per keyframe.
 * 4. One `videogen` part per shot: keyframe i is its first frame and keyframe
 *    i + 1 its last, so the cuts join without `return_last_frame` (which amux
 *    ignores). A `storyboard_reel` part then offers the clips as one reel.
 *
 * Names and schemas live in shared so the route, the cards, and auto-send
 * agree on one source.
 */

export const STORYBOARD_PLAN_TOOL_NAME = "storyboard_plan"
export const STORYBOARD_KEYFRAMES_TOOL_NAME = "storyboard_keyframes"
export const STORYBOARD_CURATE_TOOL_NAME = "storyboard_curate"
export const STORYBOARD_REEL_TOOL_NAME = "storyboard_reel"

export const STORYBOARD_SHOT_COUNTS = [1, 3, 4, 6] as const
export const STORYBOARD_VARIANTS = 3
export const STORYBOARD_IMAGE_MODEL = "openai/gpt-image-2"

const PROMPT_MAX_CHARS = 1200

export const StoryboardPlanSchema = z
  .object({
    keyframes: z
      .array(z.object({ prompt: z.string().min(1).max(PROMPT_MAX_CHARS) }))
      .min(2),
    shots: z
      .array(z.object({ prompt: z.string().min(1).max(PROMPT_MAX_CHARS) }))
      .min(1),
    style: z.string().max(PROMPT_MAX_CHARS)
  })
  .refine((plan) => plan.keyframes.length === plan.shots.length + 1, {
    message: "A storyboard needs one more keyframe than shots."
  })

export type StoryboardPlan = z.infer<typeof StoryboardPlanSchema>

export interface StoryboardFrame {
  /** amux-hosted URL, what Seedance reads; it lives until amux clears it. */
  url: string
  /** Project-relative local copy, what the cards show. */
  path: string
}

export interface StoryboardKeyframeVariants {
  frames: StoryboardFrame[]
  prompt: string
}

export const StoryboardPicksSchema = z
  .object({
    /** For each keyframe, the index of the chosen variant. */
    picks: z.array(z.number().int().min(0))
  })
  .strict()

export type StoryboardPicks = z.infer<typeof StoryboardPicksSchema>

const JSON_OBJECT_PATTERN = /\{[\s\S]*\}/u

/**
 * Reads the planner's reply: the first JSON object in it, validated. Null when
 * the model answered with anything else, so the caller can fall back.
 */
export const parseStoryboardPlan = (text: string): StoryboardPlan | null => {
  const match = JSON_OBJECT_PATTERN.exec(text)

  if (!match) {
    return null
  }

  try {
    const parsed = StoryboardPlanSchema.safeParse(JSON.parse(match[0]))

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** A plan that needs no model: the brief, as every shot and keyframe. */
export const buildFallbackStoryboardPlan = (
  brief: string,
  shotCount: number
): StoryboardPlan => ({
  keyframes: Array.from({ length: shotCount + 1 }, (_, index) => ({
    prompt: `${brief} — moment ${index + 1} of ${shotCount + 1}`
  })),
  shots: Array.from({ length: shotCount }, (_, index) => ({
    prompt: `${brief} — shot ${index + 1} of ${shotCount}`
  })),
  style: ""
})

export const buildStoryboardPlannerPrompt = (
  brief: string,
  shotCount: number
): string =>
  [
    `Plan a ${shotCount}-shot animated video from this brief:`,
    brief,
    "",
    `Write ${shotCount + 1} keyframes: still images at the start, at every cut, and at the end. Shot i moves from keyframe i to keyframe i + 1, so each keyframe must work as both the last frame of one shot and the first of the next.`,
    "Keyframe prompts describe one still image for an image model: subject, setting, composition, light. Shot prompts describe the motion between their two keyframes for a video model: action and camera.",
    "Keep characters, palette and style identical across all keyframes; put that shared look in `style`.",
    "",
    'Answer with JSON only: {"style": string, "keyframes": [{"prompt": string}], "shots": [{"prompt": string}]}'
  ].join("\n")
