import fs from "node:fs"
import path from "node:path"

import type { MemoryEmbeddingModelsOutput } from "@etyon/rpc"
import { app } from "electron"

import { getAppConfigDir } from "@/main/app-paths"
import {
  DEFAULT_EMBEDDING_MODEL_LABEL,
  LOCAL_EMBEDDING_MODEL_OPTIONS
} from "@/shared/memory/embedding-model-catalog"
import type { LocalEmbeddingModelOption } from "@/shared/memory/embedding-model-catalog"

const LOCAL_EMBEDDING_MODEL_DOWNLOADS = new Map<string, Promise<void>>()
const LOCAL_EMBEDDING_MODELS_DIR = "embedding-models"

const toLocalModelDirectoryName = (modelId: string): string =>
  modelId.replace(/^local:/u, "").replaceAll(/[^a-z0-9._-]/giu, "-")

const buildHuggingFaceFileUrl = ({
  file,
  repository
}: {
  file: string
  repository: string
}): string =>
  `https://huggingface.co/${repository}/resolve/main/${file
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`

export const getLocalEmbeddingModelOption = (modelId: string) =>
  LOCAL_EMBEDDING_MODEL_OPTIONS.find((option) => option.id === modelId) ?? null

export const getLocalEmbeddingModelDirectory = (modelId: string): string =>
  path.join(
    getAppConfigDir(app.getPath("home")),
    LOCAL_EMBEDDING_MODELS_DIR,
    toLocalModelDirectoryName(modelId)
  )

export const getLocalEmbeddingModelStatus = (
  modelId: string
): "available" | "downloading" | "missing" => {
  const option = getLocalEmbeddingModelOption(modelId)

  if (!option) {
    return "missing"
  }

  if (LOCAL_EMBEDDING_MODEL_DOWNLOADS.has(modelId)) {
    return "downloading"
  }

  const modelDir = getLocalEmbeddingModelDirectory(modelId)
  const hasAllFiles = option.files.every((file) =>
    fs.existsSync(path.join(modelDir, file))
  )

  return hasAllFiles ? "available" : "missing"
}

const downloadLocalEmbeddingModelFile = async ({
  file,
  modelDir,
  repository
}: {
  file: string
  modelDir: string
  repository: string
}): Promise<void> => {
  const targetPath = path.join(modelDir, file)

  if (fs.existsSync(targetPath)) {
    return
  }

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })

  const response = await fetch(
    buildHuggingFaceFileUrl({
      file,
      repository
    })
  )

  if (!response.ok) {
    throw new Error(
      `Failed to download local embedding model file "${file}": ${response.status} ${response.statusText}`
    )
  }

  const temporaryPath = `${targetPath}.download`

  try {
    const fileBuffer = Buffer.from(await response.arrayBuffer())
    await fs.promises.writeFile(temporaryPath, fileBuffer)
    await fs.promises.rename(temporaryPath, targetPath)
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true })
    throw error
  }
}

const downloadLocalEmbeddingModel = async (
  option: LocalEmbeddingModelOption
): Promise<void> => {
  const modelDir = getLocalEmbeddingModelDirectory(option.id)

  await fs.promises.mkdir(modelDir, { recursive: true })

  for (const file of option.files) {
    await downloadLocalEmbeddingModelFile({
      file,
      modelDir,
      repository: option.repository
    })
  }
}

export const listMemoryEmbeddingModels = (): MemoryEmbeddingModelsOutput => ({
  models: [
    {
      downloadSize: null,
      id: "",
      isDefault: true,
      label: DEFAULT_EMBEDDING_MODEL_LABEL,
      source: "default",
      status: "available"
    },
    ...LOCAL_EMBEDDING_MODEL_OPTIONS.map((option) => ({
      downloadSize: option.downloadSize,
      id: option.id,
      isDefault: false,
      label: option.label,
      source: "local" as const,
      status: getLocalEmbeddingModelStatus(option.id)
    }))
  ]
})

export const installMemoryEmbeddingModel = async (
  modelId: string
): Promise<MemoryEmbeddingModelsOutput> => {
  const option = getLocalEmbeddingModelOption(modelId)

  if (!option) {
    throw new Error(`Unknown local memory embedding model: ${modelId}`)
  }

  const existingDownload = LOCAL_EMBEDDING_MODEL_DOWNLOADS.get(modelId)

  if (existingDownload) {
    await existingDownload
    return listMemoryEmbeddingModels()
  }

  const nextDownload = (async () => {
    try {
      await downloadLocalEmbeddingModel(option)
    } finally {
      LOCAL_EMBEDDING_MODEL_DOWNLOADS.delete(modelId)
    }
  })()

  LOCAL_EMBEDDING_MODEL_DOWNLOADS.set(modelId, nextDownload)
  await nextDownload

  return listMemoryEmbeddingModels()
}
