export interface LocalEmbeddingModelOption {
  downloadSize: string
  files: readonly string[]
  id: string
  label: string
  repository: string
}

export const DEFAULT_EMBEDDING_MODEL_ID = ""
export const DEFAULT_EMBEDDING_MODEL_LABEL = "text-embedding-3-small"

export const LOCAL_EMBEDDING_MODEL_OPTIONS = [
  {
    downloadSize: "~23 MB",
    files: [
      "config.json",
      "onnx/model_quantized.onnx",
      "special_tokens_map.json",
      "tokenizer.json",
      "tokenizer_config.json"
    ],
    id: "local:minilm-l6-v2",
    label: "MiniLM L6 v2",
    repository: "Xenova/all-MiniLM-L6-v2"
  },
  {
    downloadSize: "~33 MB",
    files: [
      "config.json",
      "onnx/model_quantized.onnx",
      "special_tokens_map.json",
      "tokenizer.json",
      "tokenizer_config.json"
    ],
    id: "local:bge-small-en-v1.5",
    label: "BGE Small EN v1.5",
    repository: "Xenova/bge-small-en-v1.5"
  },
  {
    downloadSize: "~118 MB",
    files: [
      "config.json",
      "onnx/model_quantized.onnx",
      "sentencepiece.bpe.model",
      "special_tokens_map.json",
      "tokenizer.json",
      "tokenizer_config.json"
    ],
    id: "local:multilingual-e5-small",
    label: "Multilingual E5 Small",
    repository: "Xenova/multilingual-e5-small"
  },
  {
    downloadSize: "~118 MB",
    files: [
      "config.json",
      "onnx/model_quantized.onnx",
      "special_tokens_map.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "vocab.txt"
    ],
    id: "local:paraphrase-multilingual-minilm",
    label: "Paraphrase Multilingual MiniLM",
    repository: "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
  }
] as const satisfies readonly LocalEmbeddingModelOption[]
