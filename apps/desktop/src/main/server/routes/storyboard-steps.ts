import { randomUUID } from "node:crypto"

import type { UIMessageStreamWriter } from "ai"

import { mapWithConcurrency } from "@/main/amux/map-with-concurrency"
import { makeKeyframes, planStoryboard } from "@/main/server/lib/storyboard"
import {
  generateAndPersistVideo,
  getAmuxProviderId
} from "@/main/server/lib/video-generation"
import { describeChatStreamError } from "@/main/server/routes/build-chat-stream-response"
import {
  STORYBOARD_CURATE_TOOL_NAME,
  STORYBOARD_KEYFRAMES_TOOL_NAME,
  STORYBOARD_PLAN_TOOL_NAME,
  STORYBOARD_REEL_TOOL_NAME,
  STORYBOARD_VARIANTS
} from "@/shared/chat/storyboard"
import type { StoryboardFrame, StoryboardPlan } from "@/shared/chat/storyboard"
import { VIDEOGEN_TOOL_NAME } from "@/shared/chat/video-tools"
import type { VideoChoices } from "@/shared/chat/video-tools"

/**
 * The storyboard's steps as stream writers. Each one ends either on an input
 * card (the run suspends until the user answers it) or on finished parts.
 */

// Clips render three at a time: an individual amux key runs at most three
// Seedance tasks at once.
const CLIP_CONCURRENCY = 3

interface StepContext {
  abortSignal: AbortSignal
  choices: VideoChoices
  projectPath: string
  prompt: string
  sessionId: string
  title: string
  writer: UIMessageStreamWriter
}

const withStyle = (style: string, prompt: string): string =>
  style ? `${style}\n\n${prompt}` : prompt

/** Drafts the plan and asks the user to edit and approve it. */
export const writeStoryboardPlan = async ({
  abortSignal,
  choices,
  chatModelId,
  prompt,
  title,
  writer
}: StepContext & { chatModelId: string | null }): Promise<void> => {
  const plan = await planStoryboard({
    abortSignal,
    brief: prompt,
    modelId: chatModelId,
    shotCount: choices.shots ?? 1
  })

  writer.write({
    input: { choices, plan, prompt, title },
    toolCallId: `${STORYBOARD_PLAN_TOOL_NAME}-${randomUUID()}`,
    toolName: STORYBOARD_PLAN_TOOL_NAME,
    type: "tool-input-available"
  })
}

/** Makes every keyframe's variants, then asks the user to pick one each. */
export const writeStoryboardKeyframes = async ({
  abortSignal,
  choices,
  plan,
  projectPath,
  prompt,
  reference,
  sessionId,
  title,
  writer
}: StepContext & {
  plan: StoryboardPlan
  reference?: { bytes: Uint8Array; mediaType: string }
}): Promise<void> => {
  const toolCallId = `${STORYBOARD_KEYFRAMES_TOOL_NAME}-${randomUUID()}`
  const toolType = `tool-${STORYBOARD_KEYFRAMES_TOOL_NAME}`

  writer.write({
    input: {
      keyframes: plan.keyframes.length,
      title,
      variants: STORYBOARD_VARIANTS
    },
    toolCallId,
    toolName: STORYBOARD_KEYFRAMES_TOOL_NAME,
    type: "tool-input-available"
  })

  try {
    const keyframes = await makeKeyframes({
      owner: { kind: "chat-tool", sessionId, title, toolCallId, toolType },
      plan,
      projectPath,
      provider: getAmuxProviderId(choices.model),
      ratio: choices.ratio,
      ...(reference ? { reference } : {}),
      signal: abortSignal,
      title
    })

    writer.write({
      output: { keyframes },
      toolCallId,
      type: "tool-output-available"
    })
    writer.write({
      input: { choices, keyframes, plan, prompt, title },
      toolCallId: `${STORYBOARD_CURATE_TOOL_NAME}-${randomUUID()}`,
      toolName: STORYBOARD_CURATE_TOOL_NAME,
      type: "tool-input-available"
    })
  } catch (error) {
    if (!abortSignal.aborted) {
      writer.write({
        errorText: describeChatStreamError(error),
        toolCallId,
        type: "tool-output-error"
      })
    }
  }
}

/**
 * Renders one clip per shot between its two picked keyframes, as ordinary
 * `videogen` parts (so each plays, resumes, and opens in the editor like a
 * single clip), then offers the finished ones as a reel.
 */
export const writeStoryboardClips = async ({
  abortSignal,
  choices,
  frames,
  plan,
  projectPath,
  sessionId,
  title,
  writer
}: StepContext & {
  frames: StoryboardFrame[]
  plan: StoryboardPlan
}): Promise<void> => {
  const shots = plan.shots.map((shot, index) => ({
    prompt: withStyle(plan.style, shot.prompt),
    title: `${title} · shot ${index + 1}`,
    toolCallId: `${VIDEOGEN_TOOL_NAME}-${randomUUID()}`
  }))

  for (const shot of shots) {
    writer.write({
      input: { ...choices, prompt: shot.prompt, title: shot.title },
      toolCallId: shot.toolCallId,
      toolName: VIDEOGEN_TOOL_NAME,
      type: "tool-input-available"
    })
  }

  const results = await mapWithConcurrency(
    shots,
    CLIP_CONCURRENCY,
    async (shot, index) => {
      const first = frames[index]
      const last = frames[index + 1]

      if (!(first && last)) {
        throw new Error(`Shot ${index + 1} has no keyframes to join.`)
      }

      const output = await generateAndPersistVideo({
        abortSignal,
        choices,
        frameUrls: { first: first.url, last: last.url },
        owner: {
          kind: "chat-tool",
          sessionId,
          title: shot.title,
          toolCallId: shot.toolCallId,
          toolType: `tool-${VIDEOGEN_TOOL_NAME}`
        },
        projectPath,
        prompt: shot.prompt,
        title: shot.title
      })

      writer.write({
        output,
        toolCallId: shot.toolCallId,
        type: "tool-output-available"
      })

      return { path: output.path, title: shot.title }
    }
  )

  for (const [index, result] of results.entries()) {
    const shot = shots[index]

    if (result.status === "rejected" && shot && !abortSignal.aborted) {
      writer.write({
        errorText: describeChatStreamError(result.reason),
        toolCallId: shot.toolCallId,
        type: "tool-output-error"
      })
    }
  }

  const clips = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  )

  if (clips.length > 1) {
    const reelCallId = `${STORYBOARD_REEL_TOOL_NAME}-${randomUUID()}`

    writer.write({
      input: { title },
      toolCallId: reelCallId,
      toolName: STORYBOARD_REEL_TOOL_NAME,
      type: "tool-input-available"
    })
    writer.write({
      output: { clips },
      toolCallId: reelCallId,
      type: "tool-output-available"
    })
  }
}
