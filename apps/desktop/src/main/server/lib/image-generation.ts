import { randomUUID } from "node:crypto"

import { generateImage } from "ai"
import type { ImageModel } from "ai"

import type {
  WorkspaceCore,
  WorkspaceFileError
} from "@/main/agents/minimal/workspace-core"

/**
 * Shared image-generation core used by both the `imagen` agent tool and the
 * composer's direct image mode. It calls the provider's Images API, writes the
 * result under generated-images/, and returns the metadata the inline imagen
 * renderer consumes. Keeping both callers on this one path means the tool and
 * the direct route stay in lockstep.
 */

const IMAGE_OUTPUT_DIR = "generated-images"
const SLUG_MAX_LENGTH = 40
const RANDOM_SUFFIX_LENGTH = 8
// Provider options below are gpt-image-family-only: other image models (gemini
// / nano-banana / MiniMax on OpenAI-compatible aggregators) reject unknown
// params like `quality` and `outputFormat`.
const GPT_IMAGE_MODEL_PREFIX = "gpt-image"

export type ImageQuality = "high" | "low" | "medium"
// The Images API types size as a `${number}x${number}` template literal; the
// imagen tool's enum ("1024x1024" etc.) is assignable to it.
export type ImageSize = `${number}x${number}`

const SLUG_INVALID_PATTERN = /[^a-z0-9]+/gu
const SLUG_TRIM_PATTERN = /^-+|-+$/gu

export const slugifyImageTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(SLUG_INVALID_PATTERN, "-")
    .replace(SLUG_TRIM_PATTERN, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(SLUG_TRIM_PATTERN, "") || "image"

const IMAGE_MEDIA_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
}

const getImageFileExtension = (mediaType: string | undefined): string =>
  (mediaType ? IMAGE_MEDIA_TYPE_EXTENSIONS[mediaType] : undefined) ?? ".png"

const buildImageArtifactPath = (title: string, extension: string): string =>
  `${IMAGE_OUTPUT_DIR}/${slugifyImageTitle(title)}-${randomUUID().slice(0, RANDOM_SUFFIX_LENGTH)}${extension}`

const throwWorkspaceError = (error: WorkspaceFileError): never => {
  throw new Error(`${error.message} (${error.code}: ${error.path})`)
}

export interface GenerateAndPersistImageResult {
  byteLength: number
  kind: "image"
  model: string
  path: string
  prompt: string
  quality?: ImageQuality
  size?: ImageSize
  title: string
}

export interface GenerateAndPersistImageOptions {
  abortSignal?: AbortSignal
  imageModel: ImageModel
  /** Model id recorded on the output (and used to gate gpt-image options). */
  modelIdForOutput: string
  prompt: string
  quality?: ImageQuality
  size?: ImageSize
  title: string
  workspace: WorkspaceCore
}

export const generateAndPersistImage = async ({
  abortSignal,
  imageModel,
  modelIdForOutput,
  prompt,
  quality,
  size,
  title,
  workspace
}: GenerateAndPersistImageOptions): Promise<GenerateAndPersistImageResult> => {
  const usesGptImageOptions = modelIdForOutput.startsWith(
    GPT_IMAGE_MODEL_PREFIX
  )
  const { images } = await generateImage({
    ...(abortSignal ? { abortSignal } : {}),
    model: imageModel,
    n: 1,
    prompt,
    ...(size ? { size } : {}),
    ...(usesGptImageOptions
      ? {
          providerOptions: {
            openai: { outputFormat: "png", ...(quality ? { quality } : {}) }
          }
        }
      : {})
  })

  const [image] = images

  if (!image) {
    throw new Error("Image generation returned no image.")
  }

  const relativePath = buildImageArtifactPath(
    title,
    getImageFileExtension(image.mediaType)
  )
  const writeResult = await workspace.writeBinaryFile(
    relativePath,
    image.uint8Array,
    abortSignal ? { signal: abortSignal } : {}
  )

  if (!writeResult.ok) {
    return throwWorkspaceError(writeResult.error)
  }

  return {
    byteLength: writeResult.value.bytesWritten,
    kind: "image",
    model: modelIdForOutput,
    path: writeResult.value.info.path,
    prompt,
    ...(quality ? { quality } : {}),
    ...(size ? { size } : {}),
    title
  }
}
