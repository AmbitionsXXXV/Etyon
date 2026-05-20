export interface LocalEmbeddingModelOption {
  downloadSize: string
  id: string
  installed: boolean
  label: string
}

export const DEFAULT_EMBEDDING_MODEL_ID = ""
export const DEFAULT_EMBEDDING_MODEL_LABEL = "text-embedding-3-small"

export const LOCAL_EMBEDDING_MODEL_OPTIONS = [
  {
    downloadSize: "~23 MB",
    id: "local:minilm-l6-v2",
    installed: true,
    label: "MiniLM L6 v2"
  },
  {
    downloadSize: "~33 MB",
    id: "local:bge-small-en-v1.5",
    installed: false,
    label: "BGE Small EN v1.5"
  },
  {
    downloadSize: "~118 MB",
    id: "local:multilingual-e5-small",
    installed: true,
    label: "Multilingual E5 Small"
  },
  {
    downloadSize: "~118 MB",
    id: "local:paraphrase-multilingual-minilm",
    installed: false,
    label: "Paraphrase Multilingual MiniLM"
  }
] as const satisfies readonly LocalEmbeddingModelOption[]
