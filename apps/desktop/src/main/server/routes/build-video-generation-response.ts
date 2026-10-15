import { randomUUID } from "node:crypto"

import type { AppSettings } from "@etyon/rpc"
import type { UIMessage, UIMessageStreamWriter } from "ai"
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  isToolUIPart
} from "ai"

import { resolveAttachmentsForModelMessages } from "@/main/attachments"
import { logger } from "@/main/logger"
import {
  isVideoOutputModelSelection,
  listVideoModelChoices
} from "@/main/server/lib/providers"
import {
  editAndPersistVideo,
  generateAndPersistVideo
} from "@/main/server/lib/video-generation"
import type { VideoImageInput } from "@/main/server/lib/video-generation"
import {
  describeChatStreamError,
  writeRequestPhase
} from "@/main/server/routes/build-chat-stream-response"
import { getLatestUserMessageText } from "@/main/server/routes/build-image-generation-response"
import {
  writeStoryboardClips,
  writeStoryboardKeyframes,
  writeStoryboardPlan
} from "@/main/server/routes/storyboard-steps"
import { attachWorkTimeToLatestAssistantMessage } from "@/shared/chat/message-metadata"
import {
  STORYBOARD_CURATE_TOOL_NAME,
  STORYBOARD_PLAN_TOOL_NAME,
  StoryboardPicksSchema,
  StoryboardPlanSchema
} from "@/shared/chat/storyboard"
import type { StoryboardFrame, StoryboardPlan } from "@/shared/chat/storyboard"
import {
  DEFAULT_VIDEO_CHOICES,
  VIDEO_OPTIONS_TOOL_NAME,
  VIDEO_OPTIONS_TOOL_PART_TYPE,
  VIDEOGEN_TOOL_NAME,
  VideoChoicesSchema,
  VideoEditRequestSchema
} from "@/shared/chat/video-tools"
import type {
  VideoChoices,
  VideoEditRequest,
  VideoOptionsInput
} from "@/shared/chat/video-tools"

const VIDEO_TITLE_MAX_LENGTH = 60
const STORYBOARD_PLAN_TOOL_PART_TYPE = `tool-${STORYBOARD_PLAN_TOOL_NAME}`
const STORYBOARD_CURATE_TOOL_PART_TYPE = `tool-${STORYBOARD_CURATE_TOOL_NAME}`
const DATA_URL_PATTERN = /^data:(?<mediaType>[^;,]+);base64,(?<base64>.+)$/su

export type VideoRequest =
  | { kind: "options"; input: VideoOptionsInput }
  | { edit: VideoEditRequest; kind: "edit"; prompt: string; title: string }
  | { choices: VideoChoices; kind: "render"; prompt: string; title: string }
  | {
      choices: VideoChoices
      kind: "storyboard-plan"
      prompt: string
      title: string
    }
  | {
      choices: VideoChoices
      kind: "storyboard-keyframes"
      plan: StoryboardPlan
      prompt: string
      title: string
    }
  | {
      choices: VideoChoices
      frames: StoryboardFrame[]
      kind: "storyboard-clips"
      plan: StoryboardPlan
      prompt: string
      title: string
    }

const deriveVideoTitle = (prompt: string): string => {
  const firstLine =
    prompt
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  const title = firstLine.slice(0, VIDEO_TITLE_MAX_LENGTH).trim()

  return title.length > 0 ? title : "Generated video"
}

type MessagePart = UIMessage["parts"][number]

const isImageFilePart = (
  part: MessagePart
): part is Extract<MessagePart, { type: "file" }> =>
  part.type === "file" && part.mediaType.startsWith("image/")

const findLatestUserImagePart = (messages: UIMessage[]) =>
  messages
    .findLast((message) => message.role === "user")
    ?.parts.find(isImageFilePart)

// The answered card the renderer just resumed on: still the trailing part of
// the trailing assistant message, its output the user's answer.
const findAnsweredInputCard = (
  messages: UIMessage[]
): { input: unknown; output: unknown; type: string } | null => {
  const lastMessage = messages.at(-1)
  const trailing = lastMessage?.parts.at(-1)

  if (
    lastMessage?.role !== "assistant" ||
    !trailing ||
    !isToolUIPart(trailing) ||
    trailing.state !== "output-available"
  ) {
    return null
  }

  return { input: trailing.input, output: trailing.output, type: trailing.type }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const readString = (value: unknown, key: string): string => {
  const field = isRecord(value) ? value[key] : undefined

  return typeof field === "string" ? field : ""
}

const readFrames = (value: unknown): StoryboardFrame[] =>
  Array.isArray(value)
    ? value
        .filter(isRecord)
        .flatMap((frame) =>
          typeof frame.url === "string" && typeof frame.path === "string"
            ? [{ path: frame.path, url: frame.url }]
            : []
        )
    : []

// A storyboard step's card carries the run's choices, plan, prompt and title in
// its input; they are re-validated on every resume.
const readStoryboardContext = (
  settings: AppSettings,
  input: unknown
): {
  choices: VideoChoices
  plan: StoryboardPlan | null
  prompt: string
  title: string
} | null => {
  const choices = VideoChoicesSchema.safeParse(
    isRecord(input) ? input.choices : undefined
  )

  if (
    !choices.success ||
    !isVideoOutputModelSelection(settings.ai, choices.data.model)
  ) {
    return null
  }

  const plan = StoryboardPlanSchema.safeParse(
    isRecord(input) ? input.plan : undefined
  )
  const prompt = readString(input, "prompt")

  return {
    choices: choices.data,
    plan: plan.success ? plan.data : null,
    prompt,
    title: readString(input, "title") || deriveVideoTitle(prompt)
  }
}

const resolveAnsweredCard = (
  settings: AppSettings,
  answered: { input: unknown; output: unknown; type: string }
): VideoRequest | null => {
  if (answered.type === VIDEO_OPTIONS_TOOL_PART_TYPE) {
    const parsed = VideoChoicesSchema.safeParse(answered.output)

    if (
      !parsed.success ||
      !isVideoOutputModelSelection(settings.ai, parsed.data.model)
    ) {
      return null
    }

    const prompt = readPrompt(answered.input)
    const title = deriveVideoTitle(prompt)

    return (parsed.data.shots ?? 1) > 1
      ? { choices: parsed.data, kind: "storyboard-plan", prompt, title }
      : { choices: parsed.data, kind: "render", prompt, title }
  }

  if (answered.type === STORYBOARD_PLAN_TOOL_PART_TYPE) {
    const context = readStoryboardContext(settings, answered.input)
    const plan = StoryboardPlanSchema.safeParse(
      isRecord(answered.output) ? answered.output.plan : undefined
    )

    return context && plan.success
      ? { ...context, kind: "storyboard-keyframes", plan: plan.data }
      : null
  }

  if (answered.type === STORYBOARD_CURATE_TOOL_PART_TYPE) {
    const context = readStoryboardContext(settings, answered.input)
    const picks = StoryboardPicksSchema.safeParse(answered.output)
    const keyframes =
      isRecord(answered.input) && Array.isArray(answered.input.keyframes)
        ? answered.input.keyframes.map((keyframe: unknown) =>
            readFrames(isRecord(keyframe) ? keyframe.frames : undefined)
          )
        : []

    if (!(context?.plan && picks.success)) {
      return null
    }

    const frames = picks.data.picks.flatMap((pick, index) => {
      const frame = keyframes[index]?.[pick]

      return frame ? [frame] : []
    })

    // One pick per keyframe, each naming a real variant.
    return frames.length === context.plan.keyframes.length &&
      frames.length === picks.data.picks.length
      ? { ...context, frames, kind: "storyboard-clips", plan: context.plan }
      : null
  }

  return null
}

const readPrompt = (input: unknown): string => {
  const prompt = (input as { prompt?: unknown } | undefined)?.prompt

  return typeof prompt === "string" ? prompt : ""
}

/**
 * Decides whether a chat request belongs to the Video skill: a resume on an
 * answered choices card renders (whatever the composer shows now), and a fresh
 * prompt sent with the skill on asks for choices. Null hands the request back
 * to the normal chat path.
 */
export const resolveVideoRequest = ({
  messages,
  settings,
  videoEdit,
  videoMode,
  videoModel
}: {
  messages: UIMessage[]
  settings: AppSettings
  videoEdit?: unknown
  videoMode: unknown
  videoModel: unknown
}): VideoRequest | null => {
  const answered = findAnsweredInputCard(messages)

  if (answered) {
    return resolveAnsweredCard(settings, answered)
  }

  // Edit / Extend on a clip card: the message text is the instruction.
  const edit = VideoEditRequestSchema.safeParse(videoEdit)

  if (edit.success) {
    const prompt = getLatestUserMessageText(messages)
    const verb = edit.data.mode === "edit" ? "Edited" : "Extended"

    return prompt.trim()
      ? {
          edit: edit.data,
          kind: "edit",
          prompt,
          title: `${verb}: ${edit.data.sourceTitle || deriveVideoTitle(prompt)}`
        }
      : null
  }

  if (videoMode !== true) {
    return null
  }

  const models = listVideoModelChoices(settings.ai)
  const [firstModel] = models

  if (!firstModel) {
    return null
  }

  const preferredModel =
    typeof videoModel === "string" &&
    models.some((model) => model.value === videoModel)
      ? videoModel
      : firstModel.value
  const prompt = getLatestUserMessageText(messages)
  const hasImage = findLatestUserImagePart(messages) !== undefined

  return {
    input: {
      defaults: {
        ...DEFAULT_VIDEO_CHOICES,
        imageUse: hasImage ? "first_frame" : "ignore",
        model: preferredModel
      },
      hasImage,
      models,
      prompt,
      title: deriveVideoTitle(prompt)
    },
    kind: "options"
  }
}

// The user's attached image as raw bytes: persisted parts are
// `etyon-attachment://` refs, which resolve back to `data:` URLs here.
const readLatestUserImage = async (
  messages: UIMessage[]
): Promise<{ bytes: Uint8Array; mediaType: string } | undefined> => {
  const part = findLatestUserImagePart(messages)

  if (!part) {
    return undefined
  }

  const [resolved] = await resolveAttachmentsForModelMessages([
    { id: "video-image", parts: [part], role: "user" }
  ])
  const resolvedPart = resolved?.parts.find(isImageFilePart)
  const base64 = resolvedPart
    ? DATA_URL_PATTERN.exec(resolvedPart.url)?.groups?.base64
    : undefined

  return resolvedPart && base64
    ? {
        bytes: new Uint8Array(Buffer.from(base64, "base64")),
        mediaType: resolvedPart.mediaType
      }
    : undefined
}

const writeRender = async ({
  abortSignal,
  messages,
  projectPath,
  request,
  sessionId,
  writer
}: {
  abortSignal: AbortSignal
  messages: UIMessage[]
  projectPath: string
  request: Extract<VideoRequest, { kind: "render" }>
  sessionId: string
  writer: UIMessageStreamWriter
}): Promise<void> => {
  const { choices, prompt, title } = request
  const toolCallId = `videogen-${randomUUID()}`
  const generationLog = logger.startEvent("chat_video_generation", {
    model: choices.model,
    session_id: sessionId
  })

  writer.write({
    input: { ...choices, prompt, title },
    toolCallId,
    toolName: VIDEOGEN_TOOL_NAME,
    type: "tool-input-available"
  })

  try {
    const userImage =
      choices.imageUse === "ignore"
        ? undefined
        : await readLatestUserImage(messages)
    const image: VideoImageInput | undefined =
      userImage && choices.imageUse !== "ignore"
        ? { ...userImage, use: choices.imageUse }
        : undefined
    const output = await generateAndPersistVideo({
      abortSignal,
      choices,
      ...(image ? { image } : {}),
      owner: {
        kind: "chat-tool",
        sessionId,
        title,
        toolCallId,
        toolType: `tool-${VIDEOGEN_TOOL_NAME}`
      },
      projectPath,
      prompt,
      title
    })

    writer.write({ output, toolCallId, type: "tool-output-available" })
  } catch (error) {
    // The request went away (Stop, leaving the chat, a reload) but the task
    // keeps running on amux. Leave the part waiting: the background resume
    // writes the clip into it, and a part marked failed here would block that.
    if (!abortSignal.aborted) {
      writer.write({
        errorText: describeChatStreamError(error),
        toolCallId,
        type: "tool-output-error"
      })
    }
  }

  generationLog.end()
}

const writeVideoEdit = async ({
  abortSignal,
  projectPath,
  request,
  sessionId,
  writer
}: {
  abortSignal: AbortSignal
  projectPath: string
  request: Extract<VideoRequest, { kind: "edit" }>
  sessionId: string
  writer: UIMessageStreamWriter
}): Promise<void> => {
  const { edit, prompt, title } = request
  const toolCallId = `videogen-${randomUUID()}`

  writer.write({
    input: { mode: edit.mode, prompt, ratio: "adaptive", title },
    toolCallId,
    toolName: VIDEOGEN_TOOL_NAME,
    type: "tool-input-available"
  })

  try {
    const output = await editAndPersistVideo({
      abortSignal,
      edit,
      owner: {
        kind: "chat-tool",
        sessionId,
        title,
        toolCallId,
        toolType: `tool-${VIDEOGEN_TOOL_NAME}`
      },
      projectPath,
      prompt,
      title
    })

    writer.write({ output, toolCallId, type: "tool-output-available" })
  } catch (error) {
    // As with a render: a request that went away leaves the part waiting for
    // the background resume.
    if (!abortSignal.aborted) {
      writer.write({
        errorText: describeChatStreamError(error),
        toolCallId,
        type: "tool-output-error"
      })
    }
  }
}

const writeVideoRequest = async ({
  abortSignal,
  chatModelId,
  messages,
  projectPath,
  request,
  sessionId,
  writer
}: {
  abortSignal: AbortSignal
  chatModelId: string | null
  messages: UIMessage[]
  projectPath: string
  request: VideoRequest
  sessionId: string
  writer: UIMessageStreamWriter
}): Promise<void> => {
  if (request.kind === "options") {
    writer.write({
      input: request.input,
      toolCallId: `${VIDEO_OPTIONS_TOOL_NAME}-${randomUUID()}`,
      toolName: VIDEO_OPTIONS_TOOL_NAME,
      type: "tool-input-available"
    })
    return
  }

  if (request.kind === "edit") {
    await writeVideoEdit({
      abortSignal,
      projectPath,
      request,
      sessionId,
      writer
    })
    return
  }

  if (request.kind === "render") {
    await writeRender({
      abortSignal,
      messages,
      projectPath,
      request,
      sessionId,
      writer
    })
    return
  }

  const step = {
    abortSignal,
    choices: request.choices,
    projectPath,
    prompt: request.prompt,
    sessionId,
    title: request.title,
    writer
  }

  if (request.kind === "storyboard-plan") {
    await writeStoryboardPlan({ ...step, chatModelId })
    return
  }

  if (request.kind === "storyboard-keyframes") {
    // A user's image styles every keyframe (it is not a frame of its own).
    const reference =
      request.choices.imageUse === "ignore"
        ? undefined
        : await readLatestUserImage(messages)

    await writeStoryboardKeyframes({
      ...step,
      plan: request.plan,
      ...(reference ? { reference } : {})
    })
    return
  }

  await writeStoryboardClips({
    ...step,
    frames: request.frames,
    plan: request.plan
  })
}

export interface BuildVideoGenerationStreamResponseOptions {
  abortSignal: AbortSignal
  /** The chat model that drafts a storyboard; null uses the default. */
  chatModelId: string | null
  messages: UIMessage[]
  onFinishPersist: (messages: UIMessage[]) => Promise<void>
  projectPath: string
  request: VideoRequest
  requestStartedAt: number
  sessionId: string
}

/**
 * Direct Video skill route, bypassing the LLM chat/agent loop like the Image
 * skill. Streams either the choices card (an unanswered `video_options` part,
 * which suspends the turn) or, on resume, the `videogen` render appended to the
 * same assistant message.
 */
export const buildVideoGenerationStreamResponse = ({
  abortSignal,
  chatModelId,
  messages,
  onFinishPersist,
  projectPath,
  request,
  requestStartedAt,
  sessionId
}: BuildVideoGenerationStreamResponseOptions): Response =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        writeRequestPhase(writer, "model-start")
        writer.write({ type: "start" })
        writer.write({ type: "start-step" })

        await writeVideoRequest({
          abortSignal,
          chatModelId,
          messages,
          projectPath,
          request,
          sessionId,
          writer
        })

        writer.write({ type: "finish-step" })
        writer.write({ type: "finish" })
      },
      onError: describeChatStreamError,
      onEnd: async ({ messages: nextMessages }) => {
        await onFinishPersist(
          attachWorkTimeToLatestAssistantMessage(
            nextMessages,
            Date.now() - requestStartedAt
          )
        )
      },
      originalMessages: messages
    })
  })
