import type { MemoryEmbeddingModelsOutput } from "@etyon/rpc"

import {
  DEFAULT_EMBEDDING_MODEL_LABEL,
  LOCAL_EMBEDDING_MODEL_OPTIONS
} from "@/shared/memory/embedding-model-catalog"

const toLocalModelStatus = (installed: boolean): "available" | "missing" =>
  installed ? "available" : "missing"

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
      status: toLocalModelStatus(option.installed)
    }))
  ]
})

export const getLocalEmbeddingModelOption = (modelId: string) =>
  LOCAL_EMBEDDING_MODEL_OPTIONS.find((option) => option.id === modelId) ?? null
