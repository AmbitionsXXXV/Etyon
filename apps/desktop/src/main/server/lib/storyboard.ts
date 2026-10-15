import { generateText } from "ai"

import { mapWithConcurrency } from "@/main/amux/map-with-concurrency"
import { runMediaTask } from "@/main/amux/media-tasks"
import type { AmuxProviderId, MediaTaskOwner } from "@/main/amux/media-tasks"
import { logger } from "@/main/logger"
import { resolveModel } from "@/main/server/lib/providers"
import {
  buildFallbackStoryboardPlan,
  buildStoryboardPlannerPrompt,
  parseStoryboardPlan,
  STORYBOARD_IMAGE_MODEL,
  STORYBOARD_VARIANTS
} from "@/shared/chat/storyboard"
import type {
  StoryboardKeyframeVariants,
  StoryboardPlan
} from "@/shared/chat/storyboard"
import type { VideoRatio } from "@/shared/chat/video-tools"

// Keyframe images run three at a time, like clips: amux caps concurrent
// tasks per key, and a burst only queues on its side anyway.
const KEYFRAME_CONCURRENCY = 3

// gpt-image sizes closest to each clip shape, so a keyframe used as a first
// or last frame matches the clip it starts or ends.
const KEYFRAME_SIZES: Record<VideoRatio, string> = {
  "1:1": "1024x1024",
  "16:9": "2048x1152",
  "9:16": "1152x2048",
  adaptive: "2048x1152"
}

/**
 * Drafts the shots and keyframes with the chat model. A reply that is not the
 * expected JSON (or no usable model) falls back to a plan built from the
 * brief, which the user edits on the plan card anyway.
 */
export const planStoryboard = async ({
  abortSignal,
  brief,
  modelId,
  shotCount
}: {
  abortSignal?: AbortSignal
  brief: string
  modelId: string | null
  shotCount: number
}): Promise<StoryboardPlan> => {
  try {
    const { text } = await generateText({
      ...(abortSignal ? { abortSignal } : {}),
      model: resolveModel(modelId ?? undefined),
      prompt: buildStoryboardPlannerPrompt(brief, shotCount)
    })
    const plan = parseStoryboardPlan(text)

    if (plan && plan.shots.length === shotCount) {
      return plan
    }
  } catch (error) {
    if (abortSignal?.aborted) {
      throw error
    }

    logger.error("storyboard_plan_failed", { error })
  }

  return buildFallbackStoryboardPlan(brief, shotCount)
}

/**
 * Makes `STORYBOARD_VARIANTS` gpt-image candidates for every keyframe, each
 * kept as its amux URL (for Seedance) and a local copy (for the cards). A
 * user's image, when given, is the style reference for all of them.
 */
export const makeKeyframes = async ({
  owner,
  plan,
  projectPath,
  provider,
  ratio,
  reference,
  signal,
  title
}: {
  owner: Omit<MediaTaskOwner, "settlesPart">
  plan: StoryboardPlan
  projectPath: string
  provider: AmuxProviderId
  ratio: VideoRatio
  reference?: { bytes: Uint8Array; mediaType: string }
  signal?: AbortSignal
  title: string
}): Promise<StoryboardKeyframeVariants[]> => {
  const results = await mapWithConcurrency(
    plan.keyframes,
    KEYFRAME_CONCURRENCY,
    async (keyframe, index) => {
      const prompt = plan.style
        ? `${plan.style}\n\n${keyframe.prompt}`
        : keyframe.prompt
      const { localPaths, task } = await runMediaTask({
        create: (client) =>
          client.createImageTask(
            {
              ...(reference
                ? {
                    images: [
                      {
                        bytes: reference.bytes,
                        fileName: "style-reference.png",
                        mediaType: reference.mediaType
                      }
                    ]
                  }
                : {}),
              model: STORYBOARD_IMAGE_MODEL,
              n: STORYBOARD_VARIANTS,
              prompt,
              size: KEYFRAME_SIZES[ratio]
            },
            signal
          ),
        kind: "image",
        model: STORYBOARD_IMAGE_MODEL,
        owner: { ...owner, settlesPart: false },
        projectPath,
        provider,
        request: { keyframe: index, prompt },
        ...(signal ? { signal } : {}),
        title: `${title} k${index}`
      })

      return {
        frames: task.imageUrls.map((url, frameIndex) => ({
          path: localPaths[frameIndex] ?? "",
          url
        })),
        prompt: keyframe.prompt
      }
    }
  )
  const failed = results.find((result) => result.status === "rejected")

  if (failed?.status === "rejected") {
    throw failed.reason
  }

  return results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  )
}
