import { tool } from "ai"
import { z } from "zod"

import type { WorkspaceCore } from "@/main/agents/minimal/workspace-core"
import { generateAndPersistImage } from "@/main/server/lib/image-generation"
import { IMAGE_MODEL_ID, resolveImageModel } from "@/main/server/lib/providers"

/**
 * Generates an image from a text prompt via the OpenAI Images API (gpt-image-*)
 * and saves it under generated-images/. The image renders inline in the chat
 * message (it is not an artifact). The session's chat model orchestrates the
 * call; it does not need to be an image model itself. One image per call — the
 * model calls again for variations.
 */

export { slugifyImageTitle } from "@/main/server/lib/image-generation"

const ImagenInputSchema = z
  .object({
    prompt: z
      .string()
      .min(1)
      .max(4000)
      .describe("Detailed description of the image to generate."),
    quality: z
      .enum(["low", "medium", "high"])
      .default("medium")
      .describe("Rendering quality; higher costs more and takes longer."),
    size: z
      .enum(["1024x1024", "1536x1024", "1024x1536"])
      .default("1024x1024")
      .describe(
        "Image dimensions: square, landscape (1536x1024), or portrait (1024x1536)."
      ),
    title: z
      .string()
      .min(1)
      .max(120)
      .describe("Short human-readable title shown on the artifact card.")
  })
  .strict()

export const buildImagenTool = (workspace: WorkspaceCore) =>
  tool({
    description:
      "Generate an image from a text prompt; it renders inline in the chat message. Call once per image; write a vivid, specific prompt.",
    execute: (inputData, context) =>
      generateAndPersistImage({
        ...(context?.abortSignal ? { abortSignal: context.abortSignal } : {}),
        imageModel: resolveImageModel(),
        modelIdForOutput: IMAGE_MODEL_ID,
        prompt: inputData.prompt,
        quality: inputData.quality,
        size: inputData.size,
        title: inputData.title,
        workspace
      }),
    inputSchema: ImagenInputSchema
  })

export type ImagenTool = ReturnType<typeof buildImagenTool>
