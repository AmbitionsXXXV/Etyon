import { randomUUID } from "node:crypto"

import type { UIMessage } from "ai"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"

import { getWorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { logger } from "@/main/logger"
import { generateAndPersistImage } from "@/main/server/lib/image-generation"
import { resolveImageModelById } from "@/main/server/lib/providers"
import {
  describeChatStreamError,
  writeRequestPhase
} from "@/main/server/routes/build-chat-stream-response"
import { attachWorkTimeToLatestAssistantMessage } from "@/shared/chat/message-metadata"

const IMAGE_TITLE_MAX_LENGTH = 60

export const getLatestUserMessageText = (messages: UIMessage[]): string => {
  const latestUserMessage = messages.findLast(
    (message) => message.role === "user"
  )

  if (!latestUserMessage) {
    return ""
  }

  return latestUserMessage.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
}

const getBareModelId = (compoundId: string): string => {
  const slashIndex = compoundId.indexOf("/")

  return slashIndex === -1 ? compoundId : compoundId.slice(slashIndex + 1)
}

// A short human-readable caption for the inline image: the prompt's first
// non-empty line, truncated. The renderer shows it while generating and as the
// image alt text once published.
const deriveImageTitle = (prompt: string): string => {
  const firstLine =
    prompt
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  const title = firstLine.slice(0, IMAGE_TITLE_MAX_LENGTH).trim()

  return title.length > 0 ? title : "Generated image"
}

export interface BuildImageGenerationStreamResponseOptions {
  abortSignal: AbortSignal
  messages: UIMessage[]
  /** Compound `provider/model` id of the selected image-output model. */
  modelValue: string
  onFinishPersist: (messages: UIMessage[]) => Promise<void>
  projectPath: string
  requestStartedAt: number
  sessionId: string
}

/**
 * Direct composer image mode: the user's message text goes straight to the
 * selected image model's Images API, bypassing the LLM chat/agent loop. The
 * result is streamed as a manually-authored `imagen` tool part so it renders
 * through the existing inline imagen pipeline (skeleton → image → lightbox)
 * without touching that renderer.
 */
export const buildImageGenerationStreamResponse = ({
  abortSignal,
  messages,
  modelValue,
  onFinishPersist,
  projectPath,
  requestStartedAt,
  sessionId
}: BuildImageGenerationStreamResponseOptions): Response => {
  const prompt = getLatestUserMessageText(messages)
  const title = deriveImageTitle(prompt)
  const workspace = getWorkspaceCore(projectPath)

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        writeRequestPhase(writer, "model-start")

        const toolCallId = `imagen-${randomUUID()}`
        const generationLog = logger.startEvent("chat_image_generation", {
          model: modelValue,
          session_id: sessionId
        })

        writer.write({ type: "start" })
        writer.write({ type: "start-step" })
        writer.write({
          input: { prompt, title },
          toolCallId,
          toolName: "imagen",
          type: "tool-input-available"
        })

        try {
          const output = await generateAndPersistImage({
            abortSignal,
            imageModel: resolveImageModelById(modelValue),
            modelIdForOutput: getBareModelId(modelValue),
            prompt,
            title,
            workspace
          })

          writer.write({ output, toolCallId, type: "tool-output-available" })
        } catch (error) {
          writer.write({
            errorText: describeChatStreamError(error),
            toolCallId,
            type: "tool-output-error"
          })
        }

        generationLog.end()
        writer.write({ type: "finish-step" })
        writer.write({ type: "finish" })
      },
      onError: describeChatStreamError,
      onFinish: async ({ messages: nextMessages }) => {
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
}
